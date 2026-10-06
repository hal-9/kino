import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie } from './helpers.js'

// K33: Story-Karten nur aus erlaubten, erfassten Daten; Nenner; zu wenig Daten → ausgelassen; keine Namen.
describe('K33 Wrapped-Story', () => {
  let app, db, c1, c2
  beforeEach(async () => {
    let users
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    const mv = db.prepare('INSERT INTO movies (title, norm_title, year, runtime, poster_url) VALUES (?, ?, 2026, 100, ?)')
    const [m1, m2, m3, m4] = [['Eins', 'https://image.tmdb.org/1.jpg'], ['Zwei', null], ['Drei', 'https://image.tmdb.org/3.jpg'], ['Vier', null]]
      .map(([t, p]) => Number(mv.run(t, t.toLowerCase(), p).lastInsertRowid))
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('zoo', 'Zoo Palast')").run()
    const sid = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('zoo', ?, '2026-03-01T20:00:00+01:00', 'x')").run(m1).lastInsertRowid)
    const pid = Number(db.prepare("INSERT INTO proposals (household_id, movie_id, created_by, status) VALUES (1, ?, 1, 'booked')").run(m1).lastInsertRowid)
    const oid = Number(db.prepare('INSERT INTO proposal_options (proposal_id, screening_id, snapshot_json) VALUES (?, ?, ?)').run(pid, sid, '{}').lastInsertRowid)
    db.prepare('UPDATE proposals SET booked_option_id = ? WHERE id = ?').run(oid, pid)
    const snap = (title) => JSON.stringify({ title, cinema_key: 'zoo', cinema_name: 'Zoo Palast' })
    const ins = db.prepare(`INSERT INTO visits (user_id, household_id, proposal_id, movie_id, snapshot_json, watched_on, auditorium, attendance, manual_rating, letterboxd_rating)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`)
    ins.run(1, null, m4, snap('Vier'), '2026-01-05', null, 'legacy', null, null) // nicht bestätigt
    ins.run(1, pid, m1, snap('Eins'), '2026-03-01', 'Saal 1', 'confirmed', 4, 2) // eigene Bewertung schlägt Letterboxd
    ins.run(2, pid, m1, snap('Eins'), '2026-03-01', 'saal 1', 'inferred', null, 4.5)
    ins.run(1, null, m2, snap('Zwei'), '2026-04-01', 'Saal 1', 'manual', 2, null)
    ins.run(2, null, m2, snap('Zwei'), '2026-04-02', null, 'manual', 5, null)
    ins.run(1, null, m3, snap('Drei'), '2026-05-01', null, 'manual', 3, null)
    ins.run(2, null, m3, snap('Drei'), '2026-05-01', null, 'manual', null, 3.5)
  })
  const story = async (scope, c = c1) => (await request(app).get(`/api/stats/wrapped?year=2026&scope=${scope}`).set('Cookie', c).expect(200)).body.story

  it('AC01/AC02/AC03: Karten aus erfassten Daten, Nenner, Mindestzahl, keine Namen', async () => {
    const g = await story('group')
    expect(g.first_confirmed).toEqual({ title: 'Eins', date: '2026-03-01' }) // legacy zählt nicht als bestätigt
    expect(g.favorite_venue).toEqual({ name: 'Zoo Palast', outings: 6, of: 6 }) // gemeinsame Buchung = ein Abend
    expect(g.revisited_room).toEqual({ name: 'Zoo Palast · Saal 1', outings: 2 })
    expect(g.posters).toEqual(['https://image.tmdb.org/1.jpg', 'https://image.tmdb.org/3.jpg'])
    expect(g.agreement).toEqual({
      rated_films: 3, min: 3,
      closest: { title: 'Eins', raters: 2, spread: 0.5 },
      widest: { title: 'Zwei', raters: 2, spread: 3 },
    })
    expect(JSON.stringify(g)).not.toMatch(/tuncay|kim|example\.com|ticket/i)
    expect((await story('me')).agreement).toBeNull()
    db.prepare("DELETE FROM visits WHERE snapshot_json LIKE '%Drei%' AND user_id = 2").run()
    expect((await story('group')).agreement).toEqual({ omitted: 'too_few_ratings', rated_films: 2, min: 3 })
  })

  it('AC04: Story und Kennzahlen stammen aus denselben Zeilen', async () => {
    const r = (await request(app).get('/api/stats/wrapped?year=2026&scope=group').set('Cookie', c2)).body
    expect(r.story.favorite_venue.of).toBe(r.outings)
    const empty = (await request(app).get('/api/stats/wrapped?year=2020&scope=group').set('Cookie', c2)).body.story
    expect(empty).toEqual({ first_confirmed: null, favorite_venue: null, revisited_room: null, posters: [], agreement: { omitted: 'too_few_ratings', rated_films: 0, min: 3 } })
  })
})
