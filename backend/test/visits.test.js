import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { syncRatings, parseRss } from '../src/letterboxd.js'
import { enrich } from '../src/tmdb.js'

const rss = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/letterboxd-rss.xml'), 'utf8')

describe('Besuche + Letterboxd', () => {
  let app, db, users, c1, c2, movieId, shows

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO cinemas (key, name, street, zip) VALUES ('delphi-lux', 'Delphi LUX', 'Kantstraße 10', '10623')").run()
    movieId = Number(db.prepare("INSERT INTO movies (title, norm_title, year, runtime) VALUES ('Tag im Leben', 'tag im leben', 2026, 100)").run().lastInsertRowid)
    const ins = db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, version, auditorium, source) VALUES ('delphi-lux', ?, ?, 'OmU', 'Kino 2', 'yorck')")
    shows = ['2020-10-04T20:00:00+02:00', '2020-10-05T20:00:00+02:00'].map((t) => Number(ins.run(movieId, t).lastInsertRowid))
  })

  afterEach(() => vi.useRealTimers())

  const post = (body, cookie = c1) => request(app).post('/api/visits').set('Cookie', cookie).send(body)

  it('Pending: gebuchte, vergangene Vorstellung ohne eigenen Besuch → Eintrag aus Vorschlag', async () => {
    setNow('2020-10-01T10:00:00Z')
    const p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: movieId, screening_ids: shows })).body
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id }).expect(200)
    setNow('2020-10-10T10:00:00Z')
    const pend = (await request(app).get('/api/visits/pending').set('Cookie', c2)).body.pending
    expect(pend).toHaveLength(1)
    const res = await post({ proposal_id: p.id, watched_on: '2020-10-04', row: '9', seats: '11, 12', companions: [users.length ? 1 : 0, 999] }, c2)
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ row: '9', seats: '11, 12', auditorium: 'Kino 2', snapshot: { title: 'Tag im Leben', cinema_name: 'Delphi LUX' } })
    expect(res.body.companions).toEqual([1])
    expect((await request(app).get('/api/visits/pending').set('Cookie', c2)).body.pending).toHaveLength(0)
    // c1 hat ✓ gestimmt: Besuch wurde automatisch angelegt, nichts offen
    expect((await request(app).get('/api/visits/pending').set('Cookie', c1)).body.pending).toHaveLength(0)
  })

  it('Auto-Besuch für alle ✓-Wähler nach Ende der Vorstellung, gelöscht bleibt gelöscht', async () => {
    setNow('2020-10-01T10:00:00Z')
    const p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: movieId, screening_ids: shows })).body
    await request(app).put(`/api/proposals/${p.id}/votes/${p.options[0].id}`).set('Cookie', c2).send({ value: 'yes' })
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id }).expect(200)
    setNow('2020-10-10T10:00:00Z')
    const list = (await request(app).get('/api/visits').set('Cookie', c1)).body.visits
    expect(list).toHaveLength(2)
    const mine = list.find((v) => v.user_id === 1)
    expect(mine).toMatchObject({ proposal_id: p.id, watched_on: '2020-10-04', auditorium: 'Kino 2', companions: [2] })
    await request(app).delete(`/api/visits/${mine.id}`).set('Cookie', c1).expect(204)
    expect((await request(app).get('/api/visits').set('Cookie', c1)).body.visits).toHaveLength(1)
    expect((await request(app).get('/api/visits/pending').set('Cookie', c1)).body.pending).toHaveLength(0)
  })

  it('Zukünftige Buchung erzeugt noch keinen Besuch', async () => {
    db.prepare("UPDATE screenings SET starts_at = '2099-10-04T20:00:00+02:00' WHERE id = ?").run(shows[0])
    setNow('2020-10-01T10:00:00Z')
    const p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: movieId, screening_ids: shows })).body
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options.find((o) => o.snapshot.starts_at.startsWith('2099')).id }).expect(200)
    expect((await request(app).get('/api/visits').set('Cookie', c1)).body.visits).toHaveLength(0)
  })

  it('Freitext-Besuch, nur Ersteller darf ändern/löschen, alle sehen alle', async () => {
    const v = (await post({ title: 'Digger', year: 2026, cinema_key: 'delphi-lux', watched_on: '2026-10-06', companions: [] })).body
    expect(v.snapshot).toMatchObject({ title: 'Digger', cinema_name: 'Delphi LUX', starts_at: null })
    expect((await request(app).patch(`/api/visits/${v.id}`).set('Cookie', c2).send({ row: '1' })).status).toBe(403)
    const upd = await request(app).patch(`/api/visits/${v.id}`).set('Cookie', c1).send({ row: '7', auditorium: 'Kino 3' })
    expect(upd.body).toMatchObject({ row: '7', auditorium: 'Kino 3' })
    const list = (await request(app).get('/api/visits?year=2026').set('Cookie', c2)).body
    expect(list.visits.map((x) => x.id)).toEqual([v.id])
    expect(list.members).toHaveLength(2)
    expect((await post({ title: 'X', cinema_key: 'nope', watched_on: '2026-10-06' })).status).toBe(422)
    await request(app).delete(`/api/visits/${v.id}`).set('Cookie', c2).expect(403)
    await request(app).delete(`/api/visits/${v.id}`).set('Cookie', c1).expect(204)
  })

  it('PATCH /me validiert den Letterboxd-Namen', async () => {
    expect((await request(app).patch('/api/me').set('Cookie', c1).send({ letterboxd_user: 'bad name!' })).status).toBe(422)
    const ok = await request(app).patch('/api/me').set('Cookie', c1).send({ letterboxd_user: 'davidehrlich' })
    expect(ok.body.letterboxd_user).toBe('davidehrlich')
    expect((await request(app).get('/api/settings').set('Cookie', c1)).body.letterboxd_user).toBe('davidehrlich')
  })

  it('RSS-Fixture: Rating landet per tmdb_id am passenden Besuch (±1 Tag), Fehler werden geschluckt', async () => {
    const items = parseRss(rss)
    expect(items.length).toBe(3)
    const first = items[0]
    const mid = Number(db.prepare('INSERT INTO movies (title, norm_title, year, tmdb_id) VALUES (?, ?, 2026, ?)').run('Ganz anderer deutscher Titel', 'ganz anderer deutscher titel', first.tmdbId).lastInsertRowid)
    db.prepare("UPDATE users SET letterboxd_user = 'davidehrlich' WHERE id = 1").run()
    const d = new Date(Date.parse(`${first.watchedDate}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    const v = Number(db.prepare("INSERT INTO visits (user_id, household_id, movie_id, snapshot_json, watched_on) VALUES (1, 1, ?, '{\"title\":\"x\"}', ?)").run(mid, d).lastInsertRowid)
    const far = Number(db.prepare("INSERT INTO visits (user_id, household_id, movie_id, snapshot_json, watched_on) VALUES (1, 1, ?, '{\"title\":\"x\"}', '2001-01-01')").run(mid).lastInsertRowid)

    const n = await syncRatings(db, { fetch: async () => ({ status: 200, text: async () => rss }) })
    expect(n).toBe(1)
    expect(db.prepare('SELECT letterboxd_rating r, letterboxd_synced_at s FROM visits WHERE id = ?').get(v)).toMatchObject({ r: first.rating })
    expect(db.prepare('SELECT letterboxd_rating r FROM visits WHERE id = ?').get(far).r).toBeNull()
    expect(await syncRatings(db, { fetch: async () => ({ status: 500 }) })).toBe(0)
  })

  it('TMDB ist ohne Key ein No-Op, mit Key setzt es ID und Poster', async () => {
    expect(await enrich(db, { fetch: async () => { throw new Error('nie') }, apiKey: '' })).toBe(0)
    db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('delphi-lux', ?, '2099-01-01T20:00:00+01:00', 'yorck')").run(movieId)
    const fake = async () => ({ status: 200, json: async () => ({ results: [{ id: 42, title: 'Tag im Leben', release_date: '2026-03-01', poster_path: '/p.jpg', original_title: 'Day in Life', original_language: 'en' }] }) })
    expect(await enrich(db, { fetch: fake, apiKey: 'k' })).toBe(1)
    expect(db.prepare('SELECT tmdb_id, poster_url FROM movies WHERE id = ?').get(movieId)).toEqual({ tmdb_id: 42, poster_url: 'https://image.tmdb.org/t/p/w185/p.jpg' })
  })
})
