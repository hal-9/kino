import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { z } from 'zod'

const BCRYPT_COST = 12
export const HOUSEHOLD_ID = 1

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(30),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(200),
  invite_code: z.string().min(1),
})

export function normalizeEmail(email) {
  return String(email).trim().toLowerCase()
}

// Ohne gesetzten Invite-Code ist die Registrierung zu, nicht offen.
// Vergleich in konstanter Zeit, damit die Antwortzeit nichts ueber den Code verraet.
export function inviteCodeMatches(code) {
  const expected = process.env.REGISTER_INVITE_CODE
  if (!expected) return false
  const a = Buffer.from(String(code ?? ''))
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function createUser(db, { name, email, password }) {
  const digest = bcrypt.hashSync(password, BCRYPT_COST)
  return db.transaction(() => {
    const info = db
      .prepare('INSERT INTO users (name, email, password_digest) VALUES (?, ?, ?)')
      .run(name, normalizeEmail(email), digest)
    const id = Number(info.lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (?, ?)').run(HOUSEHOLD_ID, id)
    return { id, name }
  })()
}

export function findUserByEmail(db, email) {
  const value = String(email ?? '').trim()
  if (!value) return undefined
  return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(value))
}

// Digest eines Dummy-Passworts: unbekannte E-Mails kosten denselben
// bcrypt-Vergleich wie bekannte, sonst verraet die Antwortzeit, wer registriert ist.
const DUMMY_DIGEST = '$2b$12$zqEScYkwzqXlXIKB/enZG.k60L/qpQVg6pQV5OqIbDQ9Wi.lXkKYa'

export function verifyPassword(user, password) {
  const digest = user ? user.password_digest : DUMMY_DIGEST
  return bcrypt.compareSync(String(password ?? ''), digest) && Boolean(user)
}
