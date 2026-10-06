import { Router } from 'express'
import { z } from 'zod'
import { berlinYmd, isHm, isValidYmd, localRange, matchScreenings } from 'shared'
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
  router.use(['/watchlist', '/planning', '/match'], requireAuth(db))

  // Eigene Merkliste; upcoming = aktuelle, echte Vorstellungen (keine erfundenen Termine).
  router.get('/watchlist', (req, res) => {
    const items = db
      .prepare(
        `SELECT w.movie_id, w.expires_on, w.created_at, w.radar_muted, m.title, m.year, m.poster_url,
           (SELECT COUNT(*) FROM screenings s WHERE s.movie_id = w.movie_id AND s.withdrawn_at IS NULL AND datetime(s.starts_at) > datetime(?)) AS upcoming
         FROM watchlist w JOIN movies m ON m.id = w.movie_id WHERE w.user_id = ? ORDER BY w.created_at DESC, w.movie_id`
      )
      .all(new Date().toISOString(), req.user.id)
      .map((w) => ({ ...w, radar_muted: Boolean(w.radar_muted), expired: Boolean(w.expires_on && w.expires_on < berlinYmd()) }))
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

  // K28: „Nächster Kinoabend“. Nur echte, kommende, nicht zurückgezogene Vorstellungen gemerkter Filme (oder movie_id).
  // Ergebnis = Vorschläge mit Begründung; nichts wird abgestimmt, vorgeschlagen oder gebucht.
  router.get('/match', (req, res) => {
    const hid = req.user.householdId
    const mode = req.query.mode ?? 'all'
    const days = Number(req.query.days ?? 14)
    const movieId = req.query.movie_id === undefined ? null : Number(req.query.movie_id)
    const memberIds = db.prepare('SELECT user_id FROM household_members WHERE household_id = ?').all(hid).map((m) => m.user_id)
    const ids = req.query.participants === undefined ? memberIds : [...new Set(String(req.query.participants).split(',').map(Number))]
    if (!['all', 'max'].includes(mode) || !Number.isInteger(days) || days < 1 || days > 28 || (movieId !== null && !Number.isInteger(movieId))
      || !ids.length || ids.length > 20 || ids.some((i) => !memberIds.includes(i))) return res.status(422).json({ error: 'validation failed' })
    const now = new Date()
    const today = berlinYmd(now)
    const prefs = db.prepare('SELECT * FROM planning_prefs WHERE user_id = ?')
    const avail = db.prepare('SELECT starts_at, ends_at, kind FROM availability WHERE user_id = ? AND ends_at > ?')
    const watch = db.prepare('SELECT movie_id FROM watchlist WHERE user_id = ? AND (expires_on IS NULL OR expires_on >= ?)')
    const people = ids.map((id) => ({
      id, visibility: prefs.get(id)?.visibility ?? 'fit_only', prefs: readPrefs(prefs.get(id)),
      availability: avail.all(id, now.toISOString()), interested: watch.all(id, today).map((w) => w.movie_id),
    }))
    const movies = movieId !== null ? [movieId] : [...new Set(people.flatMap((p) => p.interested))]
    const screenings = movies.length ? db
      .prepare(
        `SELECT s.id, s.movie_id, m.title, m.year, m.runtime, s.starts_at, s.version, s.auditorium, s.attrs_json, s.cinema_key,
           c.name AS cinema_name, s.last_seen_at, s.provenance_json
         FROM screenings s JOIN movies m ON m.id = s.movie_id JOIN cinemas c ON c.key = s.cinema_key
         WHERE s.withdrawn_at IS NULL AND datetime(s.starts_at) > datetime(?) AND datetime(s.starts_at) < datetime(?)
           AND s.movie_id IN (SELECT value FROM json_each(?)) ORDER BY s.starts_at, s.id LIMIT 2000`
      )
      .all(now.toISOString(), new Date(now.getTime() + days * 86400_000).toISOString(), JSON.stringify(movies))
      .map(({ attrs_json, provenance_json, ...s }) => ({ ...s, attrs: JSON.parse(attrs_json), provenance: JSON.parse(provenance_json ?? '{}') }))
      : []
    const out = matchScreenings({ screenings, people, mode })
    // Gründe anderer nur, wenn sie ihre Vorlieben freigegeben haben; sonst nur passt/passt nicht/unbekannt.
    const shared = new Set(people.filter((p) => p.id === req.user.id || p.visibility === 'household').map((p) => p.id))
    for (const r of out.results) r.people = r.people.map((f) => (shared.has(f.user_id) ? f : { user_id: f.user_id, fit: f.fit }))
    res.json({ mode, days, participants: ids, movies: movies.length, generated_at: now.toISOString(), ...out })
  })

  return router
}
