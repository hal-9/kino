import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie } from './helpers.js'
import { runMigrations } from '../src/migrate.js'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('Idempotency-Key für Anlegen (K07-AC03)', () => {
  let app, db, users, c1, c2, movieId, show

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('delphi-lux', 'Delphi LUX')").run()
    movieId = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Digger', 'digger', 2026)").run().lastInsertRowid)
    show = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('delphi-lux', ?, '2099-10-13T20:15:00+02:00', 'yorck')").run(movieId).lastInsertRowid)
  })

  const propose = (key, note = 'a', cookie = c1) =>
    request(app).post('/api/proposals').set('Cookie', cookie).set('Idempotency-Key', key).send({ movie_id: movieId, screening_ids: [show], note })
  const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n

  it('identische Wiederholung liefert das Original, legt nichts doppelt an', async () => {
    const a = await propose('key-00000001')
    const b = await propose('key-00000001')
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(b.body.id).toBe(a.body.id)
    expect(count('proposals')).toBe(1)
  })

  it('gleicher Key mit anderem Inhalt → 409, anderer Nutzer hat eigenen Namensraum', async () => {
    await propose('key-00000002', 'a')
    const conflict = await propose('key-00000002', 'b')
    expect(conflict.status).toBe(409)
    expect(conflict.body.error).toBe('idempotency key reused')
    expect((await propose('key-00000002', 'a', c2)).status).toBe(201)
    expect(count('proposals')).toBe(2)
  })

  it('fehlgeschlagene Anfrage wird nicht gespeichert; ohne Key unverändert', async () => {
    db.prepare("UPDATE screenings SET starts_at = '2000-01-01T20:00:00+01:00'").run()
    expect((await propose('key-00000003')).status).toBe(409)
    db.prepare("UPDATE screenings SET starts_at = '2099-10-13T20:15:00+02:00'").run()
    expect((await propose('key-00000003')).status).toBe(201)
    expect((await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: movieId, screening_ids: [show] })).status).toBe(201)
    expect((await propose('bad key!')).status).toBe(422)
  })

  it('Besuch anlegen ist ebenfalls idempotent', async () => {
    const body = { title: 'Digger', cinema_key: 'delphi-lux', watched_on: '2026-10-01' }
    const a = await request(app).post('/api/visits').set('Cookie', c1).set('Idempotency-Key', 'visit-0001').send(body)
    const b = await request(app).post('/api/visits').set('Cookie', c1).set('Idempotency-Key', 'visit-0001').send(body)
    expect(a.status).toBe(201)
    expect(b.body.id).toBe(a.body.id)
    expect(count('visits')).toBe(1)
  })
})

describe('Migration 009 auf befüllter DB', () => {
  it('fügt nur die Tabelle hinzu, Daten unverändert, Integrität ok', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '008_sync_lease.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'tuncay', 't@example.com', 'x')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'Digger', 'digger')").run()
    db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by) VALUES (5, 1, 7, 1)").run()
    runMigrations(db)
    expect(db.prepare('SELECT id FROM proposals').all()).toEqual([{ id: 5 }])
    expect(db.prepare('SELECT COUNT(*) n FROM idempotency_keys').get().n).toBe(0)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
