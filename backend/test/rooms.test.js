import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie } from './helpers.js'
import { runMigrations } from '../src/migrate.js'

// K30: persönliche Saal- und Platz-Notizen.
describe('K30 Saal-Notizen', () => {
  let app, db, users, c1, c2, eve, vid
  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
    const eveId = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync('password9', 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(eveId)
    eve = await loginCookie(app, { email: 'eve@example.com', password: 'password9' })
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('zoo-palast', 'Zoo Palast'), ('delphi', 'Delphi')").run()
    vid = (await request(app).post('/api/visits').set('Cookie', c1).send({ title: 'Digger', cinema_key: 'zoo-palast', watched_on: '2026-09-01', auditorium: 'Saal 1' }).expect(201)).body.id
  })
  const add = (body, cookie = c1) => request(app).post('/api/rooms/notes').set('Cookie', cookie).send({ cinema_key: 'zoo-palast', room: 'Saal 1', noted_on: '2026-09-01', ...body })
  const notes = async (q, cookie = c1) => (await request(app).get(`/api/rooms/notes${q}`).set('Cookie', cookie).expect(200)).body.notes

  it('AC01/AC03: gleicher Saalname in zwei Kinos trifft nie; Schreibweise des Saals wird vereinheitlicht, mit Datum/Platz', async () => {
    await add({ row: '9', seat: '11', sightline: 5, note: 'Reihe 9 mittig gut', visit_id: vid }).expect(201)
    await add({ cinema_key: 'delphi', note: 'anderes Kino' }).expect(201)
    const hit = await notes('?cinema_key=zoo-palast&room=saal%20%201')
    expect(hit).toMatchObject([{ room: 'Saal 1', noted_on: '2026-09-01', row: '9', seat: '11', sightline: 5, note: 'Reihe 9 mittig gut', visit_id: vid, mine: true }])
    expect(await notes('?cinema_key=zoo-palast&room=Kino%201')).toEqual([]) // nicht verifizierter Alias
    expect((await notes('?cinema_key=delphi&room=Saal%201')).map((n) => n.note)).toEqual(['anderes Kino'])
    expect((await request(app).get('/api/rooms/notes?cinema_key=zoo-palast').set('Cookie', c1)).status).toBe(422)
  })

  it('AC02: privat ohne Freigabe; geteilt nur im Haushalt; nur Besitzer ändert', async () => {
    const priv = (await add({ note: 'privat' }).expect(201)).body
    expect(priv.shared).toBe(false)
    expect(await notes('?cinema_key=zoo-palast&room=Saal%201', c2)).toEqual([])
    await request(app).patch(`/api/rooms/notes/${priv.id}`).set('Cookie', c1).send({ shared: true }).expect(200)
    expect(await notes('?cinema_key=zoo-palast&room=Saal%201', c2)).toMatchObject([{ note: 'privat', mine: false, user_name: 'tuncay', visit_id: null }])
    expect(await notes('?cinema_key=zoo-palast&room=Saal%201', eve)).toEqual([])
    expect((await request(app).patch(`/api/rooms/notes/${priv.id}`).set('Cookie', c2).send({ note: 'x' })).status).toBe(404)
    expect((await request(app).delete(`/api/rooms/notes/${priv.id}`).set('Cookie', c2)).status).toBe(404)
    // fremden Besuch verknüpfen geht nicht
    expect((await add({ visit_id: vid }, c2)).status).toBe(422)
  })

  it('AC04: keine Bestplatz-/Geometrie-Aussage; unbekannter Saal wird nicht angelegt', async () => {
    expect((await add({ room: '  ' })).status).toBe(422)
    expect((await add({ cinema_key: 'nirgends' })).status).toBe(422)
    expect((await add({ comfort: 6 })).status).toBe(422)
    const n = (await add({ comfort: 4 }).expect(201)).body
    expect(Object.keys(n)).not.toContain('best_seat')
    expect(JSON.stringify(await notes(''))).not.toMatch(/best|optimal/i)
  })

  it('AC05: Bearbeiten/Löschen wirkt in allen Ansichten; Besuch löschen lässt die Notiz stehen', async () => {
    const n = (await add({ note: 'alt', visit_id: vid, shared: true }).expect(201)).body
    await request(app).patch(`/api/rooms/notes/${n.id}`).set('Cookie', c1).send({ note: 'neu', sound: 2 }).expect(200)
    expect((await notes('')).map((x) => x.note)).toEqual(['neu'])
    expect((await notes('?cinema_key=zoo-palast&room=Saal%201', c2)).map((x) => [x.note, x.sound])).toEqual([['neu', 2]])
    await request(app).delete(`/api/visits/${vid}`).set('Cookie', c1).expect(204)
    expect((await notes(''))[0]).toMatchObject({ note: 'neu', visit_id: null })
    await request(app).delete(`/api/rooms/notes/${n.id}`).set('Cookie', c1).expect(204)
    expect(await notes('?cinema_key=zoo-palast&room=Saal%201', c2)).toEqual([])
  })
})

describe('Migration 022 auf befüllter DB', () => {
  it('additiv; Besuche/Säle unverändert, Integrität ok', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '021_radar.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'a', 'a@example.com', 'x')").run()
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('zoo-palast', 'Zoo Palast')").run()
    db.prepare("INSERT INTO auditoriums (cinema_key, name, seats) VALUES ('zoo-palast', 'Saal 1', 800)").run()
    db.prepare("INSERT INTO visits (id, user_id, household_id, snapshot_json, watched_on, auditorium, row, seats) VALUES (3, 1, 1, '{}', '2026-01-01', 'Saal 1', '9', '11')").run()
    runMigrations(db)
    expect(db.prepare('SELECT auditorium, row, seats FROM visits').get()).toEqual({ auditorium: 'Saal 1', row: '9', seats: '11' })
    expect(db.prepare('SELECT COUNT(*) n FROM room_notes').get().n).toBe(0)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
