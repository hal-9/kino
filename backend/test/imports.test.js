import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { runSync } from '../src/sync/index.js'

// K04: Teil-Importe löschen nichts, Abwesenheit nur in vollständigen Scopes und erst nach zwei verschiedenen Captures.
const show = (title, startsAt, extra = {}) => ({
  cinemaKey: 'zoo-palast', cinemaName: 'Zoo Palast', title, startsAt, year: null, version: null, auditorium: null,
  attrs: [], ticketUrl: null, sourceId: null, runtime: null, ...extra,
})
const D1 = '2099-10-13T20:00:00+02:00'
const D2 = '2099-10-14T20:00:00+02:00'
const complete = (rows, cinemas = ['zoo-palast']) => ({ fetchShows: async () => ({ rows, coverage: { cinemas, from: '2099-10-13', to: '2099-10-14' } }) })

describe('Nicht-destruktive, atomare Importe', () => {
  let app, db, users
  beforeEach(() => ({ app, db, users } = setupTestApp()))
  afterEach(() => vi.useRealTimers())

  const sync = (adapters) => runSync(db, { adapters, log() {}, minRows: () => 1, fetch: async () => ({ status: 404 }) })
  const active = () => db.prepare('SELECT m.title FROM screenings s JOIN movies m ON m.id = s.movie_id WHERE s.withdrawn_at IS NULL ORDER BY s.starts_at, m.title').all().map((r) => r.title)
  const obs = (title) => db.prepare('SELECT o.missing_count, o.withdrawn_at FROM screening_observations o WHERE o.title = ?').get(title)

  it('AC01: drei Basis-Vorstellungen plus Teil-Overlay → alle drei bleiben', async () => {
    const at = (t) => `2099-10-13T${t}:00+02:00`
    await sync({
      kinoheld: { fetchShows: async () => ['A', 'B', 'C'].map((t, i) => show(t, at(`1${i}:00`), { cinemaKey: 'uci-mercedes-platz', source: 'kinoheld', sourceId: `k${i}` })) },
      uci: { fetchShows: async () => [show('Forgotten Island', at('21:00'), { cinemaKey: 'uci-mercedes-platz', source: 'uci' })] },
    })
    expect(active()).toEqual(['A', 'B', 'C', 'Forgotten Island'])
  })

  it('AC02/AC05: Abwesenheit zählt nur in vollständigem Scope, erst zwei verschiedene Captures mit Abstand ziehen zurück', async () => {
    setNow('2099-10-01T08:00:00Z')
    const A = show('A', D1, { source: 'zoopalast', sourceId: 'a' })
    const B = show('B', D2, { source: 'zoopalast', sourceId: 'b' })
    const X = show('X', D2, { source: 'zoopalast', sourceId: 'x', cinemaKey: 'delphi-lux' }) // außerhalb des Scopes
    await sync({ zoopalast: complete([A, B, X]) })
    const cookie = await loginCookie(app, users[0]) // Session nach dem Einfrieren der Uhr anlegen

    // Vorschlag auf B: Snapshot und Verweis müssen das Zurückziehen überleben.
    const bId = db.prepare("SELECT s.id FROM screenings s JOIN movies m ON m.id = s.movie_id WHERE m.title = 'B'").get().id
    const p = (await request(app).post('/api/proposals').set('Cookie', cookie).send({ movie_id: db.prepare("SELECT id FROM movies WHERE title = 'B'").get().id, screening_ids: [bId] })).body
    const snap = db.prepare('SELECT snapshot_json FROM proposal_options WHERE proposal_id = ?').get(p.id).snapshot_json

    // Fehlgeschlagener und unvollständiger Lauf: keine Abwesenheit.
    await sync({ zoopalast: { fetchShows: async () => { throw new Error('boom') } } })
    await sync({ zoopalast: { fetchShows: async () => [A] } })
    expect(obs('B')).toMatchObject({ missing_count: 0, withdrawn_at: null })

    setNow('2099-10-01T09:00:00Z')
    await sync({ zoopalast: complete([A]) })
    expect(obs('B')).toMatchObject({ missing_count: 1, withdrawn_at: null })
    // Gleicher Inhalt erneut (Cache-Replay) bestätigt nichts.
    setNow('2099-10-01T20:00:00Z')
    await sync({ zoopalast: complete([A]) })
    expect(obs('B')).toMatchObject({ missing_count: 1, withdrawn_at: null })
    expect(active()).toEqual(['A', 'B', 'X'])

    // Zweiter, anderer Capture mit ≥ 6 h Abstand: B wird zurückgezogen, X (nicht im Scope) nicht.
    await sync({ zoopalast: complete([A, show('C', D2, { source: 'zoopalast', sourceId: 'c' })]) })
    expect(obs('B').missing_count).toBe(2)
    expect(obs('B').withdrawn_at).not.toBeNull()
    expect(active()).toEqual(['A', 'C', 'X'])
    expect(db.prepare('SELECT screening_id, snapshot_json FROM proposal_options WHERE proposal_id = ?').get(p.id)).toEqual({ screening_id: bId, snapshot_json: snap })
    const titles = (await request(app).get('/api/program?from=2099-10-13&to=2099-10-14').set('Cookie', cookie)).body.movies.map((m) => m.title)
    expect(titles).not.toContain('B')

    // Taucht B wieder auf, ist es wieder aktiv.
    await sync({ zoopalast: complete([A, B]) })
    expect(active()).toContain('B')
  })

  it('AC03: eine Quelle kann die frische Beobachtung einer anderen nicht löschen', async () => {
    setNow('2099-10-01T08:00:00Z')
    await sync({ zoopalast: complete([show('B', D2, { source: 'zoopalast', sourceId: 'b' })]), yorck: { fetchShows: async () => [show('B', D2, { source: 'yorck', sourceId: 'yb' })] } })
    const A = show('A', D1, { source: 'zoopalast', sourceId: 'a' })
    await sync({ zoopalast: complete([A]) })
    setNow('2099-10-01T20:00:00Z')
    await sync({ zoopalast: complete([A, show('C', D1, { source: 'zoopalast', sourceId: 'c' })]) })
    expect(obs('B')).toBeDefined()
    expect(db.prepare("SELECT withdrawn_at FROM screening_observations WHERE source = 'zoopalast' AND source_key = 'b'").get().withdrawn_at).not.toBeNull()
    expect(active()).toContain('B') // yorck sieht sie noch
  })

  it('AC04: Fehler beim Commit rollt Daten und Erfolgszeitpunkte zurück', async () => {
    await sync({ zoopalast: complete([show('A', D1, { source: 'zoopalast', sourceId: 'a' })]) })
    const before = db.prepare("SELECT * FROM source_health WHERE source = 'zoopalast'").get()
    expect(before.last_ok_at).not.toBeNull()
    expect(before.last_complete_import_at).not.toBeNull()
    await sync({ zoopalast: complete([show('Neu', D1, { source: 'zoopalast', sourceId: 'n' }), show('Kaputt', D2, { source: 'zoopalast', sourceId: 'k', version: 'XX' })]) })
    expect(db.prepare("SELECT COUNT(*) n FROM movies WHERE title IN ('Neu', 'Kaputt')").get().n).toBe(0)
    const after = db.prepare("SELECT * FROM source_health WHERE source = 'zoopalast'").get()
    expect(after).toMatchObject({ last_ok_at: before.last_ok_at, last_complete_import_at: before.last_complete_import_at, last_count: 1 })
    expect(after.last_error).toMatch(/CHECK/)
    expect(after.last_attempt_at >= before.last_attempt_at).toBe(true)
  })
})
