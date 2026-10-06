import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie } from './helpers.js'
import { runSync } from '../src/sync/index.js'
import * as kinoheld from '../src/sync/kinoheld.js'
import * as yorck from '../src/sync/yorck.js'
import * as zoopalast from '../src/sync/zoopalast.js'
import * as uci from '../src/sync/uci.js'
import * as berlinde from '../src/sync/berlinde.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixtures = dir
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8')
const reply = (body) => ({ status: 200, json: async () => JSON.parse(body), text: async () => body })

// Fake-fetch: Antwort nach URL-Muster; GraphQL nach Query-Text.
function fakeFetch(map) {
  return async (url, opts = {}) => {
    const q = opts.body ? JSON.parse(opts.body).query : ''
    for (const [pat, file] of Object.entries(map)) if (url.includes(pat) || (q && q.includes(pat))) return reply(read(file))
    return { status: 404, json: async () => ({}), text: async () => '' }
  }
}
const ctxWith = (db, map) => {
  const cinemas = new Map(db.prepare('SELECT * FROM cinemas').all().map((c) => [c.key, { ...c, aliases: JSON.parse(c.aliases_json) }]))
  return { fetch: fakeFetch(map), log() {}, cinemas, today: '2026-10-06' }
}

describe('Adapter', () => {
  let db
  beforeEach(async () => {
    ;({ db } = setupTestApp())
    const { seedCinemas } = await import('../src/sync/index.js')
    seedCinemas(db)
  })

  it('kinoheld: Platzhalter-Saal → null, Kino per kinoheld_id', async () => {
    const ctx = ctxWith(db, { programShows: 'kinoheld-shows.json' })
    const { rows, coverage } = await kinoheld.fetchShows(ctx)
    expect(coverage).toMatchObject({ from: '2026-10-06', to: '2026-10-19' })
    expect(coverage.cinemas).toContain('zoo-palast')
    const zoo = rows.find((r) => r.cinemaKey === 'zoo-palast')
    expect(zoo.auditorium).toBeNull()
    expect(zoo.startsAt).toMatch(/\+02:00$/)
    expect(rows.every((r) => r.source === 'kinoheld')).toBe(true)
  })

  it('yorck: Offset aus lokalen Anteilen neu gebaut', async () => {
    const rows = await yorck.fetchShows(ctxWith(db, { '/filme': 'yorck.html' }))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].startsAt).toMatch(/T\d\d:\d\d:00\+02:00$/)
    expect(rows.find((r) => r.cinemaName === 'Passage').version).toBe('OmU')
  })

  it('zoopalast: Version und Saal', async () => {
    const { rows, coverage } = await zoopalast.fetchShows(ctxWith(db, { '/config': 'zoopalast-config.json', '/program': 'zoopalast-program.json' }))
    expect(coverage).toMatchObject({ cinemas: ['zoo-palast'], from: '2026-10-06' })
    expect(rows.length).toBeGreaterThan(5)
    expect(rows.every((r) => r.cinemaKey === 'zoo-palast' && typeof r.auditorium === 'string')).toBe(true)
    expect(new Set(rows.map((r) => r.version))).toContain('DF')
    expect(rows.every((r) => r.capacity === 'available' && !r.attrs.includes('fast ausverkauft'))).toBe(true) // Fixture: workload < 80
  })

  it('uci: Version aus data-version, Saal, Ticketlink dekodiert', () => {
    const rows = uci.parseUci(read('uci.html'))
    const ov = rows.find((r) => r.version === 'OV')
    expect(ov).toMatchObject({ auditorium: 'Kino 02 iSense', startsAt: '2026-12-16T00:01:00+01:00', title: 'Avengers: Doomsday' })
    expect(ov.attrs).toContain('iSense')
    expect(ov.ticketUrl).toContain('perf_id=45BF1000023ZIQERCX&site_id=82')
  })

  it('berlin.de: OmU-Marker, sonst DF', () => {
    const rows = berlinde.parseBerlinde(read('berlinde-alhambra.html'))
    expect(rows[0]).toMatchObject({ title: 'Always Lalisa', version: 'OmU', startsAt: '2026-10-12T20:00:00+02:00' })
    expect(rows.some((r) => r.version === 'DF')).toBe(true)
  })
})

describe('Inbox (Mac-Upload)', () => {
  const ctx = (inboxDir, fetch) => ({ fetch, inboxDir, log() {}, cinemas: new Map(), today: '2026-10-06' })
  const dead = async () => ({ status: 403 })

  it('frische Datei hat Vorrang vor dem Live-Abruf, veraltete nicht', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'))
    fs.copyFileSync(path.join(fixtures, 'uci.html'), path.join(dir, 'uci.html'))
    expect((await uci.fetchShows(ctx(dir, dead))).rows.length).toBeGreaterThan(0)
    const old = new Date(Date.now() - 40 * 3600_000)
    fs.utimesSync(path.join(dir, 'uci.html'), old, old)
    await expect(uci.fetchShows(ctx(dir, dead))).rejects.toThrow('HTTP 403')
  })
})

