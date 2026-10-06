import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'
import { setupTestApp, loginCookie } from './helpers.js'
import { runMigrations } from '../src/migrate.js'
import { createApp } from '../src/app.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const deployDir = path.join(here, '..', '..', 'deploy')

// Haushalt 1 (tuncay, kim) mit Vorschlag, Buchung, Stimme, Besuch; Haushalt 2 (eve) als Angreifer.
async function world() {
  const t = setupTestApp()
  const { app, db, users } = t
  const pw = crypto.randomUUID()
  db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
  const eveId = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync(pw, 4)).lastInsertRowid)
  db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(eveId)
  const c1 = await loginCookie(app, users[0])
  const c2 = await loginCookie(app, users[1])
  const eve = await loginCookie(app, { email: 'eve@example.com', password: pw })
  db.prepare("INSERT INTO cinemas (key, name) VALUES ('delphi-lux', 'Delphi LUX')").run()
  const mid = Number(db.prepare("INSERT INTO movies (title, norm_title, year, runtime) VALUES ('Geheimfilm', 'geheimfilm', 2026, 100)").run().lastInsertRowid)
  const sid = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('delphi-lux', ?, '2099-10-13T20:15:00+02:00', 'yorck')").run(mid).lastInsertRowid)
  const p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: mid, screening_ids: [sid], note: 'privat' })).body
  await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id, ticket_link: 'https://tickets.example/qr-abc' })
  const v = (await request(app).post('/api/visits').set('Cookie', c2).send({ title: 'Geheimfilm', cinema_key: 'delphi-lux', watched_on: '2026-10-01', note: 'privat' })).body
  return { ...t, c1, c2, eve, p, v, mid }
}

describe('K25-AC04: fremder Haushalt / Nicht-Eigentümer bekommt nichts', () => {
  let w
  beforeEach(async () => { w = await world() })

  it('Listen und Statistik des fremden Haushalts enthalten keine Datensätze', async () => {
    const { app, eve } = w
    const all = JSON.stringify([
      (await request(app).get('/api/proposals').set('Cookie', eve)).body,
      (await request(app).get('/api/visits').set('Cookie', eve)).body,
      (await request(app).get('/api/visits/pending').set('Cookie', eve)).body,
      (await request(app).get('/api/stats/wrapped?year=2026&scope=group').set('Cookie', eve)).body,
    ])
    for (const leak of ['privat', 'qr-abc', 'tuncay', 'kim']) expect(all).not.toContain(leak)
  })

  it('direkter Zugriff per ID: 404 (nicht 403/200), nichts geändert', async () => {
    const { app, db, eve, p, v } = w
    const opt = p.options[0].id
    const attempts = [
      request(app).get(`/api/proposals/${p.id}.ics`).set('Cookie', eve),
      request(app).put(`/api/proposals/${p.id}/votes/${opt}`).set('Cookie', eve).send({ value: 'no' }),
      request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', eve).send({ option_id: opt }),
      request(app).put(`/api/proposals/${p.id}/ticket`).set('Cookie', eve).send({ ticket_link: null }),
      request(app).post(`/api/proposals/${p.id}/cancel`).set('Cookie', eve),
      request(app).patch(`/api/visits/${v.id}`).set('Cookie', eve).send({ note: 'x' }),
      request(app).delete(`/api/visits/${v.id}`).set('Cookie', eve),
      request(app).post('/api/visits').set('Cookie', eve).send({ proposal_id: p.id, watched_on: '2026-10-01' }),
    ]
    for (const r of await Promise.all(attempts)) expect([404, 422]).toContain(r.status)
    expect(db.prepare('SELECT status, ticket_link FROM proposals WHERE id = ?').get(p.id)).toEqual({ status: 'booked', ticket_link: 'https://tickets.example/qr-abc' })
    expect(db.prepare("SELECT COUNT(*) n FROM votes WHERE value = 'no'").get().n).toBe(0)
    expect(db.prepare('SELECT note FROM visits WHERE id = ?').get(v.id).note).toBe('privat')
  })

  it('Besuch eines anderen Haushaltsmitglieds: nur lesen, nicht ändern (403)', async () => {
    const { app, c1, v } = w
    expect((await request(app).patch(`/api/visits/${v.id}`).set('Cookie', c1).send({ note: 'x' })).status).toBe(403)
    expect((await request(app).delete(`/api/visits/${v.id}`).set('Cookie', c1)).status).toBe(403)
  })

  it('Begleitung aus fremdem Haushalt wird verworfen', async () => {
    const { app, db, c1 } = w
    const r = await request(app).post('/api/visits').set('Cookie', c1).send({ title: 'X', cinema_key: 'delphi-lux', watched_on: '2026-10-02', companions: [3] })
    expect(r.body.companions).toEqual([])
    expect(db.prepare('SELECT companions_json FROM visits WHERE id = ?').get(r.body.id).companions_json).toBe('[]')
  })
})

