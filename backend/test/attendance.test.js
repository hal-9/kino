import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { runMigrations } from '../src/migrate.js'

// K18: abgeleitete Besuche bestätigen/korrigieren/„nicht dabei“, ohne Idempotenz und Grabsteine zu brechen.
describe('K18 Anwesenheit', () => {
  let app, db, users, c1, c2, eve, p

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
    const eveId = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync('password9', 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(eveId)
    eve = await loginCookie(app, { email: 'eve@example.com', password: 'password9' })
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('delphi-lux', 'Delphi LUX')").run()
    const mid = Number(db.prepare("INSERT INTO movies (title, norm_title, year, runtime) VALUES ('Digger', 'digger', 2026, 100)").run().lastInsertRowid)
    const ins = db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, auditorium, source) VALUES ('delphi-lux', ?, ?, 'Kino 2', 'yorck')")
    const shows = ['2020-10-04T20:00:00+02:00', '2020-10-05T20:00:00+02:00'].map((t) => Number(ins.run(mid, t).lastInsertRowid))
    setNow('2020-10-01T10:00:00Z')
    p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: mid, screening_ids: shows })).body
    await request(app).put(`/api/proposals/${p.id}/votes/${p.options[0].id}`).set('Cookie', c2).send({ value: 'yes' }).expect(204)
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id }).expect(200)
  })
  afterEach(() => vi.useRealTimers())

  const visits = async (cookie = c1) => (await request(app).get('/api/visits').set('Cookie', cookie)).body.visits
  const mine = async (cookie, uid) => (await visits(cookie)).find((v) => v.user_id === uid)

  it('AC01: wiederholtes Materialisieren → genau ein abgeleiteter Besuch je Person', async () => {
    setNow('2020-10-10T10:00:00Z')
    for (let i = 0; i < 3; i++) await visits()
    await request(app).get('/api/stats/wrapped?year=2020&scope=group').set('Cookie', c2)
    const rows = db.prepare('SELECT user_id, attendance FROM visits ORDER BY user_id').all()
    expect(rows).toEqual([{ user_id: 1, attendance: 'inferred' }, { user_id: 2, attendance: 'inferred' }])
  })

  it('AC02: gelöscht und „nicht dabei“ kommen nicht wieder; nicht offen', async () => {
    setNow('2020-10-10T10:00:00Z')
    const a = await mine(c1, 1)
    const b = await mine(c2, 2)
    await request(app).delete(`/api/visits/${a.id}`).set('Cookie', c1).expect(204)
    await request(app).post(`/api/visits/${b.id}/skip`).set('Cookie', c2).expect(204)
    for (let i = 0; i < 2; i++) await visits()
    expect(db.prepare('SELECT COUNT(*) n FROM visits').get().n).toBe(0)
    expect(db.prepare('SELECT user_id, skipped_at IS NOT NULL AS skipped FROM auto_visits ORDER BY user_id').all()).toEqual([
      { user_id: 1, skipped: 0 }, { user_id: 2, skipped: 1 },
    ])
    expect((await request(app).get('/api/visits/pending').set('Cookie', c2)).body.pending).toHaveLength(0)
  })

  it('AC03: Bestätigung und Korrektur überleben weitere Läufe', async () => {
    setNow('2020-10-10T10:00:00Z')
    const a = await mine(c1, 1)
    const b = await mine(c2, 2)
    expect((await request(app).post(`/api/visits/${a.id}/confirm`).set('Cookie', c1)).body.attendance).toBe('confirmed')
    const fixed = await request(app).patch(`/api/visits/${b.id}`).set('Cookie', c2).send({ row: '9', watched_on: '2020-10-04' })
    expect(fixed.body).toMatchObject({ attendance: 'confirmed', row: '9' })
    await visits()
    expect(db.prepare('SELECT user_id, attendance, row FROM visits ORDER BY user_id').all()).toEqual([
      { user_id: 1, attendance: 'confirmed', row: null }, { user_id: 2, attendance: 'confirmed', row: '9' },
    ])
    // Stattgefundene Buchung lässt sich nicht still verlegen.
    expect((await request(app).post(`/api/proposals/${p.id}/reschedule`).set('Cookie', c1).send({ option_id: p.options[1].id })).status).toBe(409)
    expect((await request(app).post(`/api/proposals/${p.id}/reopen`).set('Cookie', c1).send({})).body.error).toBe('completed')
  })

  it('AC04: fremder Besitzer/Haushalt kann nicht bestätigen, überspringen, ändern', async () => {
    setNow('2020-10-10T10:00:00Z')
    const a = await mine(c1, 1)
    expect((await request(app).post(`/api/visits/${a.id}/confirm`).set('Cookie', c2)).status).toBe(403)
    expect((await request(app).post(`/api/visits/${a.id}/skip`).set('Cookie', c2)).status).toBe(403)
    expect((await request(app).post(`/api/visits/${a.id}/confirm`).set('Cookie', eve)).status).toBe(404)
    expect((await request(app).post(`/api/visits/${a.id}/skip`).set('Cookie', eve)).status).toBe(404)
    expect(db.prepare('SELECT attendance FROM visits WHERE id = ?').get(a.id).attendance).toBe('inferred')
  })
})

describe('Migration 017 auf befüllter DB (AC05)', () => {
  it('alte Auto-Besuche werden legacy, eigene manual; nichts verschwindet, Grabsteine bleiben', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '016_outing_meeting.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'a', 'a@example.com', 'x'), (2, 'b', 'b@example.com', 'x')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'Digger', 'digger')").run()
    db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by, status) VALUES (5, 1, 7, 1, 'booked')").run()
    db.prepare("INSERT INTO auto_visits (proposal_id, user_id) VALUES (5, 1), (5, 2)").run() // 2 hat gelöscht
    const v = db.prepare("INSERT INTO visits (id, user_id, household_id, proposal_id, movie_id, snapshot_json, watched_on) VALUES (?, ?, 1, ?, 7, '{}', '2026-01-01')")
    v.run(1, 1, 5); v.run(2, 2, null)
    runMigrations(db)
    expect(db.prepare('SELECT id, attendance FROM visits ORDER BY id').all()).toEqual([{ id: 1, attendance: 'legacy' }, { id: 2, attendance: 'manual' }])
    expect(db.prepare('SELECT COUNT(*) n FROM auto_visits WHERE skipped_at IS NULL').get().n).toBe(2)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
