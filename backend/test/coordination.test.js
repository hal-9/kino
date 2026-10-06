import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import { setupTestApp, loginCookie, setNow } from './helpers.js'

// K36: Kennzahlen mit festen Nennern, nur Haushalt, keine Inhalte.
describe('K36 Planungs-Kennzahlen', () => {
  let app, db, users, c1, c2, eve, mid, sids
  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
    const eveId = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync('password9', 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(eveId)
    eve = await loginCookie(app, { email: 'eve@example.com', password: 'password9' })
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('zoo', 'Zoo')").run()
    mid = Number(db.prepare("INSERT INTO movies (title, norm_title) VALUES ('Digger', 'digger')").run().lastInsertRowid)
    const ins = db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('zoo', ?, ?, 'yorck')")
    sids = ['2099-10-13T20:00:00+02:00', '2099-10-14T20:00:00+02:00'].map((t) => Number(ins.run(mid, t).lastInsertRowid))
  })
  afterEach(() => vi.useRealTimers())

  const propose = async (cookie = c1) => (await request(app).post('/api/proposals').set('Cookie', cookie).send({ movie_id: mid, screening_ids: sids })).body
  const get = (qs = '', cookie = c1) => request(app).get(`/api/stats/coordination${qs}`).set('Cookie', cookie)

  it('AC01/AC05: Raten mit Nenner, Entscheidungszeit, offene Stimmen, Abgesagte getrennt, Haushalt getrennt', async () => {
    const a = await propose()
    const b = await propose()
    await propose() // bleibt offen, kim hat nicht abgestimmt
    // Buchung von a zwei Stunden nach dem Anlegen.
    db.prepare("UPDATE proposals SET created_at = datetime('now', '-2 hours') WHERE id = ?").run(a.id)
    await request(app).post(`/api/proposals/${a.id}/book`).set('Cookie', c1).send({ option_id: a.options[0].id }).expect(200)
    await request(app).post(`/api/proposals/${b.id}/cancel`).set('Cookie', c2).send({}).expect(200)
    const r = (await get()).body
    expect(r.proposals).toEqual({ created: 3, open: 1, booked: 1, cancelled: 1, booked_share_of_decided: 0.5 })
    expect(r.decision_hours_median).toBeCloseTo(2, 0)
    expect(r.open_waiting).toEqual({ proposals: 1, unanswered_people: 1 })
    expect(r.visits).toEqual({ confirmed: 0, manual: 0, inferred: 0, legacy: 0 })
    expect((await get('', eve)).body.proposals.created).toBe(0)
    expect(JSON.stringify(r)).not.toMatch(/Digger|tuncay|kim|note/)
  })

  it('AC04: Quellenfehler bleiben sichtbar; Fenster und Validierung', async () => {
    db.prepare("INSERT INTO source_health (source, last_ok_at, last_error, last_error_at) VALUES ('yorck', '2026-10-01T00:00:00Z', 'HTTP 500', '2026-10-02T00:00:00Z'), ('uci', '2026-10-02T00:00:00Z', NULL, NULL)").run()
    expect((await get()).body.sources).toEqual({ total: 2, failing: ['yorck'] })
    expect((await get('?days=0')).status).toBe(422)
    expect((await get('?days=abc')).status).toBe(422)
    await propose()
    setNow(new Date(Date.now() + 100 * 86400_000).toISOString())
    const later = await request(app).get('/api/stats/coordination').set('Cookie', await loginCookie(app, users[0]))
    expect(later.body.proposals.created).toBe(0)
    expect((await request(app).get('/api/stats/coordination')).status).toBe(401)
  })
})
