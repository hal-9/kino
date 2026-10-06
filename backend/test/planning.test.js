import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { runMigrations } from '../src/migrate.js'

// K27: Merkliste und ausdrückliche Planungs-Vorlieben.
describe('K27 Merkliste und Vorlieben', () => {
  let app, db, users, c1, c2, eve, mid, sid
  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
    const eveId = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync('password9', 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(eveId)
    eve = await loginCookie(app, { email: 'eve@example.com', password: 'password9' })
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('zoo-palast', 'Zoo Palast')").run()
    mid = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Digger', 'digger', 2026)").run().lastInsertRowid)
    sid = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('zoo-palast', ?, '2099-10-07T19:50:00+02:00', 'zoopalast')").run(mid).lastInsertRowid)
  })
  afterEach(() => vi.useRealTimers())

  it('AC01: Film ohne Vorstellungen merken, ohne erfundenen Termin', async () => {
    const lone = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Später', 'spaeter', 2027)").run().lastInsertRowid)
    const before = db.prepare('SELECT COUNT(*) n FROM screenings').get().n
    await request(app).put(`/api/watchlist/${lone}`).set('Cookie', c1).send({}).expect(200)
    const list = (await request(app).get('/api/watchlist').set('Cookie', c1).expect(200)).body.items
    expect(list).toMatchObject([{ movie_id: lone, title: 'Später', upcoming: 0, expired: false }])
    expect(db.prepare('SELECT COUNT(*) n FROM screenings').get().n).toBe(before)
    expect((await request(app).put('/api/watchlist/99999').set('Cookie', c1).send({})).status).toBe(404)
    expect((await request(app).get(`/api/movies/${lone}`).set('Cookie', c1)).body.watchlisted).toBe(true)
    // Merkliste ist persönlich.
    expect((await request(app).get('/api/watchlist').set('Cookie', c2)).body.items).toEqual([])
  })

  it('AC02/AC05: Interesse ändern lässt Stimmen und Buchung unberührt und ist nie eine Stimme', async () => {
    const p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: mid, screening_ids: [sid] }).expect(201)).body
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id }).expect(200)
    const snap = () => JSON.stringify([db.prepare('SELECT * FROM votes').all(), db.prepare('SELECT id, status, booked_option_id, revision FROM proposals').all()])
    const before = snap()
    await request(app).put(`/api/watchlist/${mid}`).set('Cookie', c2).send({}).expect(200)
    await request(app).delete(`/api/watchlist/${mid}`).set('Cookie', c1).expect(204)
    await request(app).put(`/api/watchlist/${mid}`).set('Cookie', c1).send({ expires_on: '2099-12-31' }).expect(200)
    expect(snap()).toBe(before)
    const after = (await request(app).get(`/api/proposals/${p.id}`).set('Cookie', c2)).body.proposal
    expect(after.options[0].votes).toEqual({ 1: 'yes' }) // Kim hat gemerkt, aber nicht abgestimmt
  })

  it('AC03: Zeiträume über Mitternacht und Zeitumstellung; Ablauf', async () => {
    setNow('2026-10-20T10:00:00Z')
    const over = await request(app).post('/api/planning/availability').set('Cookie', c1).send({ date: '2026-10-24', from: '22:00', to: '01:30', kind: 'free' }).expect(201)
    expect(over.body).toMatchObject({ starts_at: '2026-10-24T20:00:00.000Z', ends_at: '2026-10-24T23:30:00.000Z' }) // Ende am Folgetag
    // 25.10. 02:30 gibt es zweimal (Herbst-Umstellung) → nicht raten
    expect((await request(app).post('/api/planning/availability').set('Cookie', c1).send({ date: '2026-10-24', from: '22:00', to: '02:30', kind: 'free' })).status).toBe(422)
    const ok = await request(app).post('/api/planning/availability').set('Cookie', c1).send({ date: '2026-10-24', from: '22:00', to: '03:30', kind: 'busy' }).expect(201)
    expect(ok.body).toMatchObject({ starts_at: '2026-10-24T20:00:00.000Z', ends_at: '2026-10-25T02:30:00.000Z' }) // 03:30 CET = 02:30Z
    expect((await request(app).post('/api/planning/availability').set('Cookie', c1).send({ date: '2026-02-30', from: '18:00', to: '20:00', kind: 'free' })).status).toBe(422)
    expect((await request(app).post('/api/planning/availability').set('Cookie', c1).send({ date: '2026-10-01', from: '18:00', to: '20:00', kind: 'free' })).status).toBe(422)
    expect((await request(app).get('/api/planning').set('Cookie', c1)).body.availability).toHaveLength(2)
    setNow('2026-10-26T10:00:00Z') // abgelaufen → verschwindet
    expect((await request(app).get('/api/planning').set('Cookie', c1)).body.availability).toEqual([])
    await request(app).put(`/api/watchlist/${mid}`).set('Cookie', c1).send({ expires_on: '2026-10-25' }).expect(200)
    expect((await request(app).get('/api/watchlist').set('Cookie', c1)).body.items[0].expired).toBe(true)
    // fremde Einträge nicht löschbar
    const own = (await request(app).post('/api/planning/availability').set('Cookie', c1).send({ date: '2026-10-30', from: '18:00', to: '20:00', kind: 'free' })).body
    expect((await request(app).delete(`/api/planning/availability/${own.id}`).set('Cookie', c2)).status).toBe(404)
    await request(app).delete(`/api/planning/availability/${own.id}`).set('Cookie', c1).expect(204)
  })

  it('AC04: ohne Angabe bleibt alles unbekannt; Sichtbarkeit nur nach Freigabe; Zurücksetzen', async () => {
    const empty = (await request(app).get('/api/planning').set('Cookie', c1).expect(200)).body
    expect(empty.prefs).toEqual({ version: null, cinemas: null, earliest: null, latest_end: null, buffer_minutes: 0 })
    expect(empty.visibility).toBe('fit_only')
    const prefs = { version: { value: 'ov', strength: 'hard' }, cinemas: { keys: ['zoo-palast'], strength: 'soft' }, latest_end: '23:30' }
    await request(app).put('/api/planning/prefs').set('Cookie', c1).send({ prefs }).expect(200)
    expect((await request(app).get('/api/planning').set('Cookie', c2)).body.members).toEqual([{ id: 1, name: 'tuncay' }])
    await request(app).put('/api/planning/prefs').set('Cookie', c1).send({ prefs, visibility: 'household' }).expect(200)
    expect((await request(app).get('/api/planning').set('Cookie', c2)).body.members[0].prefs.version).toEqual({ value: 'ov', strength: 'hard' })
    expect((await request(app).get('/api/planning').set('Cookie', eve)).body.members).toEqual([]) // anderer Haushalt
    // Unbekannte Felder (z. B. erfundene Werte) werden abgelehnt.
    expect((await request(app).put('/api/planning/prefs').set('Cookie', c1).send({ prefs: { ...prefs, vote: 'yes' } })).status).toBe(422)
    await request(app).delete('/api/planning/prefs').set('Cookie', c1).expect(204)
    expect((await request(app).get('/api/planning').set('Cookie', c1)).body.prefs.version).toBeNull()
    expect((await request(app).get('/api/planning')).status).toBe(401)
  })
})

