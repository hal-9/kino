import { Router } from 'express'
import { aggregateVisits, berlinYmd, normRoom } from 'shared'
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

// K33: optionale Story-Karten aus denselben Zeilen wie die Kennzahlen. Nur erfasste Daten, Nenner immer dabei,
// keine Namen (auch nicht von Bewertenden); zu wenig Daten → null bzw. ausdrücklich ausgelassen.
export const MIN_RATED_FILMS = 3
function story(rows, scope) {
  const eventOf = (v) => v.event_key ?? `visit:${v.id}`
  const outings = new Set(rows.map(eventOf)).size
  const first = rows.find((v) => v.attendance === 'confirmed' || v.attendance === 'manual')
  // Lieblingskino nach Kinoabenden (verschiedene Vorstellungen), nicht nach Personenbesuchen.
  const byCinema = new Map()
  const byRoom = new Map()
  for (const v of rows) {
    if (v.s.cinema_name) (byCinema.get(v.s.cinema_name) ?? byCinema.set(v.s.cinema_name, new Set()).get(v.s.cinema_name)).add(eventOf(v))
    const room = v.auditorium && v.s.cinema_key ? `${v.s.cinema_key}|${normRoom(v.auditorium)}` : null
    if (room) (byRoom.get(room) ?? byRoom.set(room, { name: `${v.s.cinema_name} · ${v.auditorium}`, events: new Set() }).get(room)).events.add(eventOf(v))
  }
  const best = (entries) => entries.reduce((a, b) => (!a || b[1] > a[1] ? b : a), null)
  const venue = best([...byCinema].map(([name, ev]) => [name, ev.size]))
  const room = best([...byRoom.values()].map((r) => [r.name, r.events.size]))
  const posters = [...new Map(rows.filter((v) => v.movie_poster && v.movie_id).map((v) => [v.movie_id, v.movie_poster])).values()].slice(0, 9)
  let agreement = null
  if (scope === 'group') {
    // Filme mit ausdrücklichen Bewertungen (eigene vor Letterboxd) von mindestens zwei Personen.
    const films = new Map()
    for (const v of rows) {
      const r = v.manual_rating ?? v.letterboxd_rating
      if (r == null || !v.movie_id) continue
      const f = films.get(v.movie_id) ?? films.set(v.movie_id, { title: v.s.title, by: new Map() }).get(v.movie_id)
      f.by.set(v.user_id, r)
    }
    const rated = [...films.values()].filter((f) => f.by.size >= 2).map((f) => {
      const rs = [...f.by.values()]
      return { title: f.title, raters: rs.length, spread: Math.max(...rs) - Math.min(...rs) }
    })
    agreement = rated.length < MIN_RATED_FILMS
      ? { omitted: 'too_few_ratings', rated_films: rated.length, min: MIN_RATED_FILMS }
      : {
        rated_films: rated.length, min: MIN_RATED_FILMS,
        closest: rated.reduce((a, b) => (b.spread < a.spread ? b : a)),
        widest: rated.reduce((a, b) => (b.spread > a.spread ? b : a)),
      }
  }
  return {
    first_confirmed: first ? { title: first.s.title, date: first.watched_on } : null,
    favorite_venue: venue ? { name: venue[0], outings: venue[1], of: outings } : null,
    revisited_room: room && room[1] >= 2 ? { name: room[0], outings: room[1] } : null,
    posters,
    agreement,
  }
}

