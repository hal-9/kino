const IMG = 'https://image.tmdb.org/t/p/w185'

// Ohne TMDB_API_KEY ein No-Op. Je Lauf max. 30 Filme, ein Treffer-Versuch pro Film und 14 Tage.
export async function enrich(db, { fetch, apiKey = process.env.TMDB_API_KEY, log = () => {} } = {}) {
  if (!apiKey) return 0
  const movies = db
    .prepare(
      `SELECT m.id, m.title, m.year FROM movies m
       WHERE m.tmdb_id IS NULL AND (m.tmdb_checked_at IS NULL OR m.tmdb_checked_at < datetime('now', '-14 days'))
         AND EXISTS (SELECT 1 FROM screenings s WHERE s.movie_id = m.id AND datetime(s.starts_at) > datetime('now'))
       ORDER BY m.id DESC LIMIT 30`
    )
    .all()
  const found = db.prepare(
    `UPDATE movies SET tmdb_id = ?, poster_url = ?, title_original = ?, original_language = ?, tmdb_checked_at = datetime('now') WHERE id = ?`
  )
  const miss = db.prepare("UPDATE movies SET tmdb_checked_at = datetime('now') WHERE id = ?")
  let n = 0
  for (const m of movies) {
    try {
      const q = new URLSearchParams({ api_key: apiKey, query: m.title, language: 'de-DE' })
      if (m.year) q.set('year', m.year)
      const res = await fetch(`https://api.themoviedb.org/3/search/movie?${q}`)
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      const hit = (await res.json()).results?.[0]
      if (hit) {
        found.run(hit.id, hit.poster_path ? IMG + hit.poster_path : null, hit.original_title ?? null, hit.original_language ?? null, m.id)
        n++
      } else miss.run(m.id)
    } catch (e) {
      log(`tmdb ${m.title}: ${e.message}`)
    }
  }
  return n
}