describe('Merge + Programm', () => {
  let app, db, cookie
  beforeEach(async () => {
    const t = setupTestApp()
    ;({ app, db } = t)
    cookie = await loginCookie(app, t.users[0])
  })

  const sync = (adapters, today = '2026-10-06') =>
    runSync(db, {
      adapters, today, log() {}, minRows: () => 1,
      fetch: fakeFetch({ 'cinemas(': 'kinoheld-cinemas.json', 'programShows': 'kinoheld-shows.json', '/config': 'zoopalast-config.json', '/program': 'zoopalast-program.json' }),
    })

  it('Overlay ergänzt Version und Saal der kinoheld-Zeile (eine Vorstellung)', async () => {
    const { rows: khRows } = await kinoheld.fetchShows(ctxWith(db, { programShows: 'kinoheld-shows.json' }))
    expect(khRows.length).toBeGreaterThan(0)
    // Zoo-Palast-Overlay mit exakt der Zeit einer kinoheld-Zeile
    const kh = khRows.find((r) => r.cinemaKey === 'zoo-palast')
    const overlay = { fetchShows: async () => [{ ...kh, version: 'OV', auditorium: 'Kino 1', source: 'zoopalast', ticketUrl: 'https://x' }] }
    await sync({ kinoheld: { ...kinoheld, MIN_ROWS: 1 }, zoopalast: overlay })
    const rows = db.prepare(`SELECT s.* FROM screenings s JOIN movies m ON m.id = s.movie_id WHERE s.cinema_key = 'zoo-palast' AND s.starts_at = ? AND m.title = ?`).all(kh.startsAt, kh.title)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ version: 'OV', auditorium: 'Kino 1', ticket_url: 'https://x' })
  })

  it('Overlay mit anderem Titel löscht die kinoheld-Zeile nicht mehr (K04: keine Quelle löscht eine andere)', async () => {
    const base = { cinemaKey: 'uci-mercedes-platz', cinemaName: 'UCI', startsAt: '2099-01-05T20:00:00+01:00', year: null, version: null, auditorium: null, attrs: [], ticketUrl: null, sourceId: null, runtime: null }
    const kh = { fetchShows: async () => [{ ...base, title: 'Die vergessene Insel', source: 'kinoheld' }] }
    const ov = { fetchShows: async () => [{ ...base, title: 'Forgotten Island', version: 'OV', source: 'uci' }] }
    await sync({ kinoheld: kh, uci: ov })
    const rows = db.prepare("SELECT version, source FROM screenings WHERE cinema_key = 'uci-mercedes-platz' ORDER BY id").all()
    expect(rows).toEqual([{ version: null, source: 'kinoheld' }, { version: 'OV', source: 'uci' }])
  })

  it('Quelle mit Fehler lässt Daten stehen und setzt source_health', async () => {
    await sync({ kinoheld: { ...kinoheld } })
    const before = db.prepare('SELECT COUNT(*) n FROM screenings').get().n
    expect(before).toBeGreaterThan(0)
    await sync({ kinoheld: { fetchShows: async () => { throw new Error('boom') } } })
    expect(db.prepare('SELECT COUNT(*) n FROM screenings').get().n).toBe(before)
    expect(db.prepare("SELECT last_error FROM source_health WHERE source = 'kinoheld'").get().last_error).toBe('boom')
  })

  it('/program: Favoriten zuerst, q- und version-Filter, Auth nötig', async () => {
    expect((await request(app).get('/api/program')).status).toBe(401)
    const rows = [
      { cinemaKey: 'zoo-palast', cinemaName: 'Zoo Palast', startsAt: '2099-10-13T20:15:00+02:00', title: 'Digger', year: 2026, version: 'OmU', auditorium: 'Kino 1', attrs: [], ticketUrl: null, source: 'yorck', sourceId: null, runtime: 129 },
      { cinemaKey: 'grosses-kino', cinemaName: 'Großes Kino', startsAt: '2099-10-13T18:00:00+02:00', title: 'Digger', year: 2026, version: 'DF', auditorium: null, attrs: [], ticketUrl: null, source: 'yorck', sourceId: null, runtime: null },
      { cinemaKey: 'zoo-palast', cinemaName: 'Zoo Palast', startsAt: '2099-10-13T21:00:00+02:00', title: 'Anderer Film', year: null, version: 'DF', auditorium: null, attrs: [], ticketUrl: null, source: 'yorck', sourceId: null, runtime: null },
    ]
    await runSync(db, { adapters: { yorck: { fetchShows: async () => rows } }, log() {}, minRows: () => 1, fetch: fakeFetch({}) })
    db.prepare("INSERT INTO auditoriums (cinema_key, name, seats) VALUES ('zoo-palast', 'Kino 1', 773)").run()
    const get = (qs) => request(app).get(`/api/program?${qs}`).set('Cookie', cookie)

    const all = (await get('q=digger&from=2099-10-13&to=2099-10-13')).body.movies
    expect(all).toHaveLength(1)
    expect(all[0].screenings.map((s) => s.cinema_key)).toEqual(['zoo-palast', 'grosses-kino'])
    expect(all[0].screenings[0]).toMatchObject({ is_favorite: true, version: 'OmU', seats: 773 })

    const ov = (await get('q=digger&date=2099-10-13&version=ov')).body.movies
    expect(ov[0].screenings).toHaveLength(1)
    expect((await get('date=2099-10-13')).body.movies.map((m) => m.title)).toEqual(['Anderer Film', 'Digger'])
    expect((await get('date=nope')).status).toBe(422)
    expect((await request(app).get('/api/program/days').set('Cookie', cookie)).body.days).toContain('2099-10-13')
  })
})
