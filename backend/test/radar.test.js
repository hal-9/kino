import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { runSync } from '../src/sync/index.js'
import { detectRadar, dispatchRadar, quietMinutesLeft, MAX_ATTEMPTS } from '../src/radar.js'
import { runMigrations } from '../src/migrate.js'

// K29: Kino-Radar nur in der App, mit Einwilligung, Dedupe, Ruhezeit, Stummschalten, begrenzten Wiederholungen.
const show = (startsAt, extra = {}) => ({
  cinemaKey: 'zoo-palast', cinemaName: 'Zoo Palast', title: 'Digger', startsAt, year: 2026, version: 'OV', auditorium: 'Saal 1',
  attrs: [], ticketUrl: 'https://tickets.example.com/secret-token', source: 'zoopalast', runtime: 120, ...extra,
})

describe('K29 Kino-Radar', () => {
  let app, db, users, c1, c2, mid
  const deliver = vi.fn()
  beforeEach(async () => {
    deliver.mockReset()
    ;({ app, db, users } = setupTestApp({ radarDeliver: (o) => deliver(o) }))
    setNow('2099-10-01T10:00:00Z') // 12:00 Berlin
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    mid = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Digger', 'digger', 2026)").run().lastInsertRowid)
    await request(app).put(`/api/watchlist/${mid}`).set('Cookie', c1).send({}).expect(200)
  })
  afterEach(() => vi.useRealTimers())
  const sync = (rows) => runSync(db, { adapters: { zoopalast: { fetchShows: async () => rows } }, log() {}, minRows: () => 1, fetch: async () => ({ status: 404 }) })
  const consent = (cookie, extra = {}) => request(app).put('/api/radar/settings').set('Cookie', cookie).send({ enabled: true, ...extra }).expect(200)
  const radar = async (cookie = c1) => (await request(app).get('/api/radar').set('Cookie', cookie).expect(200)).body
  const outbox = () => db.prepare('SELECT state, attempts, last_error FROM radar_outbox').all()

  it('ohne Einwilligung entsteht nichts; danach genau ein Hinweis', async () => {
    await sync([show('2099-10-13T20:00:00+02:00', { sourceId: 'a' })])
    expect(db.prepare('SELECT COUNT(*) n FROM radar_events').get().n).toBe(0)
    expect((await radar()).settings.enabled).toBe(false)
    await consent(c1)
    const r = await radar()
    expect(r.inbox).toMatchObject([{ kind: 'watch_available', title: 'Digger', link: '/?q=Digger' }])
    expect(r.outbox).toEqual({ delivered: 1 })
    expect((await radar(c2)).inbox).toEqual([]) // nur eigene
  })

  it('AC01: wiederholte und umsortierte Importe ergeben ein logisches Ereignis', async () => {
    await consent(c1)
    const rows = [show('2099-10-13T20:00:00+02:00', { sourceId: 'a' }), show('2099-10-14T20:00:00+02:00', { sourceId: 'b' })]
    await sync(rows)
    await sync([...rows].reverse())
    await sync(rows)
    await radar()
    expect(db.prepare('SELECT COUNT(*) n FROM radar_events').get().n).toBe(1)
    expect(outbox()).toEqual([{ state: 'delivered', attempts: 1, last_error: null }])
  })

  it('AC02: Stummschalten, Abmelden und Ruhezeit greifen bei der Zustellung', async () => {
    await consent(c1, { quiet_start: '22:00', quiet_end: '07:00' })
    await sync([show('2099-10-13T20:00:00+02:00', { sourceId: 'a' })])
    setNow('2099-10-01T21:30:00Z') // 23:30 Berlin → Ruhezeit
    expect((await radar()).inbox).toEqual([])
    const row = db.prepare('SELECT state, next_attempt_at FROM radar_outbox').get()
    expect(row).toEqual({ state: 'pending', next_attempt_at: '2099-10-02T05:00:00.000Z' }) // 07:00 Berlin
    await request(app).put(`/api/radar/watch/${mid}`).set('Cookie', c1).send({ muted: true }).expect(200)
    setNow('2099-10-02T06:00:00Z')
    expect((await radar()).inbox).toEqual([])
    expect(outbox()[0].state).toBe('suppressed')
    expect(deliver).not.toHaveBeenCalled()
    // Abmelden nach dem Erkennen: ausstehender Hinweis wird nicht mehr zugestellt.
    const m2 = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Zweiter', 'zweiter', 2026)").run().lastInsertRowid)
    await request(app).put(`/api/watchlist/${m2}`).set('Cookie', c1).send({}).expect(200)
    await sync([show('2099-10-13T20:00:00+02:00', { sourceId: 'b', title: 'Zweiter' })])
    expect(db.prepare("SELECT COUNT(*) n FROM radar_outbox WHERE state = 'pending'").get().n).toBe(1)
    await request(app).put('/api/radar/settings').set('Cookie', c1).send({ enabled: false }).expect(200)
    expect(dispatchRadar(db, { now: new Date(), deliver })).toMatchObject({ delivered: 0, suppressed: 1 })
    expect(db.prepare('SELECT unsubscribed_at IS NOT NULL u FROM radar_settings').get().u).toBe(1)
  })

  it('Tageslimit verschiebt auf den nächsten Berliner Tag', async () => {
    await consent(c1, { daily_cap: 1 })
    const m2 = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Zweiter', 'zweiter', 2026)").run().lastInsertRowid)
    await request(app).put(`/api/watchlist/${m2}`).set('Cookie', c1).send({}).expect(200)
    await sync([show('2099-10-13T20:00:00+02:00', { sourceId: 'a' }), show('2099-10-13T20:00:00+02:00', { sourceId: 'b', title: 'Zweiter' })])
    expect((await radar()).inbox).toHaveLength(1)
    expect(db.prepare("SELECT next_attempt_at FROM radar_outbox WHERE state = 'pending'").get().next_attempt_at).toBe('2099-10-01T22:00:00.000Z')
  })

  it('AC03: fehlgeschlagene Zustellung wiederholt mit Abstand, endet sichtbar als failed', async () => {
    await consent(c1)
    deliver.mockImplementation(() => { throw new Error('boom') })
    await sync([show('2099-10-13T20:00:00+02:00', { sourceId: 'a' })])
    expect(outbox()).toEqual([{ state: 'pending', attempts: 0, last_error: null }]) // erkannt, noch nicht zugestellt
    await radar()
    expect(outbox()).toEqual([{ state: 'pending', attempts: 1, last_error: 'boom' }])
    await radar(); await radar() // sofortiges Nachfragen erzeugt keinen Sturm
    expect(deliver).toHaveBeenCalledTimes(1)
    let t = Date.parse('2099-10-01T10:00:00Z')
    for (let i = 0; i < MAX_ATTEMPTS; i++) { t += 7 * 3600_000; setNow(new Date(t).toISOString()); await radar() }
    expect(deliver).toHaveBeenCalledTimes(MAX_ATTEMPTS)
    expect(outbox()).toEqual([{ state: 'failed', attempts: MAX_ATTEMPTS, last_error: 'boom' }])
    expect((await radar()).outbox).toEqual({ failed: 1 })
  })

  it('AC04: Hinweise verlinken intern, ohne Ticket-/Feed-Links; gebuchte Änderungen nur für Teilnehmende', async () => {
    await consent(c1)
    await consent(c2)
    await sync([show('2099-10-13T20:00:00+02:00', { sourceId: 'a' })])
    const sid = db.prepare('SELECT id FROM screenings').get().id
    const p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: mid, screening_ids: [sid] }).expect(201)).body
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id }).expect(200)
    setNow('2099-10-01T12:00:00Z')
    await sync([show('2099-10-13T20:00:00+02:00', { sourceId: 'a', auditorium: 'Saal 2' })])
    await sync([show('2099-10-13T20:00:00+02:00', { sourceId: 'a', auditorium: 'Saal 2' })])
    const inbox = (await radar()).inbox
    expect(inbox.map((e) => e.kind).sort()).toEqual(['booked_change', 'watch_available'])
    expect(inbox.find((e) => e.kind === 'booked_change')).toMatchObject({ field: 'auditorium', link: `/vorschlaege/${p.id}` })
    expect(JSON.stringify(db.prepare('SELECT payload_json FROM radar_events').all())).not.toMatch(/https?:|token/)
    expect((await radar(c2)).inbox.map((e) => e.kind)).toEqual(['booked_change']) // Kim: Kohorte, aber nichts gemerkt
    expect((await request(app).post(`/api/radar/${inbox[0].id}/read`).set('Cookie', c2)).status).toBe(404)
    await request(app).post(`/api/radar/${inbox[0].id}/read`).set('Cookie', c1).expect(204)
  })

  it('Ruhezeit-Rechnung über Mitternacht', () => {
    const s = { quiet_start: '22:00', quiet_end: '07:00' }
    expect(quietMinutesLeft(s, new Date('2099-10-01T20:30:00Z'))).toBe(9 * 60 - 30) // 22:30 Berlin
    expect(quietMinutesLeft(s, new Date('2099-10-01T10:00:00Z'))).toBe(0)
    expect(quietMinutesLeft({ quiet_start: '13:00', quiet_end: '14:00' }, new Date('2099-10-01T11:15:00Z'))).toBe(45)
  })
})

describe('Migration 021 auf befüllter DB', () => {
  it('additiv; Merkliste bleibt, nicht stumm; nur Kanal inapp erlaubt', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '020_watchlist_preferences.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'a', 'a@example.com', 'x')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'Digger', 'digger')").run()
    db.prepare('INSERT INTO watchlist (user_id, movie_id) VALUES (1, 7)').run()
    runMigrations(db)
    expect(db.prepare('SELECT user_id, movie_id, radar_muted FROM watchlist').all()).toEqual([{ user_id: 1, movie_id: 7, radar_muted: 0 }])
    const e = db.prepare("INSERT INTO radar_events (user_id, kind, dedupe_key, payload_json) VALUES (1, 'watch_available', 'k', '{}')").run().lastInsertRowid
    expect(() => db.prepare("INSERT INTO radar_outbox (event_id, channel, next_attempt_at) VALUES (?, 'push', 'x')").run(e)).toThrow(/CHECK/)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
