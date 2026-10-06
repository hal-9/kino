import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie } from './helpers.js'

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
      count: 5, minutes: 100 + 120 + 140 + 120 + 90, ov_share: 0.6,
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
})
