import { normTitle } from 'shared'

const tag = (item, name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(item)?.[1]?.trim()
const decode = (s) => s?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")

export function parseRss(xml) {
  return [...xml.matchAll(/<item>(.*?)<\/item>/gs)]
    .map(([, item]) => ({
      watchedDate: tag(item, 'letterboxd:watchedDate'),
      rating: Number(tag(item, 'letterboxd:memberRating')),
      title: decode(tag(item, 'letterboxd:filmTitle')),
      tmdbId: Number(tag(item, 'tmdb:movieId')) || null,
    }))
    .filter((i) => i.watchedDate && i.rating > 0 && i.title)
}

const dayDiff = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000

// Rating aus dem öffentlichen RSS an Besuche ohne Rating hängen.
export async function syncRatings(db, { fetch, log = () => {} }) {
  const users = db.prepare("SELECT id, letterboxd_user FROM users WHERE letterboxd_user IS NOT NULL AND letterboxd_user != ''").all()
  const pending = db.prepare(
    `SELECT v.id, v.watched_on, json_extract(v.snapshot_json, '$.title') AS title, m.title_original, m.tmdb_id
     FROM visits v LEFT JOIN movies m ON m.id = v.movie_id WHERE v.user_id = ? AND v.letterboxd_synced_at IS NULL`
  )
  const set = db.prepare("UPDATE visits SET letterboxd_rating = ?, letterboxd_synced_at = datetime('now') WHERE id = ?")
  let n = 0
  for (const u of users) {
    try {
      const visits = pending.all(u.id)
      if (!visits.length) continue
      const res = await fetch(`https://letterboxd.com/${encodeURIComponent(u.letterboxd_user)}/rss/`)
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      const items = parseRss(await res.text())
      for (const v of visits) {
        const names = [v.title, v.title_original].filter(Boolean).map(normTitle)
        const hit = items.find(
          (i) => dayDiff(i.watchedDate, v.watched_on) <= 1 && ((i.tmdbId && i.tmdbId === v.tmdb_id) || names.includes(normTitle(i.title)))
        )
        if (hit) {
          set.run(hit.rating, v.id)
          n++
        }
      }
    } catch (e) {
      log(`letterboxd ${u.letterboxd_user}: ${e.message}`)
    }
  }
  return n
}
