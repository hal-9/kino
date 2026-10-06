import crypto from 'node:crypto'
import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { eventForProposal, icsCalendar, publicUrl } from '../ics.js'

export function calendarRouter(db) {
  const router = Router()

  router.get('/cal/token', requireAuth(db), (req, res) => {
    let row = db.prepare('SELECT token FROM cal_tokens WHERE user_id = ?').get(req.user.id)
    if (!row) {
      row = { token: crypto.randomBytes(16).toString('hex') }
      db.prepare('INSERT INTO cal_tokens (user_id, token) VALUES (?, ?)').run(req.user.id, row.token)
    }
    const https_url = `${publicUrl(req)}/api/cal/${row.token}.ics`
    res.json({ token: row.token, https_url, webcal_url: https_url.replace(/^https?:/, 'webcal:') })
  })

  // Ohne Cookie: das Token ist die Berechtigung.
  router.get('/cal/:token.ics', (req, res) => {
    const owner = db
      .prepare(
        `SELECT (SELECT household_id FROM household_members m WHERE m.user_id = t.user_id ORDER BY joined_at LIMIT 1) AS household_id
         FROM cal_tokens t WHERE t.token = ?`
      )
      .get(req.params.token)
    if (!owner?.household_id) return res.status(404).json({ error: 'not found' })
    const base = publicUrl(req)
    const events = db
      .prepare(
        `SELECT p.id FROM proposals p JOIN proposal_options o ON o.id = p.booked_option_id
         WHERE p.household_id = ? AND p.status = 'booked' AND datetime(json_extract(o.snapshot_json, '$.starts_at')) > datetime('now', '-30 days')
         ORDER BY p.id`
      )
      .all(owner.household_id)
      .map((r) => eventForProposal(db, r.id, base))
    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('Cache-Control', 'private, max-age=300')
    res.send(icsCalendar(events))
  })

  return router
}
