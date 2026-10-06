import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie } from './helpers.js'
import { runMigrations } from '../src/migrate.js'

describe('K11 Vorschlags-Lebenszyklus', () => {
  let app, db, users, c1, c2, movieId, shows

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('delphi-lux', 'Delphi LUX')").run()
    movieId = Number(db.prepare("INSERT INTO movies (title, norm_title, year, runtime) VALUES ('Digger', 'digger', 2026, 129)").run().lastInsertRowid)
    const ins = db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('delphi-lux', ?, ?, 'yorck')")
    shows = ['2099-10-13T20:15:00+02:00', '2099-10-14T20:15:00+02:00'].map((t) => Number(ins.run(movieId, t).lastInsertRowid))
  })

  const create = async () => (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: movieId, screening_ids: shows })).body
  const post = (p, action, body = {}, cookie = c1, key) => {
    const r = request(app).post(`/api/proposals/${p.id}/${action}`).set('Cookie', cookie)
    return (key ? r.set('Idempotency-Key', key) : r).send(body)
  }

  it('AC01: zwei Buchungen auf derselben Revision → eine gewinnt, die andere 409', async () => {
    const p = await create()
    expect(p.revision).toBe(1)
    const [a, b] = await Promise.all([
      post(p, 'book', { option_id: p.options[0].id, revision: 1 }),
      post(p, 'book', { option_id: p.options[1].id, revision: 1 }, c2),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const row = db.prepare('SELECT status, booked_option_id, revision FROM proposals WHERE id = ?').get(p.id)
    expect(row).toEqual({ status: 'booked', booked_option_id: (a.status === 200 ? a : b).body.booked_option_id, revision: 2 })
    // Auch ohne Revision: Buchen eines schon gebuchten Vorschlags ist kein stilles Überschreiben.
    expect((await post(p, 'book', { option_id: p.options[1].id })).status).toBe(409)
  })

  it('AC02: Abstimmen nach Buchung/Absage und fremde Option werden abgelehnt', async () => {
    const p = await create()
    const q = await create()
    expect((await request(app).put(`/api/proposals/${p.id}/votes/${q.options[0].id}`).set('Cookie', c2).send({ value: 'yes' })).status).toBe(404)
    expect((await post(p, 'book', { option_id: q.options[0].id })).status).toBe(404)
    await post(p, 'book', { option_id: p.options[0].id }).expect(200)
    const vote = await request(app).put(`/api/proposals/${p.id}/votes/${p.options[0].id}`).set('Cookie', c2).send({ value: 'no' })
    expect(vote.status).toBe(409)
    await post(q, 'cancel').expect(200)
    expect((await request(app).put(`/api/proposals/${q.id}/votes/${q.options[0].id}`).set('Cookie', c2).send({ value: 'no' })).status).toBe(409)
    expect(db.prepare("SELECT COUNT(*) n FROM votes WHERE value = 'no'").get().n).toBe(0)
  })

  it('AC03: identische Wiederholung liefert das Original, anderer Inhalt mit demselben Key → 409', async () => {
    const p = await create()
    const body = { option_id: p.options[0].id, revision: 1 }
    const a = await post(p, 'book', body, c1, 'book-key-0001')
    const b = await post(p, 'book', body, c1, 'book-key-0001')
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(b.body).toEqual(a.body)
    expect(db.prepare("SELECT COUNT(*) n FROM proposal_events WHERE action = 'book'").get().n).toBe(1)
    expect((await post(p, 'book', { option_id: p.options[1].id, revision: 1 }, c1, 'book-key-0001')).status).toBe(409)
    // Key gilt nur für diesen Vorschlag.
    const q = await create()
    expect((await post(q, 'book', body, c1, 'book-key-0001')).status).toBe(409)
  })

  it('AC04: alt angelegte, weit zukünftige Buchung bleibt gelistet und per ID abrufbar', async () => {
    const p = await create()
    await post(p, 'book', { option_id: p.options[0].id }).expect(200)
    db.prepare("UPDATE proposals SET created_at = '2020-01-01 10:00:00', updated_at = '2020-01-01 10:00:00' WHERE id = ?").run(p.id)
    const list = (await request(app).get('/api/proposals').set('Cookie', c2)).body.proposals
    expect(list.map((x) => x.id)).toContain(p.id)
    const detail = await request(app).get(`/api/proposals/${p.id}`).set('Cookie', c2)
    expect(detail.status).toBe(200)
    expect(detail.body.proposal).toMatchObject({ id: p.id, status: 'booked' })
    expect(detail.body.members.map((m) => m.name)).toEqual(['tuncay', 'kim'])
    // Nach Vorstellungsende +60 Tage: Archiv, aber Detail weiter erreichbar.
    db.prepare("UPDATE proposal_options SET snapshot_json = json_set(snapshot_json, '$.starts_at', '2020-01-10T20:00:00+01:00')").run()
    expect((await request(app).get('/api/proposals').set('Cookie', c2)).body.proposals).toHaveLength(0)
    expect((await request(app).get('/api/proposals?view=archive').set('Cookie', c2)).body.proposals.map((x) => x.id)).toEqual([p.id])
    expect((await request(app).get(`/api/proposals/${p.id}`).set('Cookie', c2)).status).toBe(200)
    expect((await request(app).get('/api/proposals/999').set('Cookie', c2)).status).toBe(404)
  })

  it('AC05: Absagen/Umbuchen/Wieder öffnen schreiben Verlauf, behalten Stimmen, versprechen keine Erstattung', async () => {
    const p = await create()
    await request(app).put(`/api/proposals/${p.id}/votes/${p.options[0].id}`).set('Cookie', c2).send({ value: 'maybe' }).expect(204)
    await post(p, 'book', { option_id: p.options[0].id }).expect(200)
    expect((await post(p, 'reschedule', { option_id: p.options[1].id, revision: 1 })).status).toBe(409) // veraltet
    const moved = await post(p, 'reschedule', { option_id: p.options[1].id, revision: 2 }, c2)
    expect(moved.body).toMatchObject({ status: 'booked', booked_option_id: p.options[1].id, revision: 3 })
    const cancelled = await post(p, 'cancel', { revision: 3 })
    expect(cancelled.body.status).toBe('cancelled')
    expect(JSON.stringify(cancelled.body)).not.toMatch(/erstatt|refund/i)
    expect((await post(p, 'cancel')).status).toBe(409)
    const reopened = await post(p, 'reopen', { revision: 4 })
    expect(reopened.body).toMatchObject({ status: 'open', booked_option_id: null })
    expect(reopened.body.options[0].votes).toEqual({ 1: 'yes', 2: 'maybe' })
    const h = (await request(app).get(`/api/proposals/${p.id}`).set('Cookie', c1)).body.history
    expect(h.map((e) => [e.action, e.revision, e.user_name])).toEqual([
      ['created', 1, 'tuncay'], ['book', 2, 'tuncay'], ['reschedule', 3, 'kim'], ['cancel', 4, 'tuncay'], ['reopen', 5, 'tuncay'],
    ])
    expect(h[2].detail).toEqual({ option_id: p.options[1].id, from_option_id: p.options[0].id })
  })

  it('Ticket-Link-Änderung erhöht die Revision, Verlauf ohne den Link', async () => {
    const p = await create()
    await post(p, 'book', { option_id: p.options[0].id }).expect(200)
    const t = await request(app).put(`/api/proposals/${p.id}/ticket`).set('Cookie', c1).send({ ticket_link: 'https://tickets.example/geheim', revision: 2 })
    expect(t.body.revision).toBe(3)
    expect((await request(app).put(`/api/proposals/${p.id}/ticket`).set('Cookie', c1).send({ ticket_link: null, revision: 2 })).status).toBe(409)
    expect(JSON.stringify(db.prepare('SELECT * FROM proposal_events').all())).not.toContain('geheim')
  })
})

describe('Migration 013 auf befüllter DB', () => {
  it('Revision 1 für Bestand, leerer Verlauf, Integrität ok', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '012_movie_metadata_state.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'tuncay', 't@example.com', 'x')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'Digger', 'digger')").run()
    db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by, status) VALUES (5, 1, 7, 1, 'booked')").run()
    runMigrations(db)
    expect(db.prepare('SELECT id, status, revision FROM proposals').all()).toEqual([{ id: 5, status: 'booked', revision: 1 }])
    expect(db.prepare('SELECT COUNT(*) n FROM proposal_events').get().n).toBe(0)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
