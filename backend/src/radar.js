import { addDays, berlinIso, berlinYmd } from 'shared'
import { optionChanges } from './changes.js'

// K29: Kino-Radar. Erkennung (Ereignis + Ausgangszeile, dedupliziert) und Zustellung sind getrennt.
// Einziger Kanal: in der App (zugestellt = im Posteingang sichtbar). Kein Push/E-Mail/SMS.
export const MAX_ATTEMPTS = 5
const hmOf = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' })
const mins = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }

// Minuten bis Ende der Ruhezeit (0 = gerade keine). Ruhezeit darf über Mitternacht gehen (22:00–07:00).
// ponytail: Wanduhr-Differenz, in den zwei Umstellungsnächten bis zu 60 min daneben; reicht für einen Aufschub.
export function quietMinutesLeft(s, now) {
  if (!s.quiet_start || !s.quiet_end || s.quiet_start === s.quiet_end) return 0
  const t = mins(hmOf(now)), a = mins(s.quiet_start), b = mins(s.quiet_end)
  const inside = a < b ? t >= a && t < b : t >= a || t < b
  return inside ? (b - t + 1440) % 1440 : 0
}

// Neue logische Ereignisse für eingewilligte Personen. Wiederholte/umsortierte Importe treffen denselben dedupe_key.
export function detectRadar(db, { now = new Date(), userId } = {}) {
  const iso = now.toISOString()
  const users = db
    .prepare(`SELECT user_id FROM radar_settings WHERE enabled = 1 AND unsubscribed_at IS NULL ${userId ? 'AND user_id = ?' : ''}`)
    .all(...(userId ? [userId] : []))
  const insEvent = db.prepare(`INSERT INTO radar_events (user_id, kind, dedupe_key, movie_id, proposal_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING`)
  const insOut = db.prepare('INSERT INTO radar_outbox (event_id, next_attempt_at) VALUES (?, ?)')
  // Gemerkter Film hat (wieder) echte kommende Vorstellungen. Ein Ereignis je Merken (created_at), nicht je Import.
  const watches = db.prepare(
    `SELECT w.movie_id, w.created_at, m.title FROM watchlist w JOIN movies m ON m.id = w.movie_id
     WHERE w.user_id = ? AND w.radar_muted = 0 AND (w.expires_on IS NULL OR w.expires_on >= ?)
       AND EXISTS (SELECT 1 FROM screenings s WHERE s.movie_id = w.movie_id AND s.withdrawn_at IS NULL AND datetime(s.starts_at) > datetime(?))`
  )
  // Materielle Änderung an einer gebuchten Vorstellung, an der die Person teilnimmt (K12-Abweichungen, unquittiert).
  const booked = db.prepare(
    `SELECT p.id, p.booked_option_id, o.screening_id, o.snapshot_json FROM proposals p
     JOIN proposal_options o ON o.id = p.booked_option_id
     JOIN proposal_participants pp ON pp.proposal_id = p.id AND pp.user_id = ?
     JOIN household_members hm ON hm.household_id = p.household_id AND hm.user_id = pp.user_id
     WHERE p.status = 'booked'`
  )
  let created = 0
  db.transaction(() => {
    for (const { user_id } of users) {
      const add = (kind, key, movieId, proposalId, payload) => {
        const r = insEvent.run(user_id, kind, key, movieId, proposalId, JSON.stringify(payload))
        if (r.changes) { insOut.run(r.lastInsertRowid, iso); created++ }
      }
      // Nur interne Links, keine Ticket-/Feed-URLs, keine Zahlen, die später nicht mehr stimmen könnten.
      for (const w of watches.all(user_id, berlinYmd(now), iso)) {
        add('watch_available', `watch:${w.movie_id}:${w.created_at}`, w.movie_id, null, { title: w.title, link: `/?q=${encodeURIComponent(w.title)}` })
      }
      for (const p of booked.all(user_id)) {
        const snap = JSON.parse(p.snapshot_json)
        for (const c of optionChanges(db, { id: p.booked_option_id, screening_id: p.screening_id }, snap, now.getTime())) {
          if (!c.acknowledged) add('booked_change', `change:${c.id}`, null, p.id, { title: snap.title, field: c.field, certainty: c.certainty, link: `/vorschlaege/${p.id}` })
        }
      }
    }
  })()
  return created
}

