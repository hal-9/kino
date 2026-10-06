import crypto from 'node:crypto'

const SESSION_COOKIE = 'session'
// 90 Tage gleitend, wie bei LiLief-Workout.
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  }
}

// In der DB liegt nur der SHA-256 des Tokens (wie LiLief): ein DB-Leak
// liefert keine benutzbaren Sessions.
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function createSession(db, userId) {
  db.prepare("DELETE FROM auth_sessions WHERE datetime(expires_at) < datetime('now')").run()
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    userId,
    expiresAt
  )
  return { token, expiresAt }
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, cookieOptions())
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' })
}

// Haengt req.user = { id, name, householdId } an. Ohne Haushalt kommt 403:
// jeder registrierte Nutzer landet per Invite-Code in Haushalt 1, ein Nutzer
// ohne Mitgliedschaft waere also ein Datenfehler, kein Normalfall.
export function requireAuth(db) {
  return (req, res, next) => {
    const token = req.cookies[SESSION_COOKIE]
    if (!token) return res.status(401).json({ error: 'unauthorized' })

    const row = db
      .prepare(
        `SELECT s.id, s.user_id, s.expires_at, u.name AS user_name,
                (SELECT household_id FROM household_members m WHERE m.user_id = u.id ORDER BY joined_at LIMIT 1) AS household_id
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ?`
      )
      .get(hashToken(token))

    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    if (!row.household_id) return res.status(403).json({ error: 'no household' })

    const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE id = ?').run(newExpiresAt, row.id)
    setSessionCookie(res, token)

    req.user = { id: row.user_id, name: row.user_name, householdId: row.household_id }
    next()
  }
}

export { SESSION_COOKIE }
