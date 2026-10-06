import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  createSession, setSessionCookie, clearSessionCookie, requireAuth, hashToken, SESSION_COOKIE,
} from '../auth.js'
import {
  registerSchema, normalizeEmail, inviteCodeMatches, createUser, findUserByEmail, verifyPassword,
} from '../accounts.js'

function publicUser(db, userId) {
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, h.id AS household_id, h.name AS household_name
       FROM users u
       JOIN household_members m ON m.user_id = u.id
       JOIN households h ON h.id = m.household_id
       WHERE u.id = ? ORDER BY m.joined_at LIMIT 1`
    )
    .get(userId)
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    household: { id: row.household_id, name: row.household_name },
  }
}

export function authRouter(db) {
  const router = Router()

  // Limiter pro Router-Instanz, damit Tests sich nicht gegenseitig aussperren.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true,
    standardHeaders: true, legacyHeaders: false, message: { error: 'too many attempts' },
  })
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 10,
    standardHeaders: true, legacyHeaders: false, message: { error: 'too many attempts' },
  })

  router.post('/register', registerLimiter, (req, res) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed', details: parsed.error.issues })

    const { name, email, password, invite_code } = parsed.data
    if (!inviteCodeMatches(invite_code)) return res.status(403).json({ error: 'invalid invite code' })
    if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(name)) return res.status(409).json({ error: 'name taken' })
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalizeEmail(email))) {
      return res.status(409).json({ error: 'email taken' })
    }

    const user = createUser(db, { name, email, password })
    const { token } = createSession(db, user.id)
    setSessionCookie(res, token)
    res.status(201).json(publicUser(db, user.id))
  })

  router.post('/login', loginLimiter, (req, res) => {
    const { email, password } = req.body || {}
    const user = findUserByEmail(db, email)
    if (!verifyPassword(user, password)) return res.status(401).json({ error: 'unauthorized' })

    const { token } = createSession(db, user.id)
    setSessionCookie(res, token)
    res.json(publicUser(db, user.id))
  })

  router.post('/logout', requireAuth(db), (req, res) => {
    db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(hashToken(req.cookies[SESSION_COOKIE]))
    clearSessionCookie(res)
    res.status(204).end()
  })

  router.get('/me', requireAuth(db), (req, res) => {
    res.json(publicUser(db, req.user.id))
  })

  return router
}
