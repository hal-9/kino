import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie } from './helpers.js'
import { runMigrations } from '../src/migrate.js'

// K15: feste Teilnehmer-Kohorte je Vorschlag.
describe('K15 Kohorte', () => {
  let app, db, users, c1, movieId, show

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('delphi-lux', 'Delphi LUX')").run()
    movieId = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Digger', 'digger', 2026)").run().lastInsertRowid)
    show = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('delphi-lux', ?, '2099-10-13T20:15:00+02:00', 'yorck')").run(movieId).lastInsertRowid)
  })

  it('AC03: später beigetretenes Mitglied verschiebt den Nenner nicht; eigene Stimme nimmt es ausdrücklich auf', async () => {
    const p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: movieId, screening_ids: [show] })).body
    expect(p.participants).toEqual([1, 2])
    const id = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('lia', 'lia@example.com', ?)").run(bcrypt.hashSync('password3', 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (1, ?)').run(id)
    const get = async () => (await request(app).get(`/api/proposals/${p.id}`).set('Cookie', c1)).body.proposal
    expect((await get()).participants).toEqual([1, 2])
    const c3 = await loginCookie(app, { email: 'lia@example.com', password: 'password3' })
    await request(app).put(`/api/proposals/${p.id}/votes/${p.options[0].id}`).set('Cookie', c3).send({ value: 'yes' }).expect(204)
    expect((await get()).participants).toEqual([1, 2, id])
    expect(db.prepare('SELECT source FROM proposal_participants WHERE user_id = ?').get(id).source).toBe('vote')
  })

  it('AC02: Schweigen ist keine Stimme', async () => {
    const p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: movieId, screening_ids: [show] })).body
    expect(p.options[0].votes).toEqual({ 1: 'yes' }) // kim: kein Eintrag, nicht 'yes'/'no'
  })
})

describe('Migration 015 auf befüllter DB', () => {
  it('füllt Kohorte aus Mitgliedschaft zum Anlegezeitpunkt und Stimmen; Integrität ok', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '014_option_changes.sql' })
    const user = db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (?, ?, ?, 'x')")
    user.run(1, 'a', 'a@example.com'); user.run(2, 'b', 'b@example.com'); user.run(3, 'c', 'c@example.com')
    const join = db.prepare('INSERT INTO household_members (household_id, user_id, joined_at) VALUES (1, ?, ?)')
    join.run(1, '2026-01-01 10:00:00'); join.run(2, '2026-01-01 10:00:00'); join.run(3, '2026-06-01 10:00:00')
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'Digger', 'digger')").run()
    db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by, created_at) VALUES (5, 1, 7, 1, '2026-03-01 10:00:00')").run()
    db.prepare("INSERT INTO proposal_options (id, proposal_id, snapshot_json) VALUES (21, 5, '{}')").run()
    db.prepare("INSERT INTO votes (option_id, user_id, value) VALUES (21, 1, 'yes')").run()
    runMigrations(db)
    expect(db.prepare('SELECT user_id, source FROM proposal_participants ORDER BY user_id').all()).toEqual([
      { user_id: 1, source: 'legacy' }, { user_id: 2, source: 'legacy' },
    ])
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
