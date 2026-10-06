import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { setupTestApp, loginCookie } from './helpers.js'

describe('auth', () => {
  let app, users
  beforeEach(() => ({ app, users } = setupTestApp()))

  it('login setzt Cookie und liefert Nutzer mit Haushalt', async () => {
    const res = await request(app).post('/api/login').send(users[0])
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      id: expect.any(Number), name: 'tuncay', email: 'tuncay@example.com',
      household: { id: 1, name: 'Kino-Crew' },
    })
    expect(res.headers['set-cookie'][0]).toMatch(/^session=/)
  })

  it('falsches Passwort → 401', async () => {
    const res = await request(app).post('/api/login').send({ email: users[0].email, password: 'nope' })
    expect(res.status).toBe(401)
  })

  it('/me ohne Cookie → 401, mit Cookie → Nutzer', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401)
    const cookie = await loginCookie(app, users[0])
    const res = await request(app).get('/api/me').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('tuncay')
  })

  it('Registrierung nur mit Invite-Code, landet im Haushalt', async () => {
    const bad = await request(app).post('/api/register').send({
      name: 'kind', email: 'kind@example.com', password: 'geheim123', invite_code: 'falsch',
    })
    expect(bad.status).toBe(403)

    const res = await request(app).post('/api/register').send({
      name: 'kind', email: 'kind@example.com', password: 'geheim123', invite_code: 'CREW-TEST',
    })
    expect(res.status).toBe(201)
    expect(res.body.household).toEqual({ id: 1, name: 'Kino-Crew' })

    expect((await request(app).get('/api/me').set('Cookie', res.headers['set-cookie'][0])).status).toBe(200)
  })

  it('ohne REGISTER_INVITE_CODE ist die Registrierung zu', async () => {
    delete process.env.REGISTER_INVITE_CODE
    const res = await request(app).post('/api/register').send({
      name: 'kind', email: 'kind@example.com', password: 'geheim123', invite_code: '',
    })
    expect([403, 422]).toContain(res.status)
  })

  it('Invite-Code: falsche Länge oder Inhalt → 403, korrekt → 201', async () => {
    for (const code of ['CREW-TES', 'CREW-TEST!', 'crew-test']) {
      const res = await request(app).post('/api/register').send({ name: `k${code.length}`, email: `${code.length}@example.com`, password: 'geheim123', invite_code: code })
      expect(res.status).toBe(403)
    }
  })

  it('zu große Bodies werden abgelehnt', async () => {
    const res = await request(app).post('/api/login').set('Content-Type', 'application/json').send(JSON.stringify({ email: 'x'.repeat(70_000) }))
    expect(res.status).toBe(413)
  })

  it('logout löscht die Session', async () => {
    const cookie = await loginCookie(app, users[0])
    expect((await request(app).post('/api/logout').set('Cookie', cookie)).status).toBe(204)
    expect((await request(app).get('/api/me').set('Cookie', cookie)).status).toBe(401)
  })
})