describe('K25: Schreibzugriffe von fremder Origin (CSRF, z. B. Nachbar-Subdomain)', () => {
  it('fremde Origin → 403 und keine Änderung; gleiche Origin und ohne Origin (curl, Kalender) normal', async () => {
    const { app, db, c1, p } = await world()
    const r = await request(app).post(`/api/proposals/${p.id}/cancel`).set('Cookie', c1).set('Host', 'kino.tunikb.com').set('Origin', 'https://einkauf.tunikb.com')
    expect(r.status).toBe(403)
    expect(db.prepare('SELECT status FROM proposals WHERE id = ?').get(p.id).status).toBe('booked')
    expect((await request(app).post('/api/logout').set('Cookie', c1).set('Host', 'kino.tunikb.com').set('Origin', 'null')).status).toBe(403)
    expect((await request(app).get('/api/proposals').set('Cookie', c1).set('Origin', 'https://evil.example')).status).toBe(200)
    expect((await request(app).post(`/api/proposals/${p.id}/cancel`).set('Cookie', c1).set('Host', 'kino.tunikb.com').set('Origin', 'https://kino.tunikb.com')).status).toBe(204)
  })
})

describe('Backup und Wiederherstellung (K25-AC01/AC02)', () => {
  const runBackup = (env) => spawnSync('bash', [path.join(deployDir, 'backup.sh'), 'test'], {
    env: { PATH: '/usr/bin:/bin', HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'home-')), ...env }, encoding: 'utf8', timeout: 20_000,
  })

  it('AC01: Backup einer befüllten DB lässt sich sauber wiederherstellen und die App startet darauf', async () => {
    const { db, p, v } = await world()
    db.pragma('wal_checkpoint(PASSIVE)')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kino-bak-'))
    const r = runBackup({ KINO_DB: db.name, BACKUP_DIR: dir })
    expect(r.stderr).toMatch(/^ok: /)
    expect(r.status).toBe(0)
    const file = r.stdout.trim().split('\n').at(-1)
    expect(file).toMatch(/app_\d+_\d+_test\.db$/)
    // „Saubere Umgebung“: Kopie an neuem Ort, Migrationen (no-op), App + Login darauf.
    const restored = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-restore-')), 'app.db')
    fs.copyFileSync(file, restored)
    const rdb = new Database(restored)
    rdb.pragma('foreign_keys = ON')
    runMigrations(rdb)
    expect(rdb.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(rdb.pragma('foreign_key_check')).toEqual([])
    const app = createApp(rdb)
    expect((await request(app).get('/api/readyz')).body).toEqual({ ok: true, db: 'ok' })
    const cookie = await loginCookie(app, { email: 'tuncay@example.com', password: 'password1' })
    const list = (await request(app).get('/api/proposals').set('Cookie', cookie)).body
    expect(list.proposals[0].options[0].snapshot).toEqual(p.options[0].snapshot)
    expect((await request(app).get('/api/visits').set('Cookie', cookie)).body.visits.map((x) => x.id)).toContain(v.id)
    expect(rdb.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n).toBeGreaterThan(0)
  })

  it('AC02: fehlende Quelle, beschädigtes Backup und leere Zieldatei melden laut (Exit ≠ 0)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kino-bak-'))
    const missing = runBackup({ KINO_DB: path.join(dir, 'nope.db'), BACKUP_DIR: dir })
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toMatch(/Keine Datenbank/)
    const bad = path.join(dir, 'kaputt.db')
    fs.writeFileSync(bad, 'SQLite format 3\0' + 'x'.repeat(5000))
    const v1 = spawnSync('bash', [path.join(deployDir, 'verify-backup.sh'), bad], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 10_000 })
    expect(v1.status).not.toBe(0)
    expect(v1.stderr).toMatch(/FEHLER/)
    const v2 = spawnSync('bash', [path.join(deployDir, 'verify-backup.sh'), path.join(dir, 'fehlt.db')], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 10_000 })
    expect(v2.status).not.toBe(0)
    const empty = path.join(dir, 'leer.db')
    execFileSync('sqlite3', [empty, 'CREATE TABLE t (x);'])
    const v3 = spawnSync('bash', [path.join(deployDir, 'verify-backup.sh'), empty], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 10_000 })
    expect(v3.status).not.toBe(0)
    expect(v3.stderr).toMatch(/schema_migrations/)
  })
})
