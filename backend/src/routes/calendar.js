import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, hashToken } from '../auth.js'
import { eventForProposal, icsCalendar, publicUrl } from '../ics.js'

const scopeSchema = z.object({ include_tickets: z.boolean().optional() })

// Kalender-Link = Inhaber-Berechtigung für den Haushalts-Feed. Klartext nur einmal bei Erzeugung (bzw. für Alt-Links).
export function calendarRouter(db) {
  const router = Router()
  router.use('/cal/token', requireAuth(db))

  const urls = (req, token) => {
    const https_url = `${publicUrl(req)}/api/cal/${token}.ics`
    return { https_url, webcal_url: https_url.replace(/^https?:/, 'webcal:') }
  }

  router.get('/cal/token', (req, res) => {
    const row = db.prepare('SELECT token, hashed, include_tickets FROM cal_tokens WHERE user_id = ?').get(req.user.id)
    if (!row) return res.json({ exists: false, legacy: false, https_url: null, webcal_url: null, include_tickets: false })
    const legacy = !row.hashed
    res.json({ exists: true, legacy, ...(legacy ? urls(req, row.token) : { https_url: null, webcal_url: null }), include_tickets: Boolean(row.include_tickets) })
  })

  // Erzeugen oder rotieren: alter Link ist ab sofort ungültig.
  router.post('/cal/token', (req, res) => {
    const parsed = scopeSchema.safeParse(req.body ?? {})
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const token = crypto.randomBytes(32).toString('hex')
    const include = parsed.data.include_tickets ? 1 : 0
    db.prepare(
      `INSERT INTO cal_tokens (user_id, token, hashed, include_tickets, created_at) VALUES (?, ?, 1, ?, datetime('now'))
       ON CONFLICT (user_id) DO UPDATE SET token = excluded.token, hashed = 1, include_tickets = excluded.include_tickets, created_at = excluded.created_at`
    ).run(req.user.id, hashToken(token), include)
    res.status(201).json({ exists: true, legacy: false, ...urls(req, token), include_tickets: Boolean(include) })
  })

  router.patch('/cal/token', (req, res) => {
    const parsed = scopeSchema.required().safeParse(req.body ?? {})
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const r = db.prepare('UPDATE cal_tokens SET include_tickets = ? WHERE user_id = ?').run(parsed.data.include_tickets ? 1 : 0, req.user.id)
    if (!r.changes) return res.status(404).json({ error: 'not found' })
    res.json({ include_tickets: parsed.data.include_tickets })
  })

  router.delete('/cal/token', (req, res) => {
    db.prepare('DELETE FROM cal_tokens WHERE user_id = ?').run(req.user.id)
    res.status(204).end()
  })

  // Ohne Cookie: das Token ist die Berechtigung.
  router.get('/cal/:token.ics', (req, res) => {
    res.set('Referrer-Policy', 'no-referrer')
    const t = String(req.params.token)
    const owner = db
      .prepare(
        `SELECT t.include_tickets, (SELECT household_id FROM household_members m WHERE m.user_id = t.user_id ORDER BY joined_at LIMIT 1) AS household_id
         FROM cal_tokens t WHERE (t.hashed = 1 AND t.token = ?) OR (t.hashed = 0 AND t.token = ?)`
      )
      .get(hashToken(t), t)
    if (!owner?.household_id) return res.status(404).json({ error: 'not found' })
    const base = publicUrl(req)
    const events = db
      .prepare(
        `SELECT p.id FROM proposals p JOIN proposal_options o ON o.id = p.booked_option_id
         WHERE p.household_id = ? AND p.status = 'booked' AND datetime(json_extract(o.snapshot_json, '$.starts_at')) > datetime('now', '-30 days')
         ORDER BY p.id`
      )
      .all(owner.household_id)
      .map((r) => eventForProposal(db, r.id, base, { tickets: Boolean(owner.include_tickets) }))
    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('Cache-Control', 'private, max-age=300')
    res.send(icsCalendar(events))
  })

  return router
}
