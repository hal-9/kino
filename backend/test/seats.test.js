import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie } from './helpers.js'
import { runMigrations } from '../src/migrate.js'

// K31: geprüfte Ticketdaten an der Buchung.
describe('K31 Ticketdaten', () => {
  let app, db, users, c1, c2, eve, p, sids
  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
    const eveId = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync('password9', 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(eveId)
    eve = await loginCookie(app, { email: 'eve@example.com', password: 'password9' })
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('zoo-palast', 'Zoo Palast')").run()
    const mid = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Digger', 'digger', 2026)").run().lastInsertRowid)
    const ins = db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('zoo-palast', ?, ?, 'zoopalast')")
    sids = ['2099-10-07T19:50:00+02:00', '2099-10-08T19:50:00+02:00'].map((t) => Number(ins.run(mid, t).lastInsertRowid))
    p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: mid, screening_ids: sids })).body
  })
  const put = (body, cookie = c1, key) => {
    const r = request(app).put(`/api/proposals/${p.id}/seats`).set('Cookie', cookie)
    return (key ? r.set('Idempotency-Key', key) : r).send(body)
  }
  const book = (i = 0) => request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[i].id }).expect(200)
  const ok = { date: '2099-10-07', time: '19:50', auditorium: '4', seats: [{ row: '9', seat: '11' }, { row: '10', seat: '3' }] }

  it('AC02: abweichendes Datum/Uhrzeit → 409, nichts gespeichert; unbekannte Werte erlaubt; nur gebucht', async () => {
    expect((await put(ok)).status).toBe(409) // noch nicht gebucht
    await book()
    const bad = await put({ ...ok, date: '2099-10-08', time: '20:00' })
    expect(bad.status).toBe(409)
    expect(bad.body).toEqual({ error: 'ticket mismatch', fields: ['date', 'time'] })
    expect(db.prepare('SELECT ticket_seats_json FROM proposals').get().ticket_seats_json).toBeNull()
    const partial = await put({ date: null, time: null, auditorium: null, seats: [{ seat: '5' }] })
    expect(partial.status).toBe(200)
    expect(partial.body.ticket).toEqual({ auditorium: null, seats: [{ row: null, seat: '5' }], by: 1 })
  })

  it('AC03: Revision + Idempotenz; Umbuchen macht die alten Daten ungültig statt sie umzuschreiben', async () => {
    await book()
    expect((await put({ ...ok, revision: 1 })).status).toBe(409)
    const first = await put({ ...ok, revision: 2 }, c1, 'seat-key-0001')
    expect(first.body).toMatchObject({ revision: 3, ticket: { auditorium: '4', seats: [{ row: '9', seat: '11' }, { row: '10', seat: '3' }] } })
    const again = await put({ ...ok, revision: 2 }, c1, 'seat-key-0001')
    expect(again.body.revision).toBe(3)
    expect((await put({ ...ok, seats: [], revision: 2 }, c1, 'seat-key-0001')).status).toBe(409)
    expect(db.prepare("SELECT COUNT(*) n FROM proposal_events WHERE action = 'seats'").get().n).toBe(1)
    const moved = await request(app).post(`/api/proposals/${p.id}/reschedule`).set('Cookie', c1).send({ option_id: p.options[1].id }).expect(200)
    expect(moved.body.ticket).toBeNull()
  })

  it('AC04: Verlauf, Feed und Kalender enthalten keine Platz- oder Textdaten; fremder Haushalt 404', async () => {
    await book()
    await put({ ...ok, ticket_link: 'https://tickets.example.com/abc' }).expect(200)
    expect(JSON.stringify(db.prepare("SELECT detail_json FROM proposal_events WHERE action = 'seats'").all())).toBe('[{"detail_json":"{\\"seats\\":2}"}]')
    const ics = (await request(app).get(`/api/proposals/${p.id}.ics`).set('Cookie', c1)).text
    expect(ics).not.toMatch(/Reihe|Sitz|"seat"/)
    expect((await put(ok, eve)).status).toBe(404)
    expect((await put({ ...ok, ticket_link: 'javascript:alert(1)' })).status).toBe(422)
    // Andere Person im Haushalt darf eintragen (Vertrauensmodell); Käufer = ticket_by, nicht automatisch alle Plätze.
    expect((await put(ok, c2)).body.ticket.by).toBe(2)
  })
})

describe('Migration 019 auf befüllter DB', () => {
  it('additiv, alte Buchung ohne Ticketdaten; Integrität ok', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '018_letterboxd_sync.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'a', 'a@example.com', 'x')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'Digger', 'digger')").run()
    db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by, status, ticket_link) VALUES (5, 1, 7, 1, 'booked', 'https://t.example/x')").run()
    runMigrations(db)
    expect(db.prepare('SELECT ticket_link, ticket_option_id, ticket_seats_json FROM proposals').get()).toEqual({ ticket_link: 'https://t.example/x', ticket_option_id: null, ticket_seats_json: null })
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
