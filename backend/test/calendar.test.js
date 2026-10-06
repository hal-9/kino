import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import crypto from 'node:crypto'
import request from 'supertest'
import Database from 'better-sqlite3'
import bcrypt from 'bcrypt'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie } from './helpers.js'
import { runMigrations } from '../src/migrate.js'

const tokenOf = (url) => url.match(/\/api\/cal\/([^/]+)\.ics$/)[1]
const unfold = (t) => t.replace(/\r\n /g, '')
const TICKET = 'https://tickets.example/qr-abc'

describe('Kalender-Link: Erzeugen, Rotieren, Widerrufen, Umfang (K10)', () => {
  let app, db, users, c1, c2, c3, pid

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    // Zweiter Haushalt mit eigenem Nutzer (Zufallspasswort nur für diesen Test).
    const pw = crypto.randomUUID()
    db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
    const uid = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync(pw, 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(uid)
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    c3 = await loginCookie(app, { email: 'eve@example.com', password: pw })
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('delphi-lux', 'Delphi LUX')").run()
    const mid = Number(db.prepare("INSERT INTO movies (title, norm_title, year, runtime) VALUES ('Digger', 'digger', 2026, 100)").run().lastInsertRowid)
    const sid = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('delphi-lux', ?, '2099-10-13T20:15:00+02:00', 'yorck')").run(mid).lastInsertRowid)
    const p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: mid, screening_ids: [sid] })).body
    pid = p.id
    await request(app).post(`/api/proposals/${pid}/book`).set('Cookie', c1).send({ option_id: p.options[0].id, ticket_link: TICKET })
  })
  afterEach(() => vi.restoreAllMocks())

  const create = (cookie, body = {}) => request(app).post('/api/cal/token').set('Cookie', cookie).send(body)
  const feed = (url) => request(app).get(`/api/cal/${tokenOf(url)}.ics`)
  const status = async (cookie) => (await request(app).get('/api/cal/token').set('Cookie', cookie)).body

  it('neuer Link: nur einmal im Klartext, DB speichert nur den Hash; Status ohne Link', async () => {
    const r = await create(c1)
    expect(r.status).toBe(201)
    expect(r.body.https_url).toMatch(/^https?:\/\/.+\/api\/cal\/[0-9a-f]{64}\.ics$/)
    expect(r.body.webcal_url).toMatch(/^webcal:/)
    expect(JSON.stringify(db.prepare('SELECT * FROM cal_tokens').all())).not.toContain(tokenOf(r.body.https_url))
    expect(await status(c1)).toEqual({ exists: true, legacy: false, https_url: null, webcal_url: null, include_tickets: false })
    expect((await feed(r.body.https_url)).status).toBe(200)
  })

  it('K10-AC01: nach Rotation ist der alte Link sofort tot, der neue geht; UID bleibt', async () => {
    const a = (await create(c1)).body
    const before = unfold((await feed(a.https_url)).text)
    const b = (await create(c1)).body
    expect(b.https_url).not.toBe(a.https_url)
    expect((await feed(a.https_url)).status).toBe(404)
    const after = unfold((await feed(b.https_url)).text)
    expect(after.match(/UID:[^\r]+/)[0]).toBe(before.match(/UID:[^\r]+/)[0])
  })

  it('Widerrufen: Link tot, Status leer', async () => {
    const a = (await create(c1)).body
    expect((await request(app).delete('/api/cal/token').set('Cookie', c1)).status).toBe(204)
    expect((await feed(a.https_url)).status).toBe(404)
    expect((await status(c1)).exists).toBe(false)
  })

  it('K10-AC02: fremder Haushalt ändert keine fremden Links und sieht keine fremden Termine', async () => {
    const a = (await create(c1)).body
    const e = (await create(c3)).body
    await request(app).delete('/api/cal/token').set('Cookie', c3)
    await request(app).patch('/api/cal/token').set('Cookie', c3).send({ include_tickets: true })
    expect((await feed(a.https_url)).status).toBe(200)
    expect((await status(c1)).include_tickets).toBe(false)
    expect((await feed(e.https_url)).status).toBe(404)
    const e2 = (await create(c3)).body
    expect((await feed(e2.https_url)).text).not.toContain('BEGIN:VEVENT')
    expect((await request(app).post('/api/cal/token')).status).toBe(401)
    expect((await request(app).delete('/api/cal/token')).status).toBe(401)
    expect((await request(app).patch('/api/cal/token').send({ include_tickets: true })).status).toBe(401)
  })

  it('K10-AC03: Standard-Feed ohne Ticket-Link; Opt-in nimmt ihn auf; eingeloggte Einzel-.ics unverändert', async () => {
    const a = (await create(c2)).body
    let t = unfold((await feed(a.https_url)).text)
    expect(t).not.toContain('qr-abc')
    expect(t).toMatch(/URL:https?:\/\/[^\r]+\/vorschlaege\/\d+/)
    expect((await request(app).patch('/api/cal/token').set('Cookie', c2).send({ include_tickets: true })).body.include_tickets).toBe(true)
    t = unfold((await feed(a.https_url)).text)
    expect(t).toContain(`URL:${TICKET}`)
    expect(unfold((await request(app).get(`/api/proposals/${pid}.ics`).set('Cookie', c1)).text)).toContain('qr-abc')
    expect((await create(c2, { include_tickets: 'ja' })).status).toBe(422)
  })

  it('K10-AC05: keine Tokens in Logs; Feed privat, ohne Referrer', async () => {
    const spy = vi.spyOn(console, 'log')
    const err = vi.spyOn(console, 'error')
    const a = (await create(c1)).body
    const res = await feed(a.https_url)
    await feed(a.https_url.replace(/[0-9a-f]{64}/, 'f'.repeat(64)))
    expect(JSON.stringify([...spy.mock.calls, ...err.mock.calls])).not.toContain(tokenOf(a.https_url))
    expect(res.headers['cache-control']).toMatch(/private/)
    expect(res.headers['referrer-policy']).toBe('no-referrer')
  })
})

describe('Migration 011: Alt-Link bleibt gültig (kein stilles Abklemmen)', () => {
  const legacy = 'ab'.repeat(16)

  it('Legacy-Klartext-Token funktioniert weiter, behält Ticket-Links, Status zeigt den Link', async () => {
    const { app, db, users } = setupTestApp()
    db.prepare('INSERT INTO cal_tokens (user_id, token, hashed, include_tickets) VALUES (1, ?, 0, 1)').run(legacy)
    const c1 = await loginCookie(app, users[0])
    expect((await request(app).get(`/api/cal/${legacy}.ics`)).status).toBe(200)
    const s = (await request(app).get('/api/cal/token').set('Cookie', c1)).body
    expect(s).toMatchObject({ exists: true, include_tickets: true, legacy: true })
    expect(s.https_url).toContain(legacy)
  })

  it('Upgrade einer befüllten DB: Token unverändert, legacy markiert, Tickets an', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '010_ics_sequence.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 't', 't@example.com', 'x')").run()
    db.prepare('INSERT INTO cal_tokens (user_id, token) VALUES (1, ?)').run(legacy)
    runMigrations(db)
    expect(db.prepare('SELECT user_id, token, hashed, include_tickets FROM cal_tokens').all()).toEqual([{ user_id: 1, token: legacy, hashed: 0, include_tickets: 1 }])
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
