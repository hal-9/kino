import { Router } from 'express'
import { z } from 'zod'
import { berlinYmd, isHm, isValidYmd, localRange } from 'shared'
import { requireAuth } from '../auth.js'

const ymd = z.string().refine(isValidYmd)
const hm = z.string().refine(isHm)
const strength = z.enum(['hard', 'soft'])
// K27: ausdrückliche Vorlieben; fehlender Wert (null) = keine Angabe, nie „egal“ oder „ja“.
export const prefsSchema = z.object({
  version: z.object({ value: z.enum(['ov', 'df']), strength }).nullable().default(null),
  cinemas: z.object({ keys: z.array(z.string().max(100)).min(1).max(30), strength }).nullable().default(null),
  earliest: hm.nullable().default(null), // harte Grenze: Beginn frühestens
  latest_end: hm.nullable().default(null), // harte Grenze: geschätztes Ende spätestens
  buffer_minutes: z.number().int().min(0).max(120).default(0), // eigener Puffer (Heimweg) auf das geschätzte Ende
}).strict()
const putSchema = z.object({ prefs: prefsSchema, visibility: z.enum(['fit_only', 'household']).default('fit_only') }).strict()
const availSchema = z.object({ date: ymd, from: hm, to: hm, kind: z.enum(['free', 'busy']) }).strict()
const watchSchema = z.object({ expires_on: ymd.nullable().default(null) }).strict()

export const readPrefs = (row) => prefsSchema.parse(row ? JSON.parse(row.prefs_json) : {})

export function planningRouter(db) {
  const router = Router()
  router.use(['/watchlist', '/planning'], requireAuth(db))

  // Eigene Merkliste; upcoming = aktuelle, echte Vorstellungen (keine erfundenen Termine).
  router.get('/watchlist', (req, res) => {
    const items = db
      .prepare(
        `SELECT w.movie_id, w.expires_on, w.created_at, m.title, m.year, m.poster_url,
           (SELECT COUNT(*) FROM screenings s WHERE s.movie_id = w.movie_id AND s.withdrawn_at IS NULL AND datetime(s.starts_at) > datetime(?)) AS upcoming
         FROM watchlist w JOIN movies m ON m.id = w.movie_id WHERE w.user_id = ? ORDER BY w.created_at DESC, w.movie_id`
      )
      .all(new Date().toISOString(), req.user.id)
      .map((w) => ({ ...w, expired: Boolean(w.expires_on && w.expires_on < berlinYmd()) }))
    res.json({ items })
  })

  router.put('/watchlist/:movieId([0-9]+)', (req, res) => {
    const parsed = watchSchema.safeParse(req.body ?? {})
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const movieId = Number(req.params.movieId)
    if (!db.prepare('SELECT 1 FROM movies WHERE id = ?').get(movieId)) return res.status(404).json({ error: 'not found' })
    db.prepare(`INSERT INTO watchlist (user_id, movie_id, expires_on) VALUES (?, ?, ?)
      ON CONFLICT (user_id, movie_id) DO UPDATE SET expires_on = excluded.expires_on`).run(req.user.id, movieId, parsed.data.expires_on)
    res.json({ movie_id: movieId, expires_on: parsed.data.expires_on })
  })

  router.delete('/watchlist/:movieId([0-9]+)', (req, res) => {
    db.prepare('DELETE FROM watchlist WHERE user_id = ? AND movie_id = ?').run(req.user.id, Number(req.params.movieId))
    res.status(204).end()
  })

  // Eigene Vorlieben + Zeiten; von anderen nur, was sie für den Haushalt freigegeben haben.
  router.get('/planning', (req, res) => {
    const now = new Date().toISOString()
    db.prepare('DELETE FROM availability WHERE user_id = ? AND ends_at < ?').run(req.user.id, now) // abgelaufen
    const own = db.prepare('SELECT * FROM planning_prefs WHERE user_id = ?').get(req.user.id)
    const availability = db.prepare('SELECT id, starts_at, ends_at, kind FROM availability WHERE user_id = ? ORDER BY starts_at, id').all(req.user.id)
    const members = db
      .prepare(
        `SELECT u.id, u.name, p.prefs_json, p.visibility FROM household_members hm JOIN users u ON u.id = hm.user_id
         LEFT JOIN planning_prefs p ON p.user_id = u.id WHERE hm.household_id = ? AND u.id != ? ORDER BY hm.joined_at, u.id`
      )
      .all(req.user.householdId, req.user.id)
      .map((m) => ({ id: m.id, name: m.name, ...(m.visibility === 'household' ? { prefs: readPrefs(m) } : {}) }))
    res.json({ prefs: readPrefs(own), visibility: own?.visibility ?? 'fit_only', availability, members })
  })

  router.put('/planning/prefs', (req, res) => {
    const parsed = putSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const { prefs, visibility } = parsed.data
    db.prepare(`INSERT INTO planning_prefs (user_id, prefs_json, visibility) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET prefs_json = excluded.prefs_json, visibility = excluded.visibility, updated_at = datetime('now')`)
      .run(req.user.id, JSON.stringify(prefs), visibility)
    res.json({ prefs, visibility })
  })

  // Alles zurücksetzen: Vorlieben und eingetragene Zeiten (Merkliste bleibt).
  router.delete('/planning/prefs', (req, res) => {
    db.transaction(() => {
      db.prepare('DELETE FROM planning_prefs WHERE user_id = ?').run(req.user.id)
      db.prepare('DELETE FROM availability WHERE user_id = ?').run(req.user.id)
    })()
    res.status(204).end()
  })

  router.post('/planning/availability', (req, res) => {
    const parsed = availSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const { date, from, to, kind } = parsed.data
    const r = localRange(date, from, to)
    if (!r) return res.status(422).json({ error: 'ambiguous time' }) // Zeitumstellung: nicht eindeutig
    if (r.ends_at <= new Date().toISOString()) return res.status(422).json({ error: 'in the past' })
    const id = Number(db.prepare('INSERT INTO availability (user_id, starts_at, ends_at, kind) VALUES (?, ?, ?, ?)').run(req.user.id, r.starts_at, r.ends_at, kind).lastInsertRowid)
    res.status(201).json({ id, ...r, kind })
  })

  router.delete('/planning/availability/:id([0-9]+)', (req, res) => {
    const n = db.prepare('DELETE FROM availability WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id).changes
    if (!n) return res.status(404).json({ error: 'not found' })
    res.status(204).end()
  })

  return router
}
