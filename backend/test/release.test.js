import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { setupTestApp } from './helpers.js'

// K37: jede neue Route (K30–K35) verlangt eine Sitzung; ohne Cookie nie Daten, nie Schreiben.
const ROUTES = [
  ['get', '/api/rooms/notes'], ['post', '/api/rooms/notes'], ['patch', '/api/rooms/notes/1'], ['delete', '/api/rooms/notes/1'],
  ['get', '/api/proposals/1/ticket-files'], ['post', '/api/proposals/1/ticket-files'], ['get', '/api/ticket-files/1'], ['delete', '/api/ticket-files/1'],
  ['put', '/api/visits/1/reaction'], ['delete', '/api/visits/1/reaction'], ['get', '/api/visits/1/reactions'],
]

describe('K37 Release-Gate: neue Routen ohne Sitzung', () => {
  it.each(ROUTES)('%s %s → 401', async (method, url) => {
    const { app, db } = setupTestApp()
    const before = db.prepare("SELECT (SELECT COUNT(*) FROM room_notes) + (SELECT COUNT(*) FROM visit_reactions) n").get().n
    const r = await request(app)[method](url).send({})
    expect(r.status).toBe(401)
    expect(db.prepare("SELECT (SELECT COUNT(*) FROM room_notes) + (SELECT COUNT(*) FROM visit_reactions) n").get().n).toBe(before)
  })
})
