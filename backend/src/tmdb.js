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

// Details (Inhalt, Regie, Besetzung) einmalig holen und in movies cachen. Ohne Key oder bei Fehler
// bleibt die Zeile unverändert, damit der nächste Aufruf es erneut versucht.
export async function ensureDetails(db, movie, { fetch, apiKey = process.env.TMDB_API_KEY } = {}) {
  if (!apiKey || movie.details_fetched_at) return movie
  const get = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
  try {
    let id = movie.tmdb_id
    if (!id) {
      const q = new URLSearchParams({ api_key: apiKey, query: movie.title, language: 'de-DE' })
      if (movie.year) q.set('year', movie.year)
      id = (await get(`https://api.themoviedb.org/3/search/movie?${q}`)).results?.[0]?.id
    }
    if (!id) {
      db.prepare("UPDATE movies SET details_fetched_at = datetime('now') WHERE id = ?").run(movie.id)
      return { ...movie, details_fetched_at: 'now' }
    }
    const url = (lang) => `https://api.themoviedb.org/3/movie/${id}?${new URLSearchParams({ api_key: apiKey, language: lang, append_to_response: 'credits' })}`
    const d = await get(url('de-DE'))
    const overview = d.overview || (await get(url('en-US'))).overview || null
    const director = (d.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null
    const cast = (d.credits?.cast ?? []).slice(0, 6).map((c) => c.name)
    db.prepare(
      `UPDATE movies SET tmdb_id = ?, overview = ?, release_date = ?, director = ?, cast_json = ?, runtime = COALESCE(runtime, ?),
         poster_url = COALESCE(poster_url, ?), title_original = COALESCE(title_original, ?), original_language = COALESCE(original_language, ?),
         details_fetched_at = datetime('now') WHERE id = ?`
    ).run(id, overview, d.release_date || null, director, JSON.stringify(cast), d.runtime || null, d.poster_path ? IMG + d.poster_path : null, d.original_title ?? null, d.original_language ?? null, movie.id)
    return db.prepare('SELECT * FROM movies WHERE id = ?').get(movie.id)
  } catch {
    return movie
  }
}

export const bigPoster = (url) => (url ? url.replace('/w185/', '/w342/') : null)
