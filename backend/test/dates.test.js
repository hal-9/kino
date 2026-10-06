import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { runSync } from '../src/sync/index.js'

// K02: Berliner Zeitpunkte, echte Kalenderdaten, vergangene Vorstellungen.
describe('Daten und Zeitpunkte', () => {
  let app, db, users, c1, movieId, shows

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('delphi-lux', 'Delphi LUX')").run()
    movieId = Number(db.prepare("INSERT INTO movies (title, norm_title, year, runtime) VALUES ('Digger', 'digger', 2026, 129)").run().lastInsertRowid)
    const ins = db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('delphi-lux', ?, ?, 'yorck')")
    shows = ['2026-10-13T18:00:00+02:00', '2026-10-13T20:15:00+02:00'].map((t) => Number(ins.run(movieId, t).lastInsertRowid))
  })
  afterEach(() => vi.useRealTimers())

  const get = (qs) => request(app).get(`/api/program?${qs}`).set('Cookie', c1)
  const propose = (ids) => request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: movieId, screening_ids: ids })

  it('/program: explizites heutiges Datum zeigt nur kommende Vorstellungen', async () => {
    setNow('2026-10-13T17:00:00Z') // 19:00 Berlin
    const starts = (await get('date=2026-10-13')).body.movies.flatMap((m) => m.screenings.map((s) => s.starts_at))
    expect(starts).toEqual(['2026-10-13T20:15:00+02:00'])
    expect((await request(app).get('/api/program/days').set('Cookie', c1)).body.days).toEqual(['2026-10-13'])
  })

  it('/program: ungültige Daten und verdrehte Bereiche → 422', async () => {
    setNow('2026-10-06T10:00:00Z')
    for (const qs of ['date=2026-02-30', 'date=2026-02-29', 'from=2026-10-14&to=2026-10-13', 'date=2026-10-13&date=2026-10-14']) {
      expect((await get(qs)).status).toBe(422)
    }
    expect((await get('date=2028-02-29')).status).toBe(200)
  })

  it('Vorschlag/Buchung: inzwischen begonnene Vorstellung → 409, Unsinn → 422', async () => {
    setNow('2026-10-13T17:00:00Z')
    expect((await propose([shows[0]])).status).toBe(409)
    const p = (await propose([shows[1]])).body
    setNow('2026-10-13T18:30:00Z') // 20:30 Berlin: Vorstellung läuft
    const book = await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id })
    expect(book.status).toBe(409)
    expect((await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: 'x' })).status).toBe(422)
  })

  it('Besuche: Datum muss es geben (Tagebuch darf in der Vergangenheit liegen)', async () => {
    const post = (watched_on) => request(app).post('/api/visits').set('Cookie', c1).send({ title: 'Digger', cinema_key: 'delphi-lux', watched_on })
    expect((await post('2026-02-29')).status).toBe(422)
    expect((await post('2026-02-30')).status).toBe(422)
    expect((await post('2028-02-29')).status).toBe(201)
    expect((await post('2019-05-01')).status).toBe(201)
  })

  it('Sync: beide Herbst-02:30-Zeitpunkte bleiben getrennt, Frühjahrslücke wird verworfen', async () => {
    const row = { cinemaKey: 'delphi-lux', cinemaName: 'Delphi LUX', title: 'Digger', year: 2026, version: null, auditorium: null, attrs: [], ticketUrl: null, sourceId: null, runtime: null }
    const logs = []
    await runSync(db, {
      log: (m) => logs.push(m), minRows: () => 1, fetch: async () => ({ status: 404 }),
      adapters: {
        kinoheld: { fetchShows: async () => [
          { ...row, startsAt: '2026-10-25T02:30:00+02:00', source: 'kinoheld' },
          { ...row, startsAt: '2026-10-25T02:30:00+01:00', source: 'kinoheld' },
        ] },
        // anderes Kino: hier geht es nur um das Verwerfen unaufgelöster Ortszeiten
        yorck: { fetchShows: async () => [{ ...row, cinemaKey: 'passage', startsAt: null, source: 'yorck' }, { ...row, cinemaKey: 'passage', startsAt: '2026-10-26T20:00:00+01:00', source: 'yorck' }] },
      },
    })
    const rows = db.prepare("SELECT starts_at FROM screenings WHERE cinema_key = 'delphi-lux' AND starts_at LIKE '2026-10-25%' ORDER BY datetime(starts_at)").all()
    expect(rows.map((r) => r.starts_at)).toEqual(['2026-10-25T02:30:00+02:00', '2026-10-25T02:30:00+01:00'])
    expect(logs.some((m) => m.includes('yorck: 1 ungültige Vorstellungen verworfen (startsAt)'))).toBe(true)
  })
})
