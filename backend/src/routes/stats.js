import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { materializeVisits } from '../autoVisits.js'

const OV = new Set(['OV', 'OmU', 'OmeU'])

// Häufigster Wert einer Liste: { name, count } oder null. Bei Gleichstand gewinnt der zuerst gesehene.
function top(values) {
  const counts = new Map()
  for (const v of values) if (v != null && v !== '') counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = null
  for (const [name, count] of counts) if (!best || count > best.count) best = { name, count }
  return best
}

export function statsRouter(db) {
  const router = Router()
  router.use('/stats', requireAuth(db))

  router.get('/stats/wrapped', (req, res) => {
    const year = String(req.query.year ?? new Date().getFullYear())
    const scope = req.query.scope === 'group' ? 'group' : 'me'
    if (!/^\d{4}$/.test(year)) return res.status(422).json({ error: 'validation failed' })

    materializeVisits(db, req.user.householdId)
    const rows = db
      .prepare(
        `SELECT v.*, m.runtime AS movie_runtime FROM visits v LEFT JOIN movies m ON m.id = v.movie_id
         WHERE substr(v.watched_on, 1, 4) = ? AND ${scope === 'me' ? 'v.user_id' : 'v.household_id'} = ?
         ORDER BY v.watched_on, v.id`
      )
      .all(year, scope === 'me' ? req.user.id : req.user.householdId)
      .map((v) => ({ ...v, s: JSON.parse(v.snapshot_json), companions: JSON.parse(v.companions_json) }))

    const names = new Map(db.prepare('SELECT id, name FROM users').all().map((u) => [u.id, u.name]))
    const withVersion = rows.filter((v) => v.s.version)
    const first = rows[0]
    const last = rows.at(-1)
    const month = top(rows.map((v) => v.watched_on.slice(5, 7)))
    const out = {
      year: Number(year),
      scope,
      count: rows.length,
      minutes: rows.reduce((n, v) => n + (v.movie_runtime ?? v.s.runtime ?? 120), 0),
      ov_share: withVersion.length ? withVersion.filter((v) => OV.has(v.s.version)).length / withVersion.length : null,
      top_cinema: top(rows.map((v) => v.s.cinema_name)),
      top_auditorium: top(rows.map((v) => v.auditorium && `${v.s.cinema_name} · ${v.auditorium}`)),
      top_row: top(rows.map((v) => v.row)),
      top_companion: top(rows.flatMap((v) => v.companions.map((id) => names.get(id)))),
      top_month: month ? { month: Number(month.name), count: month.count } : null,
      first: first ? { title: first.s.title, date: first.watched_on } : null,
      last: last ? { title: last.s.title, date: last.watched_on } : null,
    }
    res.json(out)
  })

  return router
}
