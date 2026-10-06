import { Router } from 'express'
import { z } from 'zod'
import { isHm } from 'shared'
import { requireAuth } from '../auth.js'
import { detectRadar, dispatchRadar } from '../radar.js'

const hm = z.string().refine(isHm)
const settingsSchema = z.object({
  enabled: z.boolean(), quiet_start: hm.nullable().default(null), quiet_end: hm.nullable().default(null),
  daily_cap: z.number().int().min(1).max(20).default(5),
}).strict()

// K29: Radar-Posteingang und Einstellungen, nur eigene Daten. deps.radarDeliver ersetzt die In-App-Zustellung in Tests.
export function radarRouter(db, { radarDeliver } = {}) {
  const router = Router()
  router.use('/radar', requireAuth(db))
  const settingsOf = (uid) => {
    const s = db.prepare('SELECT enabled, consented_at, unsubscribed_at, quiet_start, quiet_end, daily_cap FROM radar_settings WHERE user_id = ?').get(uid)
    return s ? { ...s, enabled: Boolean(s.enabled) } : { enabled: false, consented_at: null, unsubscribed_at: null, quiet_start: null, quiet_end: null, daily_cap: 5 }
  }

  router.get('/radar', (req, res) => {
    const uid = req.user.id
    detectRadar(db, { userId: uid })
    dispatchRadar(db, { userId: uid, deliver: radarDeliver })
    const inbox = db
      .prepare(
        `SELECT e.id, e.kind, e.payload_json, e.created_at, e.read_at, o.delivered_at FROM radar_events e JOIN radar_outbox o ON o.event_id = e.id
         WHERE e.user_id = ? AND o.state = 'delivered' ORDER BY o.delivered_at DESC, e.id DESC LIMIT 50`
      )
      .all(uid)
      .map(({ payload_json, ...e }) => ({ ...e, ...JSON.parse(payload_json) }))
    const outbox = Object.fromEntries(
      db.prepare('SELECT o.state, COUNT(*) n FROM radar_outbox o JOIN radar_events e ON e.id = o.event_id WHERE e.user_id = ? GROUP BY o.state').all(uid).map((r) => [r.state, r.n])
    )
    res.json({ settings: settingsOf(uid), inbox, outbox })
  })

  // Einwilligung ausdrücklich; Ausschalten = abmelden (wird bei jeder Zustellung erneut geprüft).
  router.put('/radar/settings', (req, res) => {
    const parsed = settingsSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const d = parsed.data
    db.prepare(
      `INSERT INTO radar_settings (user_id, enabled, consented_at, unsubscribed_at, quiet_start, quiet_end, daily_cap)
       VALUES (@uid, @on, CASE WHEN @on THEN datetime('now') END, CASE WHEN @on THEN NULL ELSE datetime('now') END, @qs, @qe, @cap)
       ON CONFLICT (user_id) DO UPDATE SET enabled = @on,
         consented_at = CASE WHEN @on AND radar_settings.enabled = 0 THEN datetime('now') ELSE radar_settings.consented_at END,
         unsubscribed_at = CASE WHEN @on THEN NULL WHEN radar_settings.enabled = 1 THEN datetime('now') ELSE radar_settings.unsubscribed_at END,
         quiet_start = @qs, quiet_end = @qe, daily_cap = @cap, updated_at = datetime('now')`
    ).run({ uid: req.user.id, on: d.enabled ? 1 : 0, qs: d.quiet_start, qe: d.quiet_end, cap: d.daily_cap })
    res.json(settingsOf(req.user.id))
  })

  router.post('/radar/:id([0-9]+)/read', (req, res) => {
    const n = db.prepare("UPDATE radar_events SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.user.id).changes
    if (!n) return res.status(404).json({ error: 'not found' })
    res.status(204).end()
  })

  // Radar für einen gemerkten Film stumm schalten (Merkliste bleibt).
  router.put('/radar/watch/:movieId([0-9]+)', (req, res) => {
    const parsed = z.object({ muted: z.boolean() }).strict().safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const n = db.prepare('UPDATE watchlist SET radar_muted = ? WHERE user_id = ? AND movie_id = ?').run(parsed.data.muted ? 1 : 0, req.user.id, Number(req.params.movieId)).changes
    if (!n) return res.status(404).json({ error: 'not found' })
    res.json({ movie_id: Number(req.params.movieId), muted: parsed.data.muted })
  })

  return router
}
