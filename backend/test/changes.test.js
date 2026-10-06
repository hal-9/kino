import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { runSync } from '../src/sync/index.js'

// K12: Live-Änderungen gegenüber eingefrorenen Optionen sichtbar machen, ohne Geschichte umzuschreiben.
const show = (startsAt, extra = {}) => ({
  cinemaKey: 'zoo-palast', cinemaName: 'Zoo Palast', title: 'Digger', startsAt, year: 2026, version: 'OV', auditorium: 'Saal 1',
  attrs: [], ticketUrl: null, sourceId: 'e1', source: 'zoopalast', runtime: 120, ...extra,
})
const T1 = '2099-10-13T20:00:00+02:00'
const T2 = '2099-10-13T21:30:00+02:00'
const complete = (rows) => ({ fetchShows: async () => ({ rows, coverage: { cinemas: ['zoo-palast'], from: '2099-10-13', to: '2099-10-14' } }) })

describe('K12 Live-Änderungen an Optionen', () => {
  let app, db, users, cookie, p
  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    setNow('2099-10-01T08:00:00Z')
    await sync([show(T1)])
    cookie = await loginCookie(app, users[0])
    const s = db.prepare('SELECT id, movie_id FROM screenings').get()
    p = (await request(app).post('/api/proposals').set('Cookie', cookie).send({ movie_id: s.movie_id, screening_ids: [s.id] })).body
  })
  afterEach(() => vi.useRealTimers())

  function sync(rows, adapter = (r) => ({ fetchShows: async () => r })) {
    return runSync(db, { adapters: { zoopalast: adapter(rows) }, log() {}, minRows: () => 1, fetch: async () => ({ status: 404 }) })
  }
  const later = (h) => setNow(new Date(Date.parse('2099-10-01T08:00:00Z') + h * 3600_000).toISOString())
  const detail = async () => (await request(app).get(`/api/proposals/${p.id}`).set('Cookie', cookie)).body.proposal
  const changes = async () => (await detail()).options[0].changes.map(({ field, before, after, certainty }) => ({ field, before, after, certainty }))
  const book = (revision) => request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', cookie).send({ option_id: p.options[0].id, revision })

  it('AC01: Saal-/Fassungs- und Zeitänderung zeigen den genauen Unterschied', async () => {
    expect(await changes()).toEqual([])
    later(1)
    await sync([show(T1, { version: 'DF', auditorium: 'Saal 2' })])
    expect(await changes()).toEqual([
      { field: 'version', before: 'OV', after: 'DF', certainty: 'confirmed' },
      { field: 'auditorium', before: 'Saal 1', after: 'Saal 2', certainty: 'confirmed' },
    ])
    later(2)
    await sync([show(T2, { version: 'DF', auditorium: 'Saal 2' })]) // derselbe Anbieter-Schlüssel, neue Zeit
    const c = await changes()
    expect(c[0]).toEqual({ field: 'starts_at', before: T1, after: T2, certainty: 'confirmed' })
    // Alte Vorstellung ist zurückgezogen (nicht mehr im Programm), Ersatz ist aktiv.
    expect(db.prepare('SELECT starts_at, withdrawn_at IS NOT NULL AS gone FROM screenings ORDER BY id').all()).toEqual([
      { starts_at: T1, gone: 1 }, { starts_at: T2, gone: 0 },
    ])
  })

  it('AC02: teilweise Abwesenheit ist Unsicherheit, keine Absage', async () => {
    later(1)
    await sync([show(T1)], complete)
    later(2)
    await sync([show('2099-10-14T18:00:00+02:00', { sourceId: 'e2', title: 'Anderer' })], complete) // e1 fehlt einmal
    expect(await changes()).toEqual([{ field: 'availability', before: 'active', after: 'missing', certainty: 'uncertain' }])
    expect((await detail()).status).toBe('open')
    expect(db.prepare('SELECT withdrawn_at FROM screenings WHERE starts_at = ?').get(T1).withdrawn_at).toBeNull()
  })

  it('AC03: veraltete Buchungsanfrage bekommt prüfbaren Konflikt; nach Prüfung buchbar; Verlegung nie buchbar', async () => {
    later(1)
    await sync([show(T1, { version: 'DF' })])
    const stale = await book(1)
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ error: 'review required', changes: [{ field: 'version', before: 'OV', after: 'DF' }] })
    const ack = await request(app).post(`/api/proposals/${p.id}/changes/ack`).set('Cookie', cookie).send({ revision: 1 })
    expect(ack.status).toBe(200)
    expect(ack.body.options[0].changes[0].acknowledged).toBe(true)
    expect((await book(1)).status).toBe(409) // Revision ist durch die Prüfung gestiegen
    expect((await book(2)).status).toBe(200)
    // Gebuchter Plan + Verlegung: Warnung sichtbar, Buchung bleibt unverändert (kein automatisches Umbuchen).
    later(2)
    await sync([show(T2, { version: 'DF' })])
    const d = await detail()
    expect(d).toMatchObject({ status: 'booked', booked_option_id: p.options[0].id })
    expect(d.options[0].snapshot.starts_at).toBe(T1)
    expect(d.options[0].changes.map((c) => c.field)).toContain('starts_at')
    const reopened = await request(app).post(`/api/proposals/${p.id}/reopen`).set('Cookie', cookie).send({})
    expect(reopened.status).toBe(200)
    await request(app).post(`/api/proposals/${p.id}/changes/ack`).set('Cookie', cookie).send({}).expect(200)
    expect((await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', cookie).send({ option_id: p.options[0].id })).body.error).toBe('changed')
  })

  it('AC04: dieselbe Änderung wiederholt erkannt → ein Datensatz', async () => {
    later(1)
    await sync([show(T1, { version: 'DF' })])
    for (let i = 0; i < 3; i++) await detail()
    later(2)
    await sync([show(T1, { version: 'DF' })])
    await detail()
    expect(db.prepare('SELECT field, before_value, after_value FROM option_changes').all()).toEqual([{ field: 'version', before_value: 'OV', after_value: 'DF' }])
  })

  it('AC05: Snapshot und Besuchshistorie überleben Rückzug und Umzug', async () => {
    const snapBefore = db.prepare('SELECT snapshot_json FROM proposal_options').get().snapshot_json
    const visit = (await request(app).post('/api/visits').set('Cookie', cookie).send({ screening_id: db.prepare('SELECT id FROM screenings').get().id, watched_on: '2099-10-13' })).body
    later(1)
    await sync([show(T2)])
    expect(db.prepare('SELECT snapshot_json FROM proposal_options').get().snapshot_json).toBe(snapBefore)
    expect(db.prepare('SELECT snapshot_json FROM visits WHERE id = ?').get(visit.id).snapshot_json).toContain(T1)
    // Option zeigt weiter auf die ursprüngliche (jetzt zurückgezogene) Vorstellung.
    expect(db.prepare('SELECT screening_id FROM proposal_options').get().screening_id).toBe(db.prepare('SELECT MIN(id) id FROM screenings').get().id)
  })
})

describe('Migration 014 auf befüllter DB', () => {
  it('fügt nur die Tabelle hinzu; Optionen/Snapshots unverändert, Integrität ok', async () => {
    const { default: Database } = await import('better-sqlite3')
    const { runMigrations } = await import('../src/migrate.js')
    const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '013_proposal_lifecycle.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'tuncay', 't@example.com', 'x')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'Digger', 'digger')").run()
    db.prepare('INSERT INTO proposals (id, household_id, movie_id, created_by) VALUES (5, 1, 7, 1)').run()
    db.prepare(`INSERT INTO proposal_options (id, proposal_id, snapshot_json) VALUES (21, 5, '{"starts_at":"2099-10-13T20:00:00+02:00"}')`).run()
    runMigrations(db)
    expect(db.prepare('SELECT id, snapshot_json FROM proposal_options').all()).toEqual([{ id: 21, snapshot_json: '{"starts_at":"2099-10-13T20:00:00+02:00"}' }])
    expect(db.prepare('SELECT COUNT(*) n FROM option_changes').get().n).toBe(0)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
