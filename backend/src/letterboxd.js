import { normTitle } from 'shared'

const tag = (item, name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(item)?.[1]?.trim()
const guid = (item) => /<guid[^>]*>([^<]*)<\/guid>/.exec(item)?.[1]?.trim()
const decode = (s) => s?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")

// Einträge mit stabiler guid; rating null = ohne Bewertung (z. B. Bewertung entfernt).
export function parseRss(xml) {
  return [...xml.matchAll(/<item>(.*?)<\/item>/gs)]
    .map(([, item]) => ({
      guid: guid(item),
      watchedDate: tag(item, 'letterboxd:watchedDate'),
      rating: Number(tag(item, 'letterboxd:memberRating')) || null,
      title: decode(tag(item, 'letterboxd:filmTitle')),
      tmdbId: Number(tag(item, 'tmdb:movieId')) || null,
    }))
    .filter((i) => i.guid && i.watchedDate && i.title)
}

const dayDiff = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000

// Kandidat: ±1 Tag und derselbe Film. Sind beide TMDB-IDs bekannt, entscheidet nur die ID (Remakes, gleiche Titel).
const fits = (v, i) => {
  if (dayDiff(i.watchedDate, v.watched_on) > 1) return false
  if (i.tmdbId && v.tmdb_id) return i.tmdbId === v.tmdb_id
  return [v.title, v.title_original].filter(Boolean).map(normTitle).includes(normTitle(i.title))
}

async function syncUser(db, u, { fetch }) {
  const now = new Date().toISOString()
  db.prepare('UPDATE users SET letterboxd_attempt_at = ? WHERE id = ?').run(now, u.id)
  try {
    const res = await fetch(`https://letterboxd.com/${encodeURIComponent(u.letterboxd_user)}/rss/`)
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    const items = parseRss(await res.text())
    const dates = items.map((i) => i.watchedDate).sort()
    const status = { from: dates[0] ?? null, to: dates.at(-1) ?? null, entries: items.length, linked: 0, updated: 0, ambiguous: 0 }
    db.transaction(() => {
      const visits = db
        .prepare(
          `SELECT v.id, v.watched_on, v.letterboxd_entry, v.letterboxd_account, v.letterboxd_rating, json_extract(v.snapshot_json, '$.title') AS title,
             m.title_original, m.tmdb_id
           FROM visits v LEFT JOIN movies m ON m.id = v.movie_id WHERE v.user_id = ?`
        )
        .all(u.id)
      const set = db.prepare('UPDATE visits SET letterboxd_entry = ?, letterboxd_account = ?, letterboxd_rating = ?, letterboxd_synced_at = ? WHERE id = ?')
      const byGuid = new Map(items.map((i) => [i.guid, i]))
      const taken = new Set()
      const open = []
      for (const v of visits) {
        if (!v.letterboxd_entry) { open.push(v); continue }
        // Verknüpfung eines anderen Kontos bleibt eingefroren (kein stilles Umhängen).
        if (v.letterboxd_account !== u.letterboxd_user) continue
        taken.add(v.letterboxd_entry)
        const i = byGuid.get(v.letterboxd_entry)
        // Nicht mehr im Feed (aus dem Fenster gefallen) ≠ gelöscht: Wert bleibt.
        if (i && i.rating !== v.letterboxd_rating) {
          set.run(v.letterboxd_entry, u.letterboxd_user, i.rating, now, v.id)
          status.updated++
        }
      }
      const free = items.filter((i) => !taken.has(i.guid))
      const cand = new Map(open.map((v) => [v.id, free.filter((i) => fits(v, i))]))
      for (const v of open) {
        const c = cand.get(v.id)
        if (!c.length) continue
        // Nur eindeutige Paare: ein Eintrag für den Besuch und der Eintrag passt zu keinem anderen offenen Besuch.
        const unique = c.length === 1 && open.every((w) => w === v || !cand.get(w.id).includes(c[0]))
        if (!unique) { status.ambiguous++; continue }
        set.run(c[0].guid, u.letterboxd_user, c[0].rating, now, v.id)
        status.linked++
      }
    })()
    db.prepare('UPDATE users SET letterboxd_ok_at = ?, letterboxd_error = NULL, letterboxd_status_json = ? WHERE id = ?').run(now, JSON.stringify(status), u.id)
    return status.linked + status.updated
  } catch (e) {
    db.prepare('UPDATE users SET letterboxd_error = ? WHERE id = ?').run(e.message.slice(0, 200), u.id)
    throw e
  }
}

// Bewertungen aus dem öffentlichen RSS (nur die letzten Einträge, keine vollständige Historie) abgleichen.
// userId: nur dieses Konto (manueller Abgleich).
export async function syncRatings(db, { fetch, log = () => {}, userId = null }) {
  const users = db
    .prepare("SELECT id, letterboxd_user FROM users WHERE letterboxd_user IS NOT NULL AND letterboxd_user != '' AND (? IS NULL OR id = ?)")
    .all(userId, userId)
  let n = 0
  for (const u of users) {
    try {
      n += await syncUser(db, u, { fetch })
    } catch (e) {
      log(`letterboxd ${u.letterboxd_user}: ${e.message}`)
    }
  }
  return n
}

// Status für die Einstellungen; other_account = Besuche, die noch mit einem früheren Konto verknüpft sind.
export function ratingStatus(db, userId) {
  const u = db.prepare('SELECT letterboxd_user, letterboxd_attempt_at, letterboxd_ok_at, letterboxd_error, letterboxd_status_json FROM users WHERE id = ?').get(userId)
  const other = db
    .prepare('SELECT COUNT(*) n FROM visits WHERE user_id = ? AND letterboxd_entry IS NOT NULL AND letterboxd_account IS NOT ?')
    .get(userId, u.letterboxd_user).n
  return {
    attempt_at: u.letterboxd_attempt_at, ok_at: u.letterboxd_ok_at, error: u.letterboxd_error,
    ...(u.letterboxd_status_json ? JSON.parse(u.letterboxd_status_json) : {}), other_account: other,
  }
}
