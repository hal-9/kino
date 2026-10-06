import { Router } from 'express'
import { addDays, berlinIso, berlinYmd, isValidYmd, normTitle } from 'shared'
import { requireAuth } from '../auth.js'

const VERSIONS = { ov: ['OV', 'OmU', 'OmeU'], df: ['DF'] }

// Auslastungsangaben älter als 24 h (Sync alle 12 h) gelten als unbekannt.
const CAPACITY_TTL_MS = 24 * 3600_000
function capacityOf(r, now) {
  const capacity = r.capacity_at && now - Date.parse(r.capacity_at) < CAPACITY_TTL_MS ? r.capacity : null
  const attrs = JSON.parse(r.attrs_json)
  return { capacity, attrs: capacity === 'nearly_sold_out' ? [...attrs, 'fast ausverkauft'] : attrs }
}

export function programRouter(db) {
  const router = Router()
  router.use(requireAuth(db))

  router.get('/program', (req, res) => {
    const { q, date, version, from, to } = req.query
    for (const v of [date, from, to]) if (v !== undefined && !isValidYmd(v)) return res.status(422).json({ error: 'validation failed' })
    if (from && to && from > to) return res.status(422).json({ error: 'validation failed' })
    const now = Date.now()
    const first = date ?? from
    const last = date ?? to ?? addDays(first ?? berlinYmd(new Date(now)), 13)
    const where = ['s.withdrawn_at IS NULL', 'datetime(s.starts_at) < datetime(?)']
    const args = [berlinIso(addDays(last, 1), '00:00')]
    // Nur kommende Vorstellungen, auch bei explizitem Datum (vergangene sind nicht mehr wählbar).
    where.push('datetime(s.starts_at) >= datetime(?)')
    args.push(new Date(Math.max(now, first ? Date.parse(berlinIso(first, '00:00')) : 0)).toISOString())
    if (q) {
      where.push('(m.norm_title LIKE ? OR lower(m.title) LIKE ?)')
      args.push(`%${normTitle(q)}%`, `%${String(q).toLowerCase()}%`)
    }
    if (VERSIONS[String(version).toLowerCase()]) {
      const vs = VERSIONS[String(version).toLowerCase()]
      where.push(`s.version IN (${vs.map(() => '?').join(',')})`)
      args.push(...vs)
    }
    const rows = db
      .prepare(
        `SELECT s.id, s.cinema_key, c.name AS cinema_name, c.is_favorite, s.starts_at, s.version, s.auditorium, a.seats,
                s.attrs_json, s.ticket_url, s.capacity, s.capacity_at, m.id AS movie_id, m.title, m.year, m.runtime, m.poster_url
         FROM screenings s JOIN movies m ON m.id = s.movie_id JOIN cinemas c ON c.key = s.cinema_key
         LEFT JOIN auditoriums a ON a.cinema_key = s.cinema_key AND a.name = s.auditorium
         WHERE ${where.join(' AND ')} ORDER BY s.starts_at LIMIT 6000`
      )
      .all(...args)

    const movies = new Map()
    for (const r of rows) {
      if (!movies.has(r.movie_id)) {
        movies.set(r.movie_id, { id: r.movie_id, title: r.title, year: r.year, runtime: r.runtime, poster_url: r.poster_url, screenings: [] })
      }
      movies.get(r.movie_id).screenings.push({
        id: r.id, cinema_key: r.cinema_key, cinema_name: r.cinema_name, is_favorite: Boolean(r.is_favorite),
        starts_at: r.starts_at, version: r.version, auditorium: r.auditorium, seats: r.seats,
        ...capacityOf(r, now), ticket_url: r.ticket_url,
      })
    }
    const list = [...movies.values()]
    for (const m of list) {
      // Favoriten zuerst, dann Tag; in der zweiten Reihe größere Säle zuerst.
      m.screenings.sort(
        (a, b) =>
          b.is_favorite - a.is_favorite ||
          a.starts_at.slice(0, 10).localeCompare(b.starts_at.slice(0, 10)) ||
          (a.is_favorite ? 0 : (b.seats ?? -1) - (a.seats ?? -1)) ||
          a.starts_at.localeCompare(b.starts_at)
      )
    }
    list.sort((a, b) => Number(b.screenings.some((s) => s.is_favorite)) - Number(a.screenings.some((s) => s.is_favorite)) || a.title.localeCompare(b.title, 'de'))
    res.json({ movies: list })
  })

  router.get('/program/days', (req, res) => {
    const days = db
      .prepare(`SELECT DISTINCT substr(starts_at, 1, 10) AS d FROM screenings WHERE withdrawn_at IS NULL AND datetime(starts_at) >= datetime(?) ORDER BY d`)
      .all(new Date().toISOString())
      .map((r) => r.d)
    res.json({ days })
  })

  router.get('/cinemas', (req, res) => {
    const auds = db.prepare('SELECT * FROM auditoriums ORDER BY cinema_key, name').all()
    const cinemas = db
      .prepare('SELECT key, name, chain, street, zip, city, lat, lng, is_favorite FROM cinemas ORDER BY is_favorite DESC, name')
      .all()
      .map((c) => ({ ...c, is_favorite: Boolean(c.is_favorite), auditoriums: auds.filter((a) => a.cinema_key === c.key) }))
    res.json({ cinemas })
  })

  router.get('/sources', (req, res) => {
    res.json({ sources: db.prepare(`SELECT source, last_ok_at, last_count, last_error, last_error_at, last_attempt_at, last_captured_at, last_complete_import_at
       FROM source_health ORDER BY source`).all() })
  })

  return router
}
