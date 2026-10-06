import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { enrich, pickTmdb } from '../src/tmdb.js'
import { runMigrations } from '../src/migrate.js'

const ok = (body) => ({ status: 200, json: async () => body, headers: new Headers() })
const MI = [
  { id: 575264, title: 'Mission: Impossible – Dead Reckoning Teil Eins', original_title: 'Mission: Impossible - Dead Reckoning Part One', release_date: '2023-07-08' },
  { id: 575265, title: 'Mission: Impossible – The Final Reckoning', original_title: 'Mission: Impossible - The Final Reckoning', release_date: '2025-05-17' },
]
const DUNE = [
  { id: 438631, title: 'Dune', original_title: 'Dune', release_date: '2021-09-15' },
  { id: 841, title: 'Der Wüstenplanet', original_title: 'Dune', release_date: '1984-12-14' },
]

describe('K19-AC02: Auswahl nach Evidenz, nicht erstes Ergebnis', () => {
  it('Fortsetzung: richtiger Teil statt erstem Treffer', () => {
    expect(pickTmdb(MI, { title: 'Mission: Impossible – The Final Reckoning', year: 2025 })).toMatchObject({ status: 'matched', hit: { id: 575265 } })
  })
  it('Remake: Jahr entscheidet; ohne Jahr und mehrdeutig → keine Zuordnung', () => {
    expect(pickTmdb(DUNE, { title: 'Dune', year: 1984 })).toMatchObject({ status: 'matched', hit: { id: 841 } })
    expect(pickTmdb(DUNE, { title: 'Dune', year: 2021 })).toMatchObject({ status: 'matched', hit: { id: 438631 } })
    expect(pickTmdb(DUNE, { title: 'Dune', year: null }, new Date('2040-01-01')).status).toBe('ambiguous')
  })
  it('kein Titeltreffer → not_found, auch wenn TMDB etwas liefert', () => {
    expect(pickTmdb([{ id: 1, title: 'Anderer Film', release_date: '2026-01-01' }], { title: 'Digger', year: 2026 }).status).toBe('not_found')
  })
})

