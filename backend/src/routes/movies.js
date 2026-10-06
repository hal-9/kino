import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { bigPoster, ensureDetails, setManual } from '../tmdb.js'

const manualSchema = z.object({ tmdb_id: z.number().int().positive().nullable() })

export function moviesRouter(db, { fetch = globalThis.fetch } = {}) {
  const router = Router()
  router.use('/movies', requireAuth(db))

  const load = (req) => db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id))
  const shape = (m, req) => ({
    id: m.id, title: m.title, title_original: m.title_original, year: m.year, runtime: m.runtime,
    poster_url: bigPoster(m.poster_url), overview: m.overview, release_date: m.release_date, director: m.director,
    cast: m.cast_json ? JSON.parse(m.cast_json) : [],
    letterboxd_url: m.tmdb_id ? `https://letterboxd.com/tmdb/${m.tmdb_id}/` : `https://letterboxd.com/search/${encodeURIComponent(m.title)}/`,
    metadata: { status: m.tmdb_status ?? (m.tmdb_id ? 'matched' : null), tmdb_id: m.tmdb_id, next_retry_at: m.tmdb_next_retry_at },
    // K27: eigenes Interesse (Merkliste), getrennt von Stimmen/Buchungen.
    watchlisted: Boolean(db.prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND movie_id = ?').get(req.user.id, m.id)),
  })

  router.get('/movies/:id', async (req, res) => {
    const m = load(req)
    if (!m) return res.status(404).json({ error: 'not found' })
    res.json(shape(await ensureDetails(db, m, { fetch }), req))
  })

  // Sofort neu suchen (Nutzer-Knopf); höchstens einmal pro Minute je Film.
  router.post('/movies/:id/tmdb/retry', async (req, res) => {
    const m = load(req)
    if (!m) return res.status(404).json({ error: 'not found' })
    if (m.tmdb_id || m.tmdb_status === 'manual') return res.status(409).json({ error: 'already resolved' })
    if (m.tmdb_attempt_at && Date.now() - Date.parse(m.tmdb_attempt_at) < 60_000) return res.status(429).json({ error: 'too many requests' })
    db.prepare('UPDATE movies SET tmdb_next_retry_at = NULL WHERE id = ?').run(m.id)
    res.json(shape(await ensureDetails(db, load(req), { fetch }), req))
  })

  // Korrektur von Hand. Eine tmdb_id, die schon ein anderer Film trägt, wird abgelehnt (kein stilles Zusammenlegen).
  router.put('/movies/:id/tmdb', async (req, res) => {
    const m = load(req)
    if (!m) return res.status(404).json({ error: 'not found' })
    const parsed = manualSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const { tmdb_id } = parsed.data
    if (tmdb_id && db.prepare('SELECT 1 FROM movies WHERE tmdb_id = ? AND id != ?').get(tmdb_id, m.id)) return res.status(409).json({ error: 'tmdb_id in use' })
    setManual(db, m.id, tmdb_id)
    res.json(shape(await ensureDetails(db, load(req), { fetch }), req))
  })

  return router
}
