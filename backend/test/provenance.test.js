import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { runSync } from '../src/sync/index.js'

// K05: Feldherkunft, Auslastung als flüchtiger Zustand, Korrekturen derselben Quelle.
const row = (extra) => ({
  cinemaKey: 'zoo-palast', cinemaName: 'Zoo Palast', title: 'Digger', startsAt: '2099-10-13T20:00:00+02:00', year: 2026,
  version: null, auditorium: null, attrs: [], ticketUrl: null, sourceId: 'e1', runtime: null, ...extra,
})

describe('Herkunft und flüchtige Felder', () => {
  let app, db, users
  beforeEach(() => ({ app, db, users } = setupTestApp()))
  afterEach(() => vi.useRealTimers())

  const sync = (adapters) => runSync(db, { adapters, log() {}, minRows: () => 1, fetch: async () => ({ status: 404 }) })
  const one = (source, extra, capturedAt) => ({ fetchShows: async () => ({ rows: [row({ source, ...extra })], ...(capturedAt && { capturedAt }) }) })
  const program = async () => {
    const cookie = await loginCookie(app, users[0])
    return (await request(app).get('/api/program?date=2099-10-13').set('Cookie', cookie)).body.movies[0].screenings[0]
  }
  const screening = () => db.prepare('SELECT version, auditorium, ticket_url, capacity, provenance_json FROM screenings').get()

  it('AC01: neue explizite Entwarnung entfernt „fast ausverkauft“', async () => {
    setNow('2099-10-01T08:00:00Z')
    await sync({ zoopalast: one('zoopalast', { capacity: 'nearly_sold_out' }) })
    expect((await program()).attrs).toContain('fast ausverkauft')
    setNow('2099-10-01T09:00:00Z')
    await sync({ zoopalast: one('zoopalast', { capacity: 'available' }) })
    expect(await program()).toMatchObject({ attrs: [], capacity: 'available' })
  })

  it('AC02: fehlende Auslastung wird unbekannt, nicht „frei“; alte Angaben verfallen', async () => {
    setNow('2099-10-01T08:00:00Z')
    await sync({ zoopalast: one('zoopalast', { capacity: 'nearly_sold_out' }) })
    setNow('2099-10-02T09:00:00Z') // > 24 h später, ohne neue Beobachtung
    expect(await program()).toMatchObject({ attrs: [], capacity: null })
    await sync({ zoopalast: one('zoopalast', { capacity: null }) })
    expect(await program()).toMatchObject({ attrs: [], capacity: null })
  })

  it('AC03: Korrektur desselben Ereignisses wirkt, auch wenn nur die Basisquelle es kennt; Änderung wird protokolliert', async () => {
    setNow('2099-10-01T08:00:00Z')
    await sync({ kinoheld: one('kinoheld', { version: 'OV', auditorium: 'Saal 1' }) })
    setNow('2099-10-01T20:00:00Z')
    await sync({ kinoheld: one('kinoheld', { version: 'DF', auditorium: 'Saal 1' }) })
    expect(screening()).toMatchObject({ version: 'DF' })
    expect(JSON.parse(screening().provenance_json).version).toEqual({ source: 'kinoheld', observed_at: '2099-10-01T20:00:00.000Z' })
    expect(db.prepare('SELECT field, old_value, new_value, source FROM screening_changes').all()).toEqual([
      { field: 'version', old_value: 'OV', new_value: 'DF', source: 'kinoheld' },
    ])
  })

  it('AC04: ältere Beobachtung (früher Capture) dreht neuere Fakten nicht zurück', async () => {
    setNow('2099-10-01T20:00:00Z')
    await sync({ zoopalast: one('zoopalast', { version: 'DF' }) })
    await sync({ zoopalast: one('zoopalast', { version: 'OV' }, '2099-10-01T08:00:00.000Z') })
    expect(screening().version).toBe('DF')
  })

  it('AC05: Reihenfolge der Provider und Wiederholung ergeben dasselbe Ergebnis ohne neue Änderungen', async () => {
    setNow('2099-10-01T08:00:00Z')
    const kh = one('kinoheld', { sourceId: 'k1', version: null, auditorium: null, ticketUrl: 'https://kh', attrs: ['IMAX'] })
    const zp = one('zoopalast', { version: 'OmU', auditorium: 'Kino 1', ticketUrl: 'https://zp', attrs: ['Dolby Atmos'] })
    await sync({ kinoheld: kh, zoopalast: zp })
    expect(db.prepare('SELECT COUNT(*) n FROM screenings').get().n).toBe(1)
    const a = screening()

    ;({ app, db, users } = setupTestApp())
    await sync({ zoopalast: zp, kinoheld: kh })
    expect(screening()).toEqual(a)
    expect(a).toMatchObject({ version: 'OmU', auditorium: 'Kino 1', ticket_url: 'https://zp' })
    expect(JSON.parse(db.prepare('SELECT attrs_json FROM screenings').get().attrs_json)).toEqual(['Dolby Atmos', 'IMAX'])
    await sync({ zoopalast: zp, kinoheld: kh })
    expect(screening()).toEqual(a)
    expect(db.prepare('SELECT COUNT(*) n FROM screening_changes').get().n).toBe(0)
  })
})