export function statsRouter(db) {
  const router = Router()
  router.use('/stats', requireAuth(db))

  router.get('/stats/wrapped', (req, res) => {
    const year = String(req.query.year ?? berlinYmd().slice(0, 4))
    const scope = req.query.scope === 'group' ? 'group' : 'me'
    if (!/^\d{4}$/.test(year)) return res.status(422).json({ error: 'validation failed' })

    materializeVisits(db, req.user.householdId)
    const rows = db
      .prepare(
        // watched_on ist ein Berliner Kalenderdatum → Jahr = Berliner Jahr. Verknüpfte Vorstellung: Screening der
        // gebuchten Option, sonst die Buchung selbst; ohne Buchung ungruppiert.
        `SELECT v.*, m.runtime AS movie_runtime, m.poster_url AS movie_poster,
           CASE WHEN o.screening_id IS NOT NULL THEN 'screening:' || o.screening_id WHEN v.proposal_id IS NOT NULL THEN 'proposal:' || v.proposal_id END AS event_key
         FROM visits v LEFT JOIN movies m ON m.id = v.movie_id
           LEFT JOIN proposals p ON p.id = v.proposal_id LEFT JOIN proposal_options o ON o.id = p.booked_option_id
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
    // minutes = nur bekannte Laufzeiten (früher 120 min für unbekannte geschätzt); count = Personenbesuche.
    const agg = aggregateVisits(rows.map((v) => ({ ...v, runtime: v.movie_runtime ?? v.s.runtime })))
    const out = {
      year: Number(year),
      scope,
      ...agg,
      count: agg.person_visits,
      ov_share: withVersion.length ? withVersion.filter((v) => OV.has(v.s.version)).length / withVersion.length : null,
      top_cinema: top(rows.map((v) => v.s.cinema_name)),
      top_auditorium: top(rows.map((v) => v.auditorium && `${v.s.cinema_name} · ${v.auditorium}`)),
      top_row: top(rows.map((v) => v.row)),
      top_companion: top(rows.flatMap((v) => v.companions.map((id) => names.get(id)))),
      top_month: month ? { month: Number(month.name), count: month.count } : null,
      first: first ? { title: first.s.title, date: first.watched_on } : null,
      last: last ? { title: last.s.title, date: last.watched_on } : null,
    }
    out.story = story(rows, scope)
    res.json(out)
  })

  // K36: Nutzen der Planung aus vorhandenen Zeitstempeln, nur Haushalt, nur Zahlen (keine Notizen/Tickets/Namen).
  // Fenster = Vorschläge, die in den letzten `days` Tagen angelegt wurden (Standard 90).
  router.get('/stats/coordination', (req, res) => {
    const days = Number(req.query.days ?? 90)
    if (!Number.isInteger(days) || days < 1 || days > 365) return res.status(422).json({ error: 'validation failed' })
    const hid = req.user.householdId
    const since = new Date(Date.now() - days * 86400_000).toISOString()
    const props = db
      .prepare(
        `SELECT p.status, p.created_at,
           (SELECT MIN(e.created_at) FROM proposal_events e WHERE e.proposal_id = p.id AND e.action = 'book') AS first_book
         FROM proposals p WHERE p.household_id = ? AND datetime(p.created_at) >= datetime(?)`
      )
      .all(hid, since)
    const count = (st) => props.filter((p) => p.status === st).length
    const booked = count('booked'), cancelled = count('cancelled')
    const hours = props
      .filter((p) => p.first_book)
      .map((p) => (Date.parse(`${p.first_book.replace(' ', 'T')}Z`) - Date.parse(`${p.created_at.replace(' ', 'T')}Z`)) / 3600_000)
      .sort((a, b) => a - b)
    const median = hours.length ? Math.round(((hours[(hours.length - 1) >> 1] + hours[hours.length >> 1]) / 2) * 10) / 10 : null
    // Offene Vorschläge (unabhängig vom Fenster): Teilnehmende ohne irgendeine Stimme.
    const waiting = db
      .prepare(
        `SELECT p.id, COUNT(pp.user_id) AS unanswered FROM proposals p JOIN proposal_participants pp ON pp.proposal_id = p.id
         WHERE p.household_id = ? AND p.status = 'open'
           AND NOT EXISTS (SELECT 1 FROM votes v JOIN proposal_options o ON o.id = v.option_id WHERE o.proposal_id = p.id AND v.user_id = pp.user_id)
         GROUP BY p.id`
      )
      .all(hid)
    const sources = db.prepare('SELECT source, last_ok_at, last_error_at FROM source_health ORDER BY source').all()
    const failing = sources.filter((s) => !s.last_ok_at || (s.last_error_at && s.last_error_at > s.last_ok_at)).map((s) => s.source)
    const reviewed = db
      .prepare(
        `SELECT COUNT(*) n FROM option_changes c JOIN proposal_options o ON o.id = c.option_id JOIN proposals p ON p.id = o.proposal_id
         WHERE p.household_id = ? AND c.acknowledged_at IS NOT NULL AND datetime(c.acknowledged_at) >= datetime(?)`
      )
      .get(hid, since).n
    const attendance = Object.fromEntries(
      db.prepare(`SELECT attendance, COUNT(*) n FROM visits WHERE household_id = ? AND watched_on >= ? GROUP BY attendance`).all(hid, since.slice(0, 10)).map((r) => [r.attendance, r.n])
    )
    res.json({
      days,
      proposals: { created: props.length, open: count('open'), booked, cancelled, booked_share_of_decided: booked + cancelled ? booked / (booked + cancelled) : null },
      decision_hours_median: median,
      decided_with_time: hours.length,
      open_waiting: { proposals: waiting.length, unanswered_people: waiting.reduce((n, w) => n + w.unanswered, 0) },
      sources: { total: sources.length, failing },
      changes_reviewed: reviewed,
      visits: { confirmed: attendance.confirmed ?? 0, manual: attendance.manual ?? 0, inferred: attendance.inferred ?? 0, legacy: attendance.legacy ?? 0 },
    })
  })

  return router
}