// K28: Nächster Kinoabend über echte Vorstellungen.
describe('K28 GET /match', () => {
  let app, db, users, c1, c2, eve, mid, sids
  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
    const eveId = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync('password9', 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(eveId)
    eve = await loginCookie(app, { email: 'eve@example.com', password: 'password9' })
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('zoo-palast', 'Zoo Palast'), ('delphi', 'Delphi')").run()
    mid = Number(db.prepare("INSERT INTO movies (title, norm_title, year, runtime) VALUES ('Digger', 'digger', 2026, 100)").run().lastInsertRowid)
    const ins = db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, version, source, provenance_json) VALUES (?, ?, ?, ?, 'zoopalast', ?)")
    const prov = JSON.stringify({ version: { source: 'zoopalast', observed_at: '2026-10-08T06:00:00Z' } })
    sids = [
      ins.run('zoo-palast', mid, '2026-10-09T20:00:00+02:00', 'OV', prov),
      ins.run('delphi', mid, '2026-10-09T20:00:00+02:00', 'DF', prov),
      ins.run('zoo-palast', mid, '2026-10-10T20:00:00+02:00', null, null),
    ].map((r) => Number(r.lastInsertRowid))
    db.prepare("UPDATE screenings SET withdrawn_at = '2026-10-08' WHERE id = ?").run(ins.run('zoo-palast', mid, '2026-10-11T20:00:00+02:00', 'OV', null).lastInsertRowid)
    setNow('2026-10-08T10:00:00Z')
    await request(app).put(`/api/watchlist/${mid}`).set('Cookie', c1).send({}).expect(200)
    for (const c of [c1, c2]) {
      await request(app).post('/api/planning/availability').set('Cookie', c).send({ date: '2026-10-09', from: '18:00', to: '23:59', kind: 'free' }).expect(201)
      await request(app).post('/api/planning/availability').set('Cookie', c).send({ date: '2026-10-10', from: '18:00', to: '23:59', kind: 'free' }).expect(201)
    }
  })
  afterEach(() => vi.useRealTimers())
  const match = (q = '', cookie = c1) => request(app).get(`/api/match${q}`).set('Cookie', cookie)

  it('AC01/AC03: hartes Nein schließt aus; Ergebnis nennt echte Vorstellung, Laufzeit, Herkunft, Punkte', async () => {
    await request(app).put('/api/planning/prefs').set('Cookie', c2).send({ prefs: { version: { value: 'ov', strength: 'hard' } } }).expect(200)
    const r = (await match().expect(200)).body
    expect(r.results.map((x) => x.screening.id)).toEqual([sids[0], sids[2]]) // DF ausgeschlossen, zurückgezogene fehlt
    expect(r.excluded).toEqual({ version: 1 })
    expect(r.results[0]).toMatchObject({
      status: 'feasible', score: 22, parts: [{ code: 'interest', people: 1, points: 20 }, { code: 'version', people: 1, points: 2 }],
      screening: { id: sids[0], title: 'Digger', runtime: 100, version: 'OV', cinema_name: 'Zoo Palast', provenance: { version: { source: 'zoopalast' } } },
    })
    // AC02: unbekannte Fassung bei harter OV-Vorgabe → nur unsicher, nie „passt“
    expect(r.results[1]).toMatchObject({ status: 'tentative', people: [{ user_id: 1, fit: 'fit' }, { user_id: 2, fit: 'unknown' }] })
    // Gründe von Kim (fit_only) bleiben verborgen, eigene sichtbar
    expect(r.results[1].people[1].reasons).toBeUndefined()
  })

  it('AC04/AC05: stabil; nur Lesen (keine Stimme, kein Vorschlag); Haushalt geprüft; leer statt erfunden', async () => {
    const a = (await match('?mode=max').expect(200)).body
    const b = (await match('?mode=max').expect(200)).body
    expect(a).toEqual(b)
    expect(db.prepare('SELECT COUNT(*) n FROM proposals').get().n + db.prepare('SELECT COUNT(*) n FROM votes').get().n).toBe(0)
    expect((await match('?participants=1,3')).status).toBe(422) // eve ist nicht im Haushalt
    expect((await match('?mode=book')).status).toBe(422)
    expect((await match('', eve).expect(200)).body.results).toEqual([]) // eve hat nichts gemerkt; fremde Merklisten zählen nicht
    await request(app).delete(`/api/watchlist/${mid}`).set('Cookie', c1).expect(204)
    expect((await match().expect(200)).body).toMatchObject({ movies: 0, results: [] })
    expect((await match(`?movie_id=${mid}&participants=2`).expect(200)).body.results).toHaveLength(3)
  })
})

describe('Migration 020 auf befüllter DB', () => {
  it('additiv; vorhandene Daten bleiben, Integrität ok', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '019_booking_seats.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'a', 'a@example.com', 'x')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'Digger', 'digger')").run()
    db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by) VALUES (5, 1, 7, 1)").run()
    runMigrations(db)
    expect(db.prepare('SELECT id, movie_id FROM proposals').all()).toEqual([{ id: 5, movie_id: 7 }])
    db.prepare('INSERT INTO watchlist (user_id, movie_id) VALUES (1, 7)').run()
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