// Fällige Zustellungen: Einwilligung/Stummschaltung/Mitgliedschaft, Ruhezeit und Tageslimit werden JETZT geprüft.
// Fehler → begrenzte Wiederholung mit wachsendem Abstand, danach 'failed' (sichtbar). Mindestens-einmal; in-app ist idempotent.
export function dispatchRadar(db, { now = new Date(), deliver = () => {}, userId } = {}) {
  const iso = now.toISOString()
  const due = db
    .prepare(
      `SELECT o.id, o.attempts, e.user_id, e.kind, e.movie_id, e.proposal_id, e.payload_json FROM radar_outbox o JOIN radar_events e ON e.id = o.event_id
       WHERE o.state = 'pending' AND o.next_attempt_at <= ? ${userId ? 'AND e.user_id = ?' : ''} ORDER BY o.id`
    )
    .all(iso, ...(userId ? [userId] : []))
  const settings = db.prepare('SELECT * FROM radar_settings WHERE user_id = ?')
  const watching = db.prepare(
    `SELECT 1 FROM watchlist w WHERE w.user_id = ? AND w.movie_id = ? AND w.radar_muted = 0
       AND EXISTS (SELECT 1 FROM screenings s WHERE s.movie_id = w.movie_id AND s.withdrawn_at IS NULL AND datetime(s.starts_at) > datetime(?))`
  )
  const member = db.prepare('SELECT 1 FROM proposals p JOIN household_members hm ON hm.household_id = p.household_id WHERE p.id = ? AND hm.user_id = ?')
  const today = berlinYmd(now)
  const dayStart = new Date(berlinIso(today, '00:00')).toISOString()
  const nextDay = new Date(berlinIso(addDays(today, 1), '00:00')).toISOString()
  const sentToday = db.prepare(
    `SELECT COUNT(*) n FROM radar_outbox o JOIN radar_events e ON e.id = o.event_id WHERE e.user_id = ? AND o.state = 'delivered' AND o.delivered_at >= ?`
  )
  const update = db.prepare('UPDATE radar_outbox SET state = ?, attempts = ?, next_attempt_at = ?, last_error = ?, delivered_at = ? WHERE id = ?')
  const stats = { delivered: 0, suppressed: 0, deferred: 0, failed: 0 }
  for (const o of due) {
    const s = settings.get(o.user_id)
    const allowed = s?.enabled && !s.unsubscribed_at &&
      (o.kind === 'watch_available' ? watching.get(o.user_id, o.movie_id, iso) : member.get(o.proposal_id, o.user_id))
    if (!allowed) { update.run('suppressed', o.attempts, iso, null, null, o.id); stats.suppressed++; continue }
    const quiet = quietMinutesLeft(s, now)
    if (quiet || sentToday.get(o.user_id, dayStart).n >= s.daily_cap) {
      update.run('pending', o.attempts, quiet ? new Date(now.getTime() + quiet * 60_000).toISOString() : nextDay, null, null, o.id)
      stats.deferred++
      continue
    }
    try {
      deliver({ id: o.id, user_id: o.user_id, kind: o.kind, payload: JSON.parse(o.payload_json) })
      update.run('delivered', o.attempts + 1, iso, null, iso, o.id)
      stats.delivered++
    } catch (e) {
      const attempts = o.attempts + 1
      const failed = attempts >= MAX_ATTEMPTS
      const wait = Math.min(2 ** attempts * 60_000, 6 * 3600_000)
      update.run(failed ? 'failed' : 'pending', attempts, new Date(now.getTime() + wait).toISOString(), String(e?.message ?? e).slice(0, 200), null, o.id)
      if (failed) stats.failed++
      else stats.deferred++
    }
  }
  return stats
}