describe('Retry-Zustand (K19-AC01/03/04/05)', () => {
  let app, db, users, cookie, id, calls, results
  const tmdb = async (url) => {
    calls.push(url)
    if (url.includes('/search/movie')) return ok({ results })
    return ok({ overview: 'Inhalt', release_date: '2026-10-08', runtime: 129, poster_path: '/p.jpg', original_title: 'Digger', credits: { crew: [], cast: [] } })
  }
  const get = () => request(app).get(`/api/movies/${id}`).set('Cookie', cookie)
  const row = () => db.prepare('SELECT tmdb_id, tmdb_status, tmdb_next_retry_at, tmdb_failures, details_fetched_at FROM movies WHERE id = ?').get(id)

  beforeEach(async () => {
    process.env.TMDB_API_KEY = 'k'
    calls = []
    results = []
    ;({ app, db, users } = setupTestApp({ fetch: (u) => tmdb(u) }))
    cookie = await loginCookie(app, users[0])
    id = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Digger', 'digger', 2026)").run().lastInsertRowid)
  })
  afterEach(() => { vi.useRealTimers(); delete process.env.TMDB_API_KEY })

  it('AC01: Fehltreffer läuft ab; nach dem Fenster wird neu gesucht und angereichert', async () => {
    setNow('2026-10-06T10:00:00Z')
    const a = (await get()).body
    expect(a.metadata).toMatchObject({ status: 'not_found' })
    expect(row()).toMatchObject({ tmdb_id: null, tmdb_status: 'not_found', details_fetched_at: null })
    const n = calls.length
    await get()
    expect(calls.length).toBe(n) // innerhalb des Fensters kein neuer Abruf
    results = [{ id: 99, title: 'Digger', release_date: '2026-10-08' }]
    setNow('2026-10-14T10:00:00Z')
    const b = (await get()).body
    expect(b).toMatchObject({ overview: 'Inhalt', letterboxd_url: 'https://letterboxd.com/tmdb/99/', metadata: { status: 'matched' } })
  })

  it('AC04: Ausfall → failed mit wachsendem Backoff; 429 stoppt den Lauf', async () => {
    setNow('2026-10-06T10:00:00Z')
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('x', 'X')").run()
    const id2 = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Zwei', 'zwei', 2026)").run().lastInsertRowid)
    for (const m of [id, id2]) db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('x', ?, '2099-01-01T20:00:00+01:00', 'yorck')").run(m)
    let hits = 0
    const limited = async () => { hits++; return { status: 429, headers: new Headers({ 'Retry-After': '120' }), json: async () => ({}) } }
    await enrich(db, { fetch: limited, apiKey: 'k' })
    expect(hits).toBe(1)
    const first = db.prepare('SELECT tmdb_status, tmdb_failures, tmdb_next_retry_at FROM movies WHERE tmdb_attempt_at IS NOT NULL').all()
    expect(first).toEqual([{ tmdb_status: 'failed', tmdb_failures: 1, tmdb_next_retry_at: '2026-10-06T10:02:00.000Z' }])
    const down = async () => { throw new Error('ECONNRESET') }
    setNow('2026-10-06T12:00:00Z')
    await enrich(db, { fetch: down, apiKey: 'k' })
    setNow('2026-10-06T15:00:00Z') // vor Ablauf des Backoffs: kein neuer Versuch
    await enrich(db, { fetch: down, apiKey: 'k' })
    const r = db.prepare('SELECT tmdb_failures, tmdb_next_retry_at FROM movies WHERE id = ?').get(id2)
    expect(r.tmdb_failures).toBe(2)
    expect(r.tmdb_next_retry_at).toBe('2026-10-06T16:00:00.000Z') // 12:00 + 2^2 h
  })

  it('AC04: Retry-Knopf sucht sofort neu, aber nicht im Minutentakt', async () => {
    setNow('2026-10-06T10:00:00Z')
    await get()
    results = [{ id: 99, title: 'Digger', release_date: '2026-10-08' }]
    expect((await request(app).post(`/api/movies/${id}/tmdb/retry`).set('Cookie', cookie)).status).toBe(429)
    setNow('2026-10-06T10:02:00Z')
    const r = await request(app).post(`/api/movies/${id}/tmdb/retry`).set('Cookie', cookie)
    expect(r.status).toBe(200)
    expect(r.body.metadata.status).toBe('matched')
    expect((await request(app).post(`/api/movies/${id}/tmdb/retry`)).status).toBe(401)
  })

  it('AC03: manuelle Zuordnung übersteht spätere Suche; AC05: Buchungen bleiben beim Film', async () => {
    setNow('2026-10-06T10:00:00Z')
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('x', 'X')").run()
    const sid = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('x', ?, '2099-01-01T20:00:00+01:00', 'yorck')").run(id).lastInsertRowid)
    const p = (await request(app).post('/api/proposals').set('Cookie', cookie).send({ movie_id: id, screening_ids: [sid] })).body
    const other = Number(db.prepare("INSERT INTO movies (title, norm_title, year, tmdb_id) VALUES ('Anders', 'anders', 2026, 555)").run().lastInsertRowid)
    expect((await request(app).put(`/api/movies/${id}/tmdb`).set('Cookie', cookie).send({ tmdb_id: 555 })).status).toBe(409)
    const put = await request(app).put(`/api/movies/${id}/tmdb`).set('Cookie', cookie).send({ tmdb_id: 77 })
    expect(put.status).toBe(200)
    expect(put.body.metadata.status).toBe('manual')
    results = [{ id: 99, title: 'Digger', release_date: '2026-10-08' }]
    setNow('2026-12-01T10:00:00Z')
    await enrich(db, { fetch: tmdb, apiKey: 'k' })
    await get()
    expect(row()).toMatchObject({ tmdb_id: 77, tmdb_status: 'manual' })
    const q = (await request(app).get('/api/proposals').set('Cookie', cookie)).body.proposals[0]
    expect(q.movie.id).toBe(id)
    expect(q.options[0].snapshot).toEqual(p.options[0].snapshot)
    expect(db.prepare('SELECT tmdb_id FROM movies WHERE id = ?').get(other).tmdb_id).toBe(555)
    expect((await request(app).put(`/api/movies/${id}/tmdb`).set('Cookie', cookie).send({ tmdb_id: 'x' })).status).toBe(422)
  })
})

describe('Migration 012 auf befüllter DB', () => {
  it('alte Dauer-Fehltreffer werden wieder versuchbar; Treffer bleiben', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '011_cal_token_controls.sql' })
    db.prepare("INSERT INTO movies (id, title, norm_title, details_fetched_at) VALUES (1, 'Miss', 'miss', '2026-01-01 10:00:00')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title, tmdb_id, details_fetched_at) VALUES (2, 'Hit', 'hit', 5, '2026-01-01 10:00:00')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (3, 'Neu', 'neu')").run()
    runMigrations(db)
    expect(db.prepare('SELECT id, tmdb_id, tmdb_status, details_fetched_at, tmdb_next_retry_at FROM movies ORDER BY id').all()).toEqual([
      { id: 1, tmdb_id: null, tmdb_status: 'not_found', details_fetched_at: null, tmdb_next_retry_at: null },
      { id: 2, tmdb_id: 5, tmdb_status: 'matched', details_fetched_at: '2026-01-01 10:00:00', tmdb_next_retry_at: null },
      { id: 3, tmdb_id: null, tmdb_status: null, details_fetched_at: null, tmdb_next_retry_at: null },
    ])
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
