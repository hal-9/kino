import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie } from './helpers.js'
import { fold } from '../src/ics.js'

describe('Vorschläge + Kalender', () => {
  let app, db, users, c1, c2, movieId, shows

  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO cinemas (key, name, street, zip, lat, lng) VALUES ('delphi-lux', 'Delphi LUX', 'Kantstraße 10', '10623', 52.5056, 13.3236)").run()
    movieId = Number(db.prepare("INSERT INTO movies (title, norm_title, year, runtime) VALUES ('Digger', 'digger', 2026, 129)").run().lastInsertRowid)
    const ins = db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, version, auditorium, source) VALUES ('delphi-lux', ?, ?, 'OmU', 'Kino 2', 'yorck')")
    shows = ['2099-10-13T20:15:00+02:00', '2099-10-14T20:15:00+02:00', '2099-10-15T18:00:00+02:00'].map((t) => Number(ins.run(movieId, t).lastInsertRowid))
  })

  const create = (cookie = c1, ids = shows) =>
    request(app).post('/api/proposals').set('Cookie', cookie).send({ movie_id: movieId, screening_ids: ids, note: 'Wer kommt?' })

  it('legt an, Snapshot bleibt nach Programmänderung unverändert, Ersteller stimmt yes', async () => {
    const res = await create()
    expect(res.status).toBe(201)
    expect(res.body.options).toHaveLength(3)
    db.prepare("UPDATE screenings SET auditorium = 'Kino 9', version = 'DF'").run()
    const list = (await request(app).get('/api/proposals').set('Cookie', c2)).body
    expect(list.members.map((m) => m.name)).toEqual(['tuncay', 'kim'])
    const o = list.proposals[0].options[0]
    expect(o.snapshot).toMatchObject({ cinema_name: 'Delphi LUX', auditorium: 'Kino 2', version: 'OmU', street: 'Kantstraße 10' })
    expect(Object.values(o.votes)).toEqual(['yes'])
  })

  it('validiert: zu wenige Optionen, fremde Vorstellung', async () => {
    expect((await create(c1, shows.slice(0, 1))).status).toBe(422)
    expect((await create(c1, [shows[0], 9999])).status).toBe(422)
  })

  it('Vote-Upsert und Buchen', async () => {
    const p = (await create()).body
    const opt = p.options[1].id
    await request(app).put(`/api/proposals/${p.id}/votes/${opt}`).set('Cookie', c2).send({ value: 'maybe' }).expect(204)
    await request(app).put(`/api/proposals/${p.id}/votes/${opt}`).set('Cookie', c2).send({ value: 'yes' }).expect(204)
    await request(app).put(`/api/proposals/${p.id}/votes/${opt}`).set('Cookie', c2).send({ value: 'nope' }).expect(422)
    const booked = await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c2).send({ option_id: opt })
    expect(booked.status).toBe(200)
    expect(booked.body).toMatchObject({ status: 'booked', booked_option_id: opt })
    expect(Object.values(booked.body.options[1].votes)).toEqual(['yes', 'yes'])
  })

  it('.ics: nur gebucht, CRLF, UTC, Adresse, Alarm, gefaltet', async () => {
    const p = (await create()).body
    expect((await request(app).get(`/api/proposals/${p.id}.ics`).set('Cookie', c1)).status).toBe(409)
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id })
    const res = await request(app).get(`/api/proposals/${p.id}.ics`).set('Cookie', c1)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/calendar/)
    expect(res.headers['content-disposition']).toContain(`kino-${p.id}.ics`)
    const t = res.text
    expect(t.split('\r\n').length).toBeGreaterThan(10)
    expect(t).not.toMatch(/[^\r]\n/)
    expect(t).toContain('DTSTART:20991013T181500Z')
    expect(t).toContain('DTEND:20991013T204400Z') // +129+20 min
    expect(t).toContain('SUMMARY:🎬 Digger (OmU) · Delphi LUX')
    expect(t).toContain('LOCATION:Delphi LUX\\, Kantstraße 10\\, 10623 Berlin')
    expect(t).toContain('GEO:52.5056;13.3236')
    expect(t).toContain('TRIGGER:-PT60M')
    for (const line of t.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
  })

  it('fold teilt keine Mehrbyte-Zeichen', () => {
    const f = fold('X:' + 'ä'.repeat(100)).split('\r\n')
    expect(f.length).toBeGreaterThan(1)
    expect(f.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe('X:' + 'ä'.repeat(100))
  })

  it('Feed: Token ohne Cookie → 200, falsches Token → 404, enthält gebuchte', async () => {
    const p = (await create()).body
    await request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id })
    const tok = (await request(app).get('/api/cal/token').set('Cookie', c2)).body
    expect(tok.webcal_url).toMatch(/^webcal:\/\/.+\/api\/cal\/[0-9a-f]{32}\.ics$/)
    const feed = await request(app).get(`/api/cal/${tok.token}.ics`)
    expect(feed.status).toBe(200)
    expect(feed.text).toContain('BEGIN:VEVENT')
    expect((await request(app).get('/api/cal/deadbeef.ics')).status).toBe(404)
    expect((await request(app).get('/api/cal/token')).status).toBe(401)
  })

  it('cancel nimmt den Vorschlag aus der Liste', async () => {
    const p = (await create()).body
    await request(app).post(`/api/proposals/${p.id}/cancel`).set('Cookie', c1).expect(204)
    expect((await request(app).get('/api/proposals').set('Cookie', c1)).body.proposals).toHaveLength(0)
  })
})
