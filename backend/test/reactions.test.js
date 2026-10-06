import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { runMigrations } from '../src/migrate.js'

// K35: Reaktionen, privat per Standard, gemeinsam aufdecken, spoilerfrei in Vorschauen/Exporten.
describe('K35 Reaktionen', () => {
  let app, db, users, c1, c2, eve, pid, v1, v2
  const SPOILER = 'Am Ende ist er tot'
  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    setNow('2099-10-01T10:00:00Z')
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
    const eveId = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync('password9', 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(eveId)
    eve = await loginCookie(app, { email: 'eve@example.com', password: 'password9' })
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('zoo-palast', 'Zoo Palast')").run()
    const mid = Number(db.prepare("INSERT INTO movies (title, norm_title, year, runtime) VALUES ('Digger', 'digger', 2099, 100)").run().lastInsertRowid)
    const sid = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('zoo-palast', ?, '2099-10-02T20:00:00+02:00', 'zoopalast')").run(mid).lastInsertRowid)
    const p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: mid, screening_ids: [sid] })).body
    pid = p.id
    await request(app).put(`/api/proposals/${pid}/votes/${p.options[0].id}`).set('Cookie', c2).send({ value: 'yes' }).expect(204)
    await request(app).post(`/api/proposals/${pid}/book`).set('Cookie', c1).send({ option_id: p.options[0].id }).expect(200)
    setNow('2099-10-03T10:00:00Z')
    const visits = (await request(app).get('/api/visits').set('Cookie', c1)).body.visits
    v1 = visits.find((v) => v.user_id === 1).id
    v2 = visits.find((v) => v.user_id === 2).id
  })
  afterEach(() => vi.useRealTimers())
  const put = (vid, body, c) => request(app).put(`/api/visits/${vid}/reaction`).set('Cookie', c).send(body)
  const list = async (vid, c) => (await request(app).get(`/api/visits/${vid}/reactions`).set('Cookie', c).expect(200)).body

  it('AC01/AC02: unaufgedeckte Reaktionen fehlen im Payload, bis man selbst (nicht privat) reagiert hat', async () => {
    await put(v1, { line: SPOILER, spoiler: true, visibility: 'reveal' }, c1).expect(200)
    const before = await list(v2, c2)
    expect(before).toEqual({ reactions: [], waiting: 1 })
    expect(JSON.stringify(before)).not.toContain('tot')
    await put(v2, { line: 'Zu lang', visibility: 'private' }, c2).expect(200)
    expect((await list(v2, c2)).reactions.map((r) => r.line)).toEqual(['Zu lang']) // privat deckt nicht auf
    await put(v2, { line: 'Zu lang', visibility: 'reveal' }, c2).expect(200)
    expect((await list(v2, c2)).reactions).toEqual([
      { visit_id: v1, mine: false, user_name: 'tuncay', line: SPOILER, spoiler: true, visibility: 'reveal' },
      { visit_id: v2, mine: true, user_name: 'kim', line: 'Zu lang', spoiler: false, visibility: 'reveal' },
    ])
    // Rücknahme (privat) wirkt sofort
    await put(v1, { line: SPOILER, spoiler: true, visibility: 'private' }, c1).expect(200)
    expect((await list(v2, c2)).reactions.map((r) => r.mine)).toEqual([true])
    expect((await request(app).get(`/api/visits/${v1}/reactions`).set('Cookie', eve)).status).toBe(404)
  })

  it('AC03: Spoiler stehen nicht in Besuchsliste, Wrapped, Vorschlag oder Kalender-Feed', async () => {
    await put(v1, { line: SPOILER, spoiler: true, visibility: 'household' }, c1).expect(200)
    const outputs = [
      (await request(app).get('/api/visits').set('Cookie', c2)).text,
      (await request(app).get('/api/stats/wrapped?year=2099&scope=group').set('Cookie', c2)).text,
      (await request(app).get(`/api/proposals/${pid}`).set('Cookie', c2)).text,
      (await request(app).get(`/api/proposals/${pid}.ics`).set('Cookie', c2)).text,
    ]
    const feed = (await request(app).post('/api/cal/token').set('Cookie', c2).send({})).body.https_url
    outputs.push((await request(app).get(new URL(feed).pathname)).text)
    for (const o of outputs) expect(o).not.toContain('tot')
  })

  it('AC04: nur Besitzer bearbeitet/löscht; Löschen des Besuchs entfernt die Reaktion', async () => {
    expect((await put(v1, { line: 'x' }, c2)).status).toBe(403)
    expect((await put(v1, { line: 'x' }, eve)).status).toBe(404)
    expect((await put(v1, { line: '' }, c1)).status).toBe(422)
    expect((await put(v1, { line: 'x', visibility: 'public' }, c1)).status).toBe(422)
    await put(v1, { line: 'gut' }, c1).expect(200)
    expect((await list(v1, c1)).reactions[0]).toMatchObject({ line: 'gut', visibility: 'private' }) // Standard privat
    expect((await request(app).delete(`/api/visits/${v1}/reaction`).set('Cookie', c2)).status).toBe(403)
    await request(app).delete(`/api/visits/${v1}/reaction`).set('Cookie', c1).expect(204)
    expect((await list(v1, c1)).reactions).toEqual([])
    await put(v1, { line: 'nochmal', visibility: 'household' }, c1).expect(200)
    await request(app).delete(`/api/visits/${v1}`).set('Cookie', c1).expect(204)
    expect(db.prepare('SELECT COUNT(*) n FROM visit_reactions').get().n).toBe(0)
  })

  it('AC05: Reaktion und Bewertungen (eigene/Letterboxd) überschreiben sich nicht', async () => {
    db.prepare('UPDATE visits SET letterboxd_rating = 3 WHERE id = ?').run(v1)
    await put(v1, { line: 'gut' }, c1).expect(200)
    await request(app).patch(`/api/visits/${v1}`).set('Cookie', c1).send({ manual_rating: 4.5 }).expect(200)
    expect(db.prepare('SELECT letterboxd_rating, manual_rating FROM visits WHERE id = ?').get(v1)).toEqual({ letterboxd_rating: 3, manual_rating: 4.5 })
    expect(db.prepare('SELECT line FROM visit_reactions WHERE visit_id = ?').get(v1).line).toBe('gut')
    await put(v1, { line: 'doch mittel' }, c1).expect(200)
    expect(db.prepare('SELECT letterboxd_rating, manual_rating FROM visits WHERE id = ?').get(v1)).toEqual({ letterboxd_rating: 3, manual_rating: 4.5 })
  })
})

describe('Migration 024 auf befüllter DB', () => {
  it('additiv; Besuche unverändert', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '023_ticket_files.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'a', 'a@example.com', 'x')").run()
    db.prepare("INSERT INTO visits (id, user_id, household_id, snapshot_json, watched_on, note, manual_rating) VALUES (3, 1, 1, '{}', '2026-01-01', 'n', 4)").run()
    runMigrations(db)
    expect(db.prepare('SELECT note, manual_rating FROM visits').get()).toEqual({ note: 'n', manual_rating: 4 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
