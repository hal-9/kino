import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/migrate.js'

function oldDb(upTo) {
  const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db, { upTo })
  return db
}

// Befüllte Datenbank im Stand vor 005: zwei Vorstellungen, Vorschlag mit Optionen, Besuch.
function populate(db) {
  db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'tuncay', 't@example.com', 'x')").run()
  db.prepare("INSERT INTO cinemas (key, name) VALUES ('zoo-palast', 'Zoo Palast')").run()
  db.prepare("INSERT INTO movies (id, title, norm_title, year) VALUES (7, 'Digger', 'digger', 2026)").run()
  const ins = db.prepare("INSERT INTO screenings (id, cinema_key, movie_id, starts_at, version, auditorium, source, source_id) VALUES (?, 'zoo-palast', 7, ?, 'OV', 'Kino 1', ?, ?)")
  ins.run(11, '2099-10-13T20:00:00+02:00', 'kinoheld', '123')
  ins.run(12, '2099-10-14T20:00:00+02:00', 'berlinde', null)
  db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by) VALUES (5, 1, 7, 1)").run()
  const snap = JSON.stringify({ title: 'Digger', starts_at: '2099-10-13T20:00:00+02:00', auditorium: 'Kino 1' })
  db.prepare('INSERT INTO proposal_options (id, proposal_id, screening_id, snapshot_json) VALUES (?, 5, ?, ?)').run(21, 11, snap)
  db.prepare('INSERT INTO proposal_options (id, proposal_id, screening_id, snapshot_json) VALUES (?, 5, ?, ?)').run(22, 12, snap)
  db.prepare("INSERT INTO visits (user_id, household_id, proposal_id, movie_id, snapshot_json, watched_on) VALUES (1, 1, 5, 7, ?, '2099-10-13')").run(snap)
  return snap
}

describe('Migration 005 (Vorstellungen neu aufbauen, Beobachtungen)', () => {
  it('Upgrade einer befüllten DB erhält IDs, Referenzen und Snapshots; Integrität ok', () => {
    const db = oldDb('004_movie_details.sql')
    const snap = populate(db)
    runMigrations(db)
    expect(db.prepare('SELECT id, starts_at FROM screenings ORDER BY id').all().map((r) => r.id)).toEqual([11, 12])
    expect(db.prepare('SELECT id, screening_id, snapshot_json FROM proposal_options ORDER BY id').all()).toEqual([
      { id: 21, screening_id: 11, snapshot_json: snap }, { id: 22, screening_id: 12, snapshot_json: snap },
    ])
    expect(db.prepare('SELECT snapshot_json FROM visits').get().snapshot_json).toBe(snap)
    expect(db.prepare('SELECT screening_id, source, source_key FROM screening_observations').all()).toEqual([
      { screening_id: 11, source: 'kinoheld', source_key: '123' },
    ])
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    // Alte UNIQUE ist weg: zweiter Saal zur selben Zeit möglich.
    db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, auditorium, source) VALUES ('zoo-palast', 7, '2099-10-13T20:00:00+02:00', 'Kino 2', 'zoopalast')").run()
  })

  it('frische Installation hat dasselbe Schema', () => {
    const db = oldDb()
    expect(db.prepare("SELECT name FROM schema_migrations ORDER BY name").all().map((r) => r.name)).toContain('005_screening_observations.sql')
    expect(db.pragma('foreign_key_check')).toEqual([])
  })
})

describe('runMigrations', () => {
  it('Migration mit verwaisten Referenzen wird zurückgerollt, FK-Prüfung danach wieder an', () => {
    const db = oldDb()
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'a', 'a@example.com', 'x')").run()
    db.prepare("INSERT INTO auth_sessions (token, user_id, expires_at) VALUES ('t', 1, '2099-01-01')").run()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kino-bad-'))
    fs.writeFileSync(path.join(dir, '999_bad.sql'), 'DELETE FROM users;')
    expect(() => runMigrations(db, { dir })).toThrow(/foreign_key_check/)
    expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(1)
    expect(db.prepare("SELECT 1 FROM schema_migrations WHERE name = '999_bad.sql'").get()).toBeUndefined()
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
