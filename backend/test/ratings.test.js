import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import Database from 'better-sqlite3'
import { setupTestApp, loginCookie } from './helpers.js'
import { syncRatings, parseRss } from '../src/letterboxd.js'
import { runMigrations } from '../src/migrate.js'

// Synthetischer Feed: guid = stabile Eintrags-ID.
const item = ({ guid, date, title = 'Digger', rating = 4, tmdb = 99 }) =>
  `<item><guid isPermaLink="false">${guid}</guid><letterboxd:watchedDate>${date}</letterboxd:watchedDate>` +
  `<letterboxd:filmTitle>${title}</letterboxd:filmTitle>${rating ? `<letterboxd:memberRating>${rating}</letterboxd:memberRating>` : ''}` +
  `${tmdb ? `<tmdb:movieId>${tmdb}</tmdb:movieId>` : ''}</item>`
const feed = (...items) => `<rss><channel>${items.map(item).join('')}</channel></rss>`
const serve = (xml) => async () => ({ status: 200, text: async () => xml })

describe('K20 Letterboxd-Abgleich', () => {
  let app, db, users, c1, movie, feedXml

  beforeEach(async () => {
    feedXml = feed()
    ;({ app, db, users } = setupTestApp({ fetch: async (url) => serve(feedXml)(url) }))
    c1 = await loginCookie(app, users[0])
    movie = Number(db.prepare("INSERT INTO movies (title, norm_title, year, tmdb_id) VALUES ('Digger', 'digger', 2026, 99)").run().lastInsertRowid)
    db.prepare("UPDATE users SET letterboxd_user = 'tuncay' WHERE id = 1").run()
  })

  const visit = (date, user = 1) =>
    Number(db.prepare("INSERT INTO visits (user_id, household_id, movie_id, snapshot_json, watched_on) VALUES (?, 1, ?, '{\"title\":\"Digger\"}', ?)").run(user, movie, date).lastInsertRowid)
  const row = (id) => db.prepare('SELECT letterboxd_rating r, letterboxd_entry e, letterboxd_account a, manual_rating m FROM visits WHERE id = ?').get(id)
  const sync = (xml) => syncRatings(db, { fetch: serve(xml) })

  it('Fixture parst guid; Einträge ohne Bewertung bleiben mit rating null erhalten', () => {
    const rss = fs.readFileSync(new URL('./fixtures/letterboxd-rss.xml', import.meta.url), 'utf8')
    expect(parseRss(rss).map((i) => i.guid)).toEqual(['letterboxd-review-1524499753', 'letterboxd-review-1520715996', 'letterboxd-review-1518290715'])
    expect(parseRss(feed({ guid: 'g', date: '2026-10-04', rating: 0 }))[0]).toMatchObject({ guid: 'g', rating: null })
  })

  it('AC01: geänderte und entfernte Bewertung desselben Eintrags wird übernommen; späterer Erst-Bewertung auch', async () => {
    const v = visit('2026-10-04')
    await sync(feed({ guid: 'g1', date: '2026-10-04', rating: 3 }))
    expect(row(v)).toMatchObject({ r: 3, e: 'g1', a: 'tuncay' })
    await sync(feed({ guid: 'g1', date: '2026-10-04', rating: 4.5 }))
    expect(row(v).r).toBe(4.5)
    await sync(feed({ guid: 'g1', date: '2026-10-04', rating: 0 }))
    expect(row(v).r).toBeNull()
  })

  it('AC02: aus dem Feed gefallener Eintrag löscht die Bewertung nicht; Fehler ändern nichts', async () => {
    const v = visit('2026-10-04')
    await sync(feed({ guid: 'g1', date: '2026-10-04', rating: 3 }))
    await sync(feed({ guid: 'g9', date: '2026-12-01', title: 'Anderes', tmdb: 5 }))
    expect(row(v)).toMatchObject({ r: 3, e: 'g1' })
    expect(await syncRatings(db, { fetch: async () => ({ status: 500 }) })).toBe(0)
    expect(row(v).r).toBe(3)
    expect(db.prepare('SELECT letterboxd_error FROM users WHERE id = 1').get().letterboxd_error).toBe('HTTP 500')
  })

  it('AC03: Rewatch/zwei Einträge → nichts verknüpft (unklar); Kontowechsel hängt nicht um', async () => {
    const a = visit('2026-10-04')
    const b = visit('2026-10-05')
    await sync(feed({ guid: 'g1', date: '2026-10-04', rating: 3 }, { guid: 'g2', date: '2026-10-05', rating: 5 }))
    expect([row(a).e, row(b).e]).toEqual([null, null])
    expect(JSON.parse(db.prepare('SELECT letterboxd_status_json s FROM users WHERE id = 1').get().s)).toMatchObject({ ambiguous: 2, linked: 0 })

    db.prepare('DELETE FROM visits WHERE id = ?').run(b)
    await sync(feed({ guid: 'g1', date: '2026-10-04', rating: 3 }))
    expect(row(a)).toMatchObject({ e: 'g1', r: 3 })
    // Neues Konto mit eigenem Eintrag am selben Tag: alte Verknüpfung bleibt, Wert unverändert.
    await request(app).patch('/api/me').set('Cookie', c1).send({ letterboxd_user: 'jemand' }).expect(200)
    await sync(feed({ guid: 'x1', date: '2026-10-04', rating: 1 }))
    expect(row(a)).toMatchObject({ e: 'g1', a: 'tuncay', r: 3 })
    expect((await request(app).get('/api/settings').set('Cookie', c1)).body.letterboxd.other_account).toBe(1)
  })

  it('AC03: TMDB-IDs entscheiden bei gleichem Titel (Remake)', async () => {
    const v = visit('2026-10-04')
    await sync(feed({ guid: 'g1', date: '2026-10-04', tmdb: 12345 }))
    expect(row(v).e).toBeNull()
  })

  it('AC04: eigene Bewertung bleibt über Abgleiche, bis sie zurückgesetzt wird', async () => {
    const v = visit('2026-10-04')
    db.prepare("UPDATE visits SET companions_json = '[2]' WHERE id = ?").run(v)
    await sync(feed({ guid: 'g1', date: '2026-10-04', rating: 3 }))
    const set = await request(app).patch(`/api/visits/${v}`).set('Cookie', c1).send({ manual_rating: 5 })
    expect(set.body).toMatchObject({ manual_rating: 5, letterboxd_rating: 3, rating: 5 })
    expect(set.body.companions).toEqual([2])
    await sync(feed({ guid: 'g1', date: '2026-10-04', rating: 2 }))
    let got = (await request(app).get('/api/visits').set('Cookie', c1)).body.visits[0]
    expect(got).toMatchObject({ manual_rating: 5, letterboxd_rating: 2, rating: 5 })
    expect((await request(app).patch(`/api/visits/${v}`).set('Cookie', c1).send({ manual_rating: 4.3 })).status).toBe(422)
    const c2 = await loginCookie(app, users[1])
    expect((await request(app).patch(`/api/visits/${v}`).set('Cookie', c2).send({ manual_rating: 1 })).status).toBe(403)
    got = (await request(app).patch(`/api/visits/${v}`).set('Cookie', c1).send({ manual_rating: null })).body
    expect(got).toMatchObject({ manual_rating: null, rating: 2 })
  })

  it('AC05: Abgleich nur eigenes Konto, angemeldet, max. 1/min, Status sichtbar', async () => {
    const v = visit('2026-10-04')
    const other = visit('2026-10-04', 2)
    db.prepare("UPDATE users SET letterboxd_user = 'kim' WHERE id = 2").run()
    await request(app).post('/api/letterboxd/resync').expect(401)
    feedXml = feed({ guid: 'g1', date: '2026-10-04', rating: 4 })
    const res = await request(app).post('/api/letterboxd/resync').set('Cookie', c1).expect(200)
    expect(res.body).toMatchObject({ error: null, from: '2026-10-04', to: '2026-10-04', linked: 1 })
    expect(row(v).r).toBe(4)
    expect(row(other).r).toBeNull()
    expect((await request(app).post('/api/letterboxd/resync').set('Cookie', c1)).status).toBe(429)
    // Fehler: Status zeigt ihn, nächster Versuch nach einer Minute möglich.
    db.prepare("UPDATE users SET letterboxd_attempt_at = '2000-01-01T00:00:00Z' WHERE id = 1").run()
    feedXml = null
    const fail = await request(app).post('/api/letterboxd/resync').set('Cookie', c1).expect(200)
    expect(fail.body.error).toBeTruthy()
    expect(row(v).r).toBe(4)
  })
})

describe('Migration 018 auf befüllter DB', () => {
  it('alte Importe behalten Wert und bekommen Konto als Herkunft; Integrität ok', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '017_visit_attendance.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest, letterboxd_user) VALUES (1, 'a', 'a@example.com', 'x', 'alt')").run()
    const v = db.prepare("INSERT INTO visits (id, user_id, household_id, snapshot_json, watched_on, letterboxd_rating) VALUES (?, 1, 1, '{}', '2026-01-01', ?)")
    v.run(1, 3.5); v.run(2, null)
    runMigrations(db)
    expect(db.prepare('SELECT id, letterboxd_rating r, letterboxd_account a, letterboxd_entry e, manual_rating m FROM visits ORDER BY id').all()).toEqual([
      { id: 1, r: 3.5, a: 'alt', e: null, m: null }, { id: 2, r: null, a: null, e: null, m: null },
    ])
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
