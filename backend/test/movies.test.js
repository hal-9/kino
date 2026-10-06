import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie } from './helpers.js'

const json = (body) => ({ status: 200, json: async () => body })

describe('Film-Details', () => {
  let app, db, cookie, id, calls

  const setup = (fetchImpl) => {
    process.env.TMDB_API_KEY = 'k'
    const t = setupTestApp({ fetch: fetchImpl })
    ;({ app, db } = t)
    id = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Digger', 'digger', 2026)").run().lastInsertRowid)
    return loginCookie(app, t.users[0]).then((c) => (cookie = c))
  }
  const tmdb = async (url) => {
    calls.push(url)
    if (url.includes('/search/movie')) return json({ results: [{ id: 99, title: 'Digger', release_date: '2026-10-08' }] })
    if (url.includes('language=de-DE')) {
      return json({ overview: '', release_date: '2026-10-08', runtime: 129, poster_path: '/p.jpg', original_title: 'Digger', original_language: 'en',
        credits: { crew: [{ job: 'Producer', name: 'P' }, { job: 'Director', name: 'Regie Person' }], cast: Array.from({ length: 8 }, (_, i) => ({ name: `Actor ${i}` })) } })
    }
    return json({ overview: 'English synopsis' })
  }
  beforeEach(() => { calls = [] })

  it('holt Details einmal von TMDB (de, Fallback en) und cached sie', async () => {
    await setup(tmdb)
    const a = (await request(app).get(`/api/movies/${id}`).set('Cookie', cookie)).body
    expect(a).toMatchObject({
      overview: 'English synopsis', director: 'Regie Person', release_date: '2026-10-08', runtime: 129,
      poster_url: 'https://image.tmdb.org/t/p/w342/p.jpg', letterboxd_url: 'https://letterboxd.com/tmdb/99/',
    })
    expect(a.cast).toHaveLength(6)
    const n = calls.length
    await request(app).get(`/api/movies/${id}`).set('Cookie', cookie)
    expect(calls.length).toBe(n)
  })

  it('ohne Key oder bei TMDB-Fehler: Grunddaten, kein Cache, Letterboxd-Suche', async () => {
    await setup(async () => { throw new Error('down') })
    const a = (await request(app).get(`/api/movies/${id}`).set('Cookie', cookie)).body
    expect(a).toMatchObject({ title: 'Digger', overview: null, cast: [], letterboxd_url: 'https://letterboxd.com/search/Digger/' })
    expect(db.prepare('SELECT details_fetched_at d FROM movies WHERE id = ?').get(id).d).toBeNull()
    delete process.env.TMDB_API_KEY
    expect((await request(app).get(`/api/movies/${id}`).set('Cookie', cookie)).status).toBe(200)
  })

  it('404 und Auth', async () => {
    await setup(tmdb)
    expect((await request(app).get('/api/movies/99999').set('Cookie', cookie)).status).toBe(404)
    expect((await request(app).get(`/api/movies/${id}`)).status).toBe(401)
  })
})
