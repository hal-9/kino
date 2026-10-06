import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { bigPoster, ensureDetails } from '../tmdb.js'

export function moviesRouter(db, { fetch = globalThis.fetch } = {}) {
  const router = Router()
  router.use('/movies', requireAuth(db))

  router.get('/movies/:id', async (req, res) => {
    let m = db.prepare('SELECT * FROM movies WHERE id = ?').get(Number(req.params.id))
    if (!m) return res.status(404).json({ error: 'not found' })
    m = await ensureDetails(db, m, { fetch })
    res.json({
      id: m.id, title: m.title, title_original: m.title_original, year: m.year, runtime: m.runtime,
      poster_url: bigPoster(m.poster_url), overview: m.overview, release_date: m.release_date, director: m.director,
      cast: m.cast_json ? JSON.parse(m.cast_json) : [],
      letterboxd_url: m.tmdb_id ? `https://letterboxd.com/tmdb/${m.tmdb_id}/` : `https://letterboxd.com/search/${encodeURIComponent(m.title)}/`,
    })
  })

  return router
}
