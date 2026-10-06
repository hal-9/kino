import { normTitle } from 'shared'

const IMG = 'https://image.tmdb.org/t/p/w185'
const HOUR = 3600_000
const NOT_FOUND_RETRY = 7 * 24 * HOUR
const MAX_BACKOFF = 7 * 24 * HOUR

const yearOf = (r) => Number(String(r.release_date ?? '').slice(0, 4)) || null

// Zuordnung nur mit Evidenz: exakter normalisierter Titel (deutsch oder original) und passendes Jahr (±1).
// Ohne Jahr: einziger Titeltreffer, sonst nur ein Treffer aus ±1 Jahr um heute. Mehrere → ambiguous, keiner → not_found.
export function pickTmdb(results, movie, today = new Date()) {
  const want = normTitle(movie.title)
  const titled = (results ?? []).filter((r) => [r.title, r.original_title].some((t) => t && normTitle(t) === want))
  let pool
  if (movie.year) {
    const exact = titled.filter((r) => yearOf(r) === movie.year)
    pool = exact.length ? exact : titled.filter((r) => yearOf(r) && Math.abs(yearOf(r) - movie.year) <= 1)
  } else {
    pool = titled.length === 1 ? titled : titled.filter((r) => yearOf(r) && Math.abs(yearOf(r) - today.getUTCFullYear()) <= 1)
  }
  if (pool.length === 1) return { status: 'matched', hit: pool[0] }
  return { status: pool.length > 1 || (!movie.year && titled.length > 1) ? 'ambiguous' : 'not_found' }
}

const iso = (ms) => new Date(ms).toISOString()

function record(db, id, status, nextMs, failures = 0) {
  db.prepare('UPDATE movies SET tmdb_status = ?, tmdb_attempt_at = ?, tmdb_next_retry_at = ?, tmdb_failures = ? WHERE id = ?')
    .run(status, iso(Date.now()), nextMs == null ? null : iso(nextMs), failures, id)
}

// Sucht und hält den Zustand fest. Gibt den Treffer zurück oder null; Netz-/HTTP-Fehler werden (nach Backoff-Vermerk) geworfen.
async function resolve(db, movie, { fetch, apiKey }) {
  try {
    const q = new URLSearchParams({ api_key: apiKey, query: movie.title, language: 'de-DE' })
    if (movie.year) q.set('year', movie.year)
    const res = await fetch(`https://api.themoviedb.org/3/search/movie?${q}`, { signal: AbortSignal.timeout(10_000) })
    if (res.status !== 200) {
      const e = new Error(`HTTP ${res.status}`)
      e.status = res.status
      e.retryAfter = Number(res.headers?.get?.('Retry-After')) || null
      throw e
    }
    const r = pickTmdb((await res.json()).results, movie)
    if (r.status !== 'matched') { record(db, movie.id, r.status, Date.now() + NOT_FOUND_RETRY); return null }
    db.prepare('UPDATE movies SET tmdb_id = ?, poster_url = ?, title_original = ?, original_language = ?, tmdb_checked_at = datetime(\'now\') WHERE id = ?')
      .run(r.hit.id, r.hit.poster_path ? IMG + r.hit.poster_path : null, r.hit.original_title ?? null, r.hit.original_language ?? null, movie.id)
    record(db, movie.id, 'matched', null)
    return r.hit
  } catch (e) {
    const failures = (movie.tmdb_failures ?? 0) + 1
    const wait = e.retryAfter ? e.retryAfter * 1000 : Math.min(2 ** failures * HOUR, MAX_BACKOFF)
    record(db, movie.id, 'failed', Date.now() + wait, failures)
    throw e
  }
}

const due = (m) => m.tmdb_status !== 'manual' && (!m.tmdb_next_retry_at || m.tmdb_next_retry_at <= iso(Date.now()))

// Ohne TMDB_API_KEY ein No-Op. Je Lauf max. 30 fällige Filme; 429 beendet den Lauf.
export async function enrich(db, { fetch, apiKey = process.env.TMDB_API_KEY, log = () => {} } = {}) {
  if (!apiKey) return 0
  const movies = db
    .prepare(
      `SELECT m.* FROM movies m
       WHERE m.tmdb_id IS NULL AND COALESCE(m.tmdb_status, '') != 'manual' AND (m.tmdb_next_retry_at IS NULL OR m.tmdb_next_retry_at <= ?)
         AND EXISTS (SELECT 1 FROM screenings s WHERE s.movie_id = m.id AND datetime(s.starts_at) > datetime('now'))
       ORDER BY m.id DESC LIMIT 30`
    )
    .all(iso(Date.now()))
  let n = 0
  for (const m of movies) {
    try {
      if (await resolve(db, m, { fetch, apiKey })) n++
    } catch (e) {
      log(`tmdb ${m.title}: ${e.message}`)
      if (e.status === 429) break
    }
  }
  return n
}

// Details (Inhalt, Regie, Besetzung) einmalig holen und in movies cachen. details_fetched_at nur bei Erfolg mit tmdb_id;
// ohne Treffer greift das Retry-Fenster. Ohne Key oder bei Fehler bleibt der Film unverändert nutzbar.
export async function ensureDetails(db, movie, { fetch, apiKey = process.env.TMDB_API_KEY } = {}) {
  if (!apiKey || movie.details_fetched_at) return movie
  const reload = () => db.prepare('SELECT * FROM movies WHERE id = ?').get(movie.id)
  const get = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
  try {
    let id = movie.tmdb_id
    if (!id) {
      if (!due(movie)) return movie
      id = (await resolve(db, movie, { fetch, apiKey }))?.id
      if (!id) return reload()
    }
    const url = (lang) => `https://api.themoviedb.org/3/movie/${id}?${new URLSearchParams({ api_key: apiKey, language: lang, append_to_response: 'credits' })}`
    const d = await get(url('de-DE'))
    const overview = d.overview || (await get(url('en-US'))).overview || null
    const director = (d.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null
    const cast = (d.credits?.cast ?? []).slice(0, 6).map((c) => c.name)
    db.prepare(
      `UPDATE movies SET overview = ?, release_date = ?, director = ?, cast_json = ?, runtime = COALESCE(runtime, ?),
         poster_url = COALESCE(poster_url, ?), title_original = COALESCE(title_original, ?), original_language = COALESCE(original_language, ?),
         details_fetched_at = datetime('now') WHERE id = ?`
    ).run(overview, d.release_date || null, director, JSON.stringify(cast), d.runtime || null, d.poster_path ? IMG + d.poster_path : null, d.original_title ?? null, d.original_language ?? null, movie.id)
    return reload()
  } catch {
    return reload()
  }
}

// Manuelle Zuordnung (tmdb_id oder null = "kein TMDB-Film"): nur Metadaten dieses Films, Buchungen/Snapshots unberührt.
export function setManual(db, movieId, tmdbId) {
  db.prepare(
    `UPDATE movies SET tmdb_id = ?, tmdb_status = 'manual', tmdb_attempt_at = ?, tmdb_next_retry_at = NULL, tmdb_failures = 0,
       poster_url = NULL, title_original = NULL, original_language = NULL, overview = NULL, release_date = NULL, director = NULL, cast_json = NULL,
       details_fetched_at = NULL WHERE id = ?`
  ).run(tmdbId, iso(Date.now()), movieId)
}

export const bigPoster = (url) => (url ? url.replace('/w185/', '/w342/') : null)
