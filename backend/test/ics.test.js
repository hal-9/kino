import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupTestApp, loginCookie } from './helpers.js'
import { icsEvent } from '../src/ics.js'
import { runMigrations } from '../src/migrate.js'

// Entfaltet und zerlegt TEXT-Werte nach RFC 5545 zurück.
const unfold = (t) => t.replace(/\r\n[ \t]/g, '')
const unescape = (v) => v.replace(/\x5c([\x5c;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c))
const prop = (t, name) => unfold(t).split('\r\n').find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1)
const base = { uid: 'u@x', seq: 1, start: new Date('2099-01-01T19:00:00Z'), end: new Date('2099-01-01T21:00:00Z'), location: 'Kino', description: '', url: 'https://x.example/' }

describe('ICS-Text (K09-AC01..03)', () => {
  it('Semikolon wird als Backslash-Semikolon ausgegeben', () => {
    const t = icsEvent({ ...base, summary: 'Film; special' })
    expect(t).toContain('SUMMARY:Film\x5c; special')
  })

  it('Komma, Backslash, Zeilenumbrüche (CRLF, LF, CR) und Emoji kommen unverändert zurück', () => {
    const summary = 'A, B \\ C\r\nD\nE\rF 🎬👩‍👩‍👧 Ende'
    const t = icsEvent({ ...base, summary, description: summary })
    expect(unescape(prop(t, 'SUMMARY'))).toBe(summary.replace(/\r\n|\r/g, '\n'))
    expect(unescape(prop(t, 'DESCRIPTION'))).toBe(summary.replace(/\r\n|\r/g, '\n'))
  })

  it('Text kann keine Kalender-Properties einschleusen (auch nicht über URL)', () => {
    const t = icsEvent({ ...base, summary: 'X\r\nATTENDEE:mailto:evil@example.com', description: 'a\rBEGIN:VALARM', url: 'https://x.example/a\r\nX-EVIL:1' })
    const lines = t.split('\r\n')
    expect(lines.filter((l) => l.startsWith('BEGIN:VALARM'))).toHaveLength(1)
    expect(lines.some((l) => /^(ATTENDEE|X-EVIL)/.test(l))).toBe(false)
    expect(t).not.toMatch(/\r(?!\n)|[^\r]\n/)
  })

  it('jede physische Zeile ≤ 75 Oktette, Mehrbyte-Zeichen nie zerteilt', () => {
    const t = icsEvent({ ...base, summary: '🎬'.repeat(60) + 'ä'.repeat(80), description: 'x'.repeat(300) })
    for (const l of t.split('\r\n')) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75)
    expect(prop(t, 'SUMMARY')).toBe('🎬'.repeat(60) + 'ä'.repeat(80))
  })
})

describe('Ereignis-Invarianten (K09-AC04/05)', () => {
  let app, db, users, c1, movieId, ins

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('delphi-lux', 'Delphi LUX')").run()
    movieId = Number(db.prepare("INSERT INTO movies (title, norm_title, year, runtime) VALUES ('Film; special', 'film special', 2099, 100)").run().lastInsertRowid)
    ins = db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('delphi-lux', ?, ?, 'yorck')")
  })

  const propose = async (times) => {
    const ids = times.map((t) => Number(ins.run(movieId, t).lastInsertRowid))
    return (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: movieId, screening_ids: ids })).body
  }
  const ics = async (id) => (await request(app).get(`/api/proposals/${id}.ics`).set('Cookie', c1)).text
  const book = (p, i) => request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[i].id })

  it('Berliner DST-Wechsel: Start/Ende korrekt in UTC (Herbst-Doppelstunde, Frühjahr)', async () => {
    const p = await propose(['2099-10-25T02:30:00+01:00', '2099-03-29T03:30:00+02:00'])
    // Optionen nach starts_at sortiert: [0] = März, [1] = Oktober.
    await book(p, 1)
    let t = await ics(p.id)
    expect(prop(t, 'DTSTART')).toBe('20991025T013000Z')
    expect(prop(t, 'DTEND')).toBe('20991025T033000Z') // +100 +20 min
    await book(p, 0)
    t = await ics(p.id)
    expect(prop(t, 'DTSTART')).toBe('20990329T013000Z')
    expect(prop(t, 'SUMMARY')).toContain('Film\x5c; special')
  })

  it('Umbuchen/Ticket-Link behält UID und erhöht SEQUENCE streng; zweite Buchung hat eigene UID', async () => {
    const p = await propose(['2099-10-13T20:15:00+02:00', '2099-10-14T20:15:00+02:00'])
    await book(p, 0)
    const t1 = await ics(p.id)
    await book(p, 1) // gleiche Sekunde: SEQUENCE muss trotzdem steigen
    const t2 = await ics(p.id)
    await request(app).put(`/api/proposals/${p.id}/ticket`).set('Cookie', c1).send({ ticket_link: 'https://tickets.example/a' })
    const t3 = await ics(p.id)
    expect(prop(t2, 'UID')).toBe(prop(t1, 'UID'))
    expect(prop(t3, 'UID')).toBe(prop(t1, 'UID'))
    const seq = [t1, t2, t3].map((t) => Number(prop(t, 'SEQUENCE')))
    expect(seq[1]).toBeGreaterThan(seq[0])
    expect(seq[2]).toBeGreaterThan(seq[1])
    expect(await ics(p.id)).toContain(`SEQUENCE:${seq[2]}`) // reines Lesen erhöht nicht
    const q = await propose(['2099-10-15T20:15:00+02:00'])
    await book(q, 0)
    expect(prop(await ics(q.id), 'UID')).not.toBe(prop(t1, 'UID'))
  })
})

describe('Migration 010 (ics_seq) auf befüllter DB', () => {
  it('Alt-Buchung behält ihre bisherige (zeitbasierte) SEQUENCE als Startwert', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '009_idempotency_keys.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 't', 't@example.com', 'x')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'D', 'd')").run()
    db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by, status, updated_at) VALUES (5, 1, 7, 1, 'booked', '2026-10-01 12:00:00')").run()
    runMigrations(db)
    expect(db.prepare('SELECT ics_seq FROM proposals WHERE id = 5').get().ics_seq).toBe(Date.parse('2026-10-01T12:00:00Z') / 1000)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
