import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie } from './helpers.js'

// K13: ein Film, mehrere Vorstellungen (Tage/Kinos) in einer Abstimmung.
describe('K13 Mehrfach-Optionen', () => {
  let app, db, users, c1, c2, movieId, other, shows

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('delphi-lux', 'Delphi LUX'), ('zoo-palast', 'Zoo Palast')").run()
    movieId = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Digger', 'digger', 2026)").run().lastInsertRowid)
    other = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Anderer', 'anderer', 2026)").run().lastInsertRowid)
    const ins = db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES (?, ?, ?, 'yorck')")
    shows = [
      ['delphi-lux', '2099-10-13T20:15:00+02:00'], ['zoo-palast', '2099-10-14T18:00:00+02:00'], ['delphi-lux', '2099-10-15T21:00:00+02:00'],
      ['zoo-palast', '2099-10-16T20:00:00+02:00'], ['zoo-palast', '2099-10-17T20:00:00+02:00'], ['zoo-palast', '2099-10-18T20:00:00+02:00'],
    ].map(([c, t]) => Number(ins.run(c, movieId, t).lastInsertRowid))
  })

  const create = (ids, movie = movieId) => request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: movie, screening_ids: ids })

  it('AC01: drei Vorstellungen über Tage/Kinos → eine Abstimmung mit drei Optionen', async () => {
    const r = await create([shows[2], shows[0], shows[1]])
    expect(r.status).toBe(201)
    expect(r.body.options.map((o) => [o.snapshot.cinema_name, o.snapshot.starts_at])).toEqual([
      ['Delphi LUX', '2099-10-13T20:15:00+02:00'], ['Zoo Palast', '2099-10-14T18:00:00+02:00'], ['Delphi LUX', '2099-10-15T21:00:00+02:00'],
    ])
    expect(db.prepare('SELECT COUNT(*) n FROM proposals').get().n).toBe(1)
  })

  it('AC02: eine und fünf ok; null, sechs, doppelt, fremder Film abgelehnt', async () => {
    expect((await create([shows[0]])).status).toBe(201)
    expect((await create(shows.slice(0, 5))).status).toBe(201)
    expect((await create([])).status).toBe(422)
    expect((await create(shows)).status).toBe(422)
    expect((await create([shows[0], shows[0]])).status).toBe(422)
    const foreign = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('zoo-palast', ?, '2099-10-13T20:00:00+02:00', 'yorck')").run(other).lastInsertRowid)
    expect((await create([shows[0], foreign])).status).toBe(422)
    db.prepare('UPDATE screenings SET withdrawn_at = ? WHERE id = ?').run('2099-01-01T00:00:00Z', shows[1])
    expect((await create([shows[0], shows[1]])).status).toBe(422)
    expect(db.prepare('SELECT COUNT(*) n FROM proposals').get().n).toBe(2)
  })

  it('AC04: zweite Person stimmt je Option ab, unbeantwortet bleibt unterscheidbar', async () => {
    const p = (await create(shows.slice(0, 3))).body
    const vote = (o, value) => request(app).put(`/api/proposals/${p.id}/votes/${o.id}`).set('Cookie', c2).send({ value }).expect(204)
    await vote(p.options[0], 'yes')
    await vote(p.options[1], 'no')
    const opts = (await request(app).get(`/api/proposals/${p.id}`).set('Cookie', c1)).body.proposal.options
    expect(opts.map((o) => o.votes)).toEqual([{ 1: 'yes', 2: 'yes' }, { 1: 'yes', 2: 'no' }, { 1: 'yes' }])
  })

  it('AC05: Ergänzen offener Abstimmung: neue Option ohne Stimmen, alte Stimmen bleiben, Grenzen geprüft', async () => {
    const p = (await create(shows.slice(0, 2))).body
    await request(app).put(`/api/proposals/${p.id}/votes/${p.options[0].id}`).set('Cookie', c2).send({ value: 'maybe' }).expect(204)
    const add = (ids, body = {}) => request(app).post(`/api/proposals/${p.id}/options`).set('Cookie', c2).send({ screening_ids: ids, ...body })
    expect((await add([shows[0]])).status).toBe(422) // schon enthalten
    expect((await add(shows.slice(2, 6))).status).toBe(422) // > 5 insgesamt
    expect((await add([shows[2]], { revision: 9 })).status).toBe(409)
    const r = await add([shows[2]], { revision: 1 })
    expect(r.status).toBe(200)
    expect(r.body.revision).toBe(2)
    expect(r.body.options.map((o) => o.votes)).toEqual([{ 1: 'yes', 2: 'maybe' }, { 1: 'yes' }, {}])
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id }).expect(200)
    expect((await add([shows[3]])).status).toBe(409) // nur offen
  })
})
