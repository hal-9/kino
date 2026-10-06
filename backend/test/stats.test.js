import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie, setNow } from './helpers.js'

describe('Wrapped', () => {
  let app, db, users, c1, c2

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    const ins = db.prepare(
      'INSERT INTO visits (user_id, household_id, snapshot_json, watched_on, auditorium, row, companions_json) VALUES (?, 1, ?, ?, ?, ?, ?)'
    )
    const snap = (cinema, version, title, runtime) => JSON.stringify({ cinema_name: cinema, version, title, runtime })
    // tuncay (id 1): 5 Besuche, zwei Kinos, zwei Reihen, OV-Anteil 3/5
    ins.run(1, snap('Delphi LUX', 'OmU', 'A', 100), '2026-01-10', 'Kino 2', '9', '[2]')
    ins.run(1, snap('Delphi LUX', 'OV', 'B', 120), '2026-01-20', 'Kino 2', '9', '[2]')
    ins.run(1, snap('Zoo Palast', 'DF', 'C', 140), '2026-03-05', 'Kino 1', '5', '[]')
    ins.run(1, snap('Delphi LUX', 'OmeU', 'D', null), '2026-06-01', 'Kino 3', '9', '[]')
    ins.run(1, snap('Zoo Palast', 'DF', 'E', 90), '2026-12-24', 'Kino 1', '5', '[2]')
    ins.run(2, snap('UCI', 'DF', 'F', 100), '2026-02-02', null, null, '[]')
    ins.run(1, snap('Alt', 'DF', 'G', 100), '2025-05-05', null, null, '[]')
  })

  const get = (qs, c = c1) => request(app).get(`/api/stats/wrapped?${qs}`).set('Cookie', c)

  it('me: Zähler, Minuten, OV-Anteil, Tops', async () => {
    const r = (await get('year=2026&scope=me')).body
    expect(r).toMatchObject({
      count: 5, minutes: 100 + 120 + 140 + 90, unknown_runtime: 1, ov_share: 0.6,
      top_cinema: { name: 'Delphi LUX', count: 3 },
      top_auditorium: { name: 'Delphi LUX · Kino 2', count: 2 },
      top_row: { name: '9', count: 3 },
      top_companion: { name: 'kim', count: 3 },
      top_month: { month: 1, count: 2 },
      first: { title: 'A', date: '2026-01-10' },
      last: { title: 'E', date: '2026-12-24' },
    })
  })

  it('group: alle Nutzer; leeres Jahr → count 0 und null', async () => {
    expect((await get('year=2026&scope=group', c2)).body.count).toBe(6)
    const empty = (await get('year=2030')).body
    expect(empty).toMatchObject({ count: 0, minutes: 0, ov_share: null, top_cinema: null, first: null })
    expect((await get('year=abc')).status).toBe(422)
    expect((await request(app).get('/api/stats/wrapped')).status).toBe(401)
  })

  afterEach(() => vi.useRealTimers())

  // K21: fünf Personen bei einer gebuchten 120-Minuten-Vorstellung, zwei Vorschläge für dieselbe Vorstellung.
  function bookedEvent(screeningId, proposalId, userIds, date, runtime = 120) {
    db.prepare("INSERT OR IGNORE INTO cinemas (key, name) VALUES ('zoo', 'Zoo')").run()
    db.prepare("INSERT OR IGNORE INTO movies (id, title, norm_title, runtime) VALUES (50, 'Film', 'film', ?)").run(runtime)
    db.prepare(`INSERT OR IGNORE INTO screenings (id, cinema_key, movie_id, starts_at, source) VALUES (?, 'zoo', 50, ?, 'yorck')`).run(screeningId, `${date}T20:00:00+01:00`)
    db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by, status) VALUES (?, 1, 50, 1, 'booked')").run(proposalId)
    const opt = Number(db.prepare('INSERT INTO proposal_options (proposal_id, screening_id, snapshot_json) VALUES (?, ?, ?)').run(proposalId, screeningId, '{}').lastInsertRowid)
    db.prepare('UPDATE proposals SET booked_option_id = ? WHERE id = ?').run(opt, proposalId)
    const ins = db.prepare("INSERT INTO visits (user_id, household_id, proposal_id, movie_id, snapshot_json, watched_on, attendance) VALUES (?, 1, ?, 50, '{\"title\":\"Film\"}', ?, 'confirmed')")
    for (const u of userIds) ins.run(u, proposalId, date)
  }

  it('K21-AC01/AC02: 1 Abend/1 Film/5 Personenbesuche/10 Stunden; zweite Vorstellung = neuer Abend, kein neuer Film', async () => {
    const extra = [3, 4, 5].map((i) => Number(db.prepare('INSERT INTO users (name, email, password_digest) VALUES (?, ?, ?)').run(`u${i}`, `u${i}@example.com`, 'x').lastInsertRowid))
    for (const id of extra) db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (1, ?)').run(id)
    const five = [1, 2, ...extra]
    bookedEvent(900, 900, five.slice(0, 3), '2031-03-01')
    bookedEvent(900, 901, five.slice(3), '2031-03-01') // zweiter Vorschlag, dieselbe Vorstellung
    expect((await get('year=2031&scope=group')).body).toMatchObject({ outings: 1, films: 1, person_visits: 5, count: 5, person_hours: 10, unknown_runtime: 0 })
    bookedEvent(901, 902, [1], '2031-04-01')
    expect((await get('year=2031&scope=group')).body).toMatchObject({ outings: 2, films: 1, person_visits: 6 })
    expect((await get('year=2031&scope=me')).body).toMatchObject({ outings: 2, films: 1, person_visits: 2, person_hours: 4 })
  })

  it('K21-AC04/AC05: ungruppierte Besuche einzeln, abgeleitete ausgewiesen; Berliner Jahresgrenze', async () => {
    const ins = db.prepare("INSERT INTO visits (user_id, household_id, snapshot_json, watched_on, attendance) VALUES (?, 1, '{\"title\":\"X\",\"runtime\":100}', ?, ?)")
    ins.run(1, '2032-12-31', 'inferred')
    ins.run(2, '2032-12-31', 'manual') // gleicher Tag/Titel, aber nicht verknüpft: nicht geraten
    ins.run(1, '2033-01-01', 'manual')
    expect((await get('year=2032&scope=group')).body).toMatchObject({ outings: 2, person_visits: 2, ungrouped: 2, unconfirmed: 1, films: 0 })
    // 23:30 UTC am 31.12. ist in Berlin schon das neue Jahr: Standardjahr folgt Berlin.
    ins.run(1, '2027-01-01', 'manual')
    setNow('2026-12-31T23:30:00Z')
    expect((await get('scope=me')).body).toMatchObject({ year: 2027, person_visits: 1 })
  })
})
