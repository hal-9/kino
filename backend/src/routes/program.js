import { Router } from 'express'
import { berlinIso, normTitle } from 'shared'
import { requireAuth } from '../auth.js'
import { addDays } from '../sync/util.js'

const VERSIONS = { ov: ['OV', 'OmU', 'OmeU'], df: ['DF'] }
const YMD = /^\d{4}-\d{2}-\d{2}$/
const berlinToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })

export function programRouter(db) {
  const router = Router()
  router.use(requireAuth(db))

  router.get('/program', (req, res) => {
    const { q, date, version, from, to } = req.query
    for (const v of [date, from, to]) if (v && !YMD.test(v)) return res.status(422).json({ error: 'validation failed' })
    const first = date ?? from
    const last = date ?? to ?? addDays(first ?? berlinToday(), 13)
    const where = ['datetime(s.starts_at) < datetime(?)']
    const args = [berlinIso(addDays(last, 1), '00:00')]
    // Ohne Datum: ab jetzt, nicht ab Mitternacht.
    where.push('datetime(s.starts_at) >= datetime(?)')
    args.push(first ? berlinIso(first, '00:00') : new Date().toISOString())
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
                s.attrs_json, s.ticket_url, m.id AS movie_id, m.title, m.year, m.runtime, m.poster_url
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
        attrs: JSON.parse(r.attrs_json), ticket_url: r.ticket_url,
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
      .prepare(`SELECT DISTINCT substr(starts_at, 1, 10) AS d FROM screenings WHERE datetime(starts_at) >= datetime('now') ORDER BY d`)
      .all()
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
    res.json({ sources: db.prepare('SELECT source, last_ok_at, last_count, last_error, last_error_at FROM source_health ORDER BY source').all() })
  })

  return router
}
