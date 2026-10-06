import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import bcrypt from 'bcrypt'
import request from 'supertest'
import { vi } from 'vitest'
import { getDb, resetDb } from '../src/db.js'
import { runMigrations } from '../src/migrate.js'
import { createApp } from '../src/app.js'

export function setupTestApp(deps = {}) {
  process.env.NODE_ENV = 'test'
  process.env.REGISTER_INVITE_CODE = 'CREW-TEST'
  process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-test-')), 'test.db')

  resetDb()
  const db = getDb()
  runMigrations(db)

  const users = [
    { name: 'tuncay', email: 'tuncay@example.com', password: 'password1' },
    { name: 'kim', email: 'kim@example.com', password: 'password2' },
  ]
  const insert = db.prepare('INSERT INTO users (name, email, password_digest) VALUES (?, ?, ?)')
  const join = db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (1, ?)')
  for (const u of users) {
    const id = Number(insert.run(u.name, u.email, bcrypt.hashSync(u.password, 4)).lastInsertRowid)
    join.run(id)
  }

  const app = createApp(db, deps)
  return { app, db, users }
}

export async function loginCookie(app, { email, password }) {
  const res = await request(app).post('/api/login').send({ email, password })
  return res.headers['set-cookie'][0]
}

// Kontrollierbare Uhr (nur Date; Session-Ablauf, Vergangen/Zukunft): setNow(iso) friert ein, vi.useRealTimers() im afterEach löst.
export function setNow(iso) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}
