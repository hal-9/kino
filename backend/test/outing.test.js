import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie } from './helpers.js'
import { runMigrations } from '../src/migrate.js'

// K17: Treffpunkt einer gebuchten Vorstellung.
describe('K17 Treffpunkt', () => {
  let app, db, users, c1, eve, p
  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
    const eveId = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync('password9', 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(eveId)
    eve = await loginCookie(app, { email: 'eve@example.com', password: 'password9' })
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('delphi-lux', 'Delphi LUX')").run()
    const mid = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Digger', 'digger', 2026)").run().lastInsertRowid)
    const sid = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('delphi-lux', ?, '2099-10-13T20:15:00+02:00', 'yorck')").run(mid).lastInsertRowid)
    p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: mid, screening_ids: [sid] })).body
  })
  const meet = (body, cookie = c1) => request(app).put(`/api/proposals/${p.id}/meeting`).set('Cookie', cookie).send(body)
  const body = { meet_at: '2099-10-13T19:45:00+02:00', meet_place: 'Vor dem Eingang', outing_note: 'Popcorn teilen' }

  it('nur gebucht; Revision + Verlauf ohne Inhalt; Snapshot unverändert; Validierung', async () => {
    expect((await meet(body)).status).toBe(409)
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id }).expect(200)
    const snap = db.prepare('SELECT snapshot_json FROM proposal_options').get().snapshot_json
    expect((await meet({ ...body, meet_at: '19:45' })).status).toBe(422)
    expect((await meet({ ...body, outing_note: 'x'.repeat(301) })).status).toBe(422)
    expect((await meet({ ...body, revision: 1 })).status).toBe(409)
    const r = await meet({ ...body, revision: 2 })
    expect(r.body).toMatchObject({ revision: 3, meeting: body })
    expect(db.prepare('SELECT snapshot_json FROM proposal_options').get().snapshot_json).toBe(snap)
    expect(JSON.stringify(db.prepare("SELECT * FROM proposal_events WHERE action = 'meeting'").all())).not.toContain('Eingang')
    expect((await meet({ meet_at: null, meet_place: null, outing_note: null })).body.meeting).toEqual({ meet_at: null, meet_place: null, outing_note: null })
  })

  it('AC04: fremder Haushalt kann weder lesen noch ändern', async () => {
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id, ticket_link: 'https://tickets.example/qr' }).expect(200)
    expect((await meet(body, eve)).status).toBe(404)
    expect(db.prepare('SELECT meet_place FROM proposals').get().meet_place).toBeNull()
    expect((await request(app).get(`/api/proposals/${p.id}`).set('Cookie', eve)).status).toBe(404)
  })
})

describe('Migration 016 auf befüllter DB', () => {
  it('nur neue leere Spalten, Integrität ok', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '015_proposal_participants.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'a', 'a@example.com', 'x')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'Digger', 'digger')").run()
    db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by, status) VALUES (5, 1, 7, 1, 'booked')").run()
    runMigrations(db)
    expect(db.prepare('SELECT id, status, meet_at, meet_place, outing_note FROM proposals').all()).toEqual([{ id: 5, status: 'booked', meet_at: null, meet_place: null, outing_note: null }])
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
