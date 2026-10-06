import { Router } from 'express'
import { z } from 'zod'
import { berlinYmd, canTransition } from 'shared'
import { requireAuth } from '../auth.js'
import { idempotent } from '../idempotency.js'
import { eventForProposal, icsCalendar, publicUrl } from '../ics.js'
import { blocksBooking, optionChanges } from '../changes.js'

const createSchema = z.object({
  movie_id: z.number().int(),
  screening_ids: z.array(z.number().int()).min(1).max(5),
  note: z.string().trim().max(300).optional(),
})
const voteSchema = z.object({ value: z.enum(['yes', 'maybe', 'no']) })
const link = z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u))
const revision = z.number().int().optional()
const bookSchema = z.object({ option_id: z.number().int(), ticket_link: link.nullish(), revision })
const ticketSchema = z.object({ ticket_link: link.nullable(), revision })
const actionSchema = z.object({ revision }).default({})
// K31: geprüfte Ticketdaten (Datum/Uhrzeit nur zum Abgleich, nicht gespeichert).
const seatsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
  auditorium: z.string().trim().max(60).nullish(),
  seats: z.array(z.object({ row: z.string().trim().max(10).nullish(), seat: z.string().trim().min(1).max(10) })).max(20),
  ticket_link: link.nullish(), revision,
})
// Treffpunkt: Zeitpunkt mit Offset (z. B. 2099-10-13T19:45:00+02:00), Ort und Notiz begrenzt; null löscht.
const instant = z.string().max(40).regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?([+-][0-9]{2}:[0-9]{2}|Z)$/).refine((v) => !Number.isNaN(Date.parse(v)))
const meetingSchema = z.object({
  meet_at: instant.nullable(), meet_place: z.string().trim().max(120).nullable(), outing_note: z.string().trim().max(300).nullable(), revision,
})
const addSchema = z.object({ screening_ids: z.array(z.number().int()).min(1).max(4), revision })

// Planungsstatus (open/booked/cancelled) ist getrennt von Anwesenheit (Besuche). Erlaubte Übergänge: shared/contracts.js
// Archiv nach Ereigniszeit: gebuchte Vorstellungen bleiben bis 60 Tage nach Beginn in der Liste, egal wie alt der Vorschlag ist.
const ARCHIVE_AFTER_MS = 60 * 86400_000

// view: 'active' (offen oder gebuchte Vorstellung nicht älter als 60 Tage), 'archive' (Rest), oder id = Einzelabruf ohne Filter.
export function loadProposals(db, householdId, id, view = 'active') {
  const active = `(p.status = 'open' OR (p.status = 'booked' AND datetime(json_extract(bo.snapshot_json, '$.starts_at')) > datetime(?)))`
  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_MS).toISOString()
  const rows = db
    .prepare(
      `SELECT p.*, m.title, m.year, m.runtime FROM proposals p JOIN movies m ON m.id = p.movie_id
       LEFT JOIN proposal_options bo ON bo.id = p.booked_option_id
       WHERE p.household_id = ? AND ${id ? 'p.id = ?' : view === 'archive' ? `NOT ${active}` : active}
       ORDER BY p.created_at DESC, p.id DESC ${view === 'archive' ? 'LIMIT 100' : ''}`
    )
    .all(householdId, id ?? cutoff)
  const opts = db.prepare('SELECT * FROM proposal_options WHERE proposal_id = ? ORDER BY id')
  const votes = db.prepare('SELECT user_id, value FROM votes WHERE option_id = ?')
  const cohort = db.prepare('SELECT user_id FROM proposal_participants WHERE proposal_id = ? ORDER BY user_id')
  return rows.map((p) => ({
    id: p.id,
    status: p.status,
    revision: p.revision,
    movie: { id: p.movie_id, title: p.title, year: p.year, runtime: p.runtime },
    note: p.note,
    created_by: p.created_by,
    booked_option_id: p.booked_option_id,
    ticket_link: p.ticket_link,
    meeting: { meet_at: p.meet_at, meet_place: p.meet_place, outing_note: p.outing_note },
    // K31: Ticketdaten gelten nur für die Option, für die sie geprüft wurden.
    ticket: p.ticket_option_id && p.ticket_option_id === p.booked_option_id
      ? { auditorium: p.ticket_auditorium, seats: JSON.parse(p.ticket_seats_json ?? '[]'), by: p.ticket_by } : null,
    // K15: feste Kohorte (Nenner); fehlende Stimme = unbeantwortet, nie Ja/Nein.
    participants: cohort.all(p.id).map((r) => r.user_id),
    options: opts.all(p.id).map((o) => {
      const snapshot = JSON.parse(o.snapshot_json)
      return {
        id: o.id,
        snapshot,
        votes: Object.fromEntries(votes.all(o.id).map((v) => [v.user_id, v.value])),
        // K12: aktuelle Abweichungen der Live-Vorstellung (Snapshot selbst bleibt unverändert). Nur für laufende Planung.
        changes: p.status === 'cancelled' ? [] : optionChanges(db, o, snapshot),
      }
    }),
  }))
}

export function proposalsRouter(db) {
  const router = Router()
  router.use('/proposals', requireAuth(db))

  const own = (req, res) => {
    const p = db.prepare('SELECT * FROM proposals WHERE id = ? AND household_id = ?').get(Number(req.params.id), req.user.householdId)
    if (!p) res.status(404).json({ error: 'not found' })
    return p
  }

  const members = (hid) => db
    .prepare('SELECT u.id, u.name FROM household_members m JOIN users u ON u.id = m.user_id WHERE m.household_id = ? ORDER BY m.joined_at, u.id')
    .all(hid)

  router.get('/proposals', (req, res) => {
    const view = req.query.view === 'archive' ? 'archive' : 'active'
    res.json({ members: members(req.user.householdId), proposals: loadProposals(db, req.user.householdId, null, view) })
  })

  // Einzelabruf unabhängig von Listen-/Archivfilter (Deep-Link); fremder Haushalt → 404.
  router.get('/proposals/:id([0-9]+)', (req, res) => {
    const p = own(req, res)
    if (!p) return
    const history = db
      .prepare(
        `SELECT e.action, e.revision, e.detail_json, e.created_at, u.name AS user_name FROM proposal_events e
         LEFT JOIN users u ON u.id = e.user_id WHERE e.proposal_id = ? ORDER BY e.id`
      )
      .all(p.id)
      .map(({ detail_json, ...e }) => ({ ...e, detail: JSON.parse(detail_json) }))
    res.json({ members: members(req.user.householdId), proposal: loadProposals(db, req.user.householdId, p.id)[0], history })
  })

  // Bedingter Übergang: nur aus erlaubtem Status und (falls mitgeschickt) aktueller Revision; schreibt Verlauf.
  // Kein Wort über Erstattung: Absagen in Kino storniert keine gekauften Tickets.
  function transition(req, res, action, schema, set, extra) {
    const p = own(req, res)
    if (!p) return
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const d = parsed.data
    if (d.revision !== undefined && d.revision !== p.revision) return res.status(409).json({ error: 'revision conflict' })
    if (!canTransition(action, p.status)) return res.status(409).json({ error: p.status })
    // K18: Eine stattgefundene Buchung wird nicht still verlegt/geöffnet (Besuche hängen daran); Korrektur je Besuch.
    if ((action === 'reschedule' || action === 'reopen') && p.booked_option_id) {
      const b = db.prepare('SELECT snapshot_json FROM proposal_options WHERE id = ?').get(p.booked_option_id)
      if (b && !(Date.parse(JSON.parse(b.snapshot_json).starts_at) > Date.now())) return res.status(409).json({ error: 'completed' })
    }
    let detail = {}
    if (d.option_id !== undefined) {
      const opt = db.prepare('SELECT screening_id, snapshot_json FROM proposal_options WHERE id = ? AND proposal_id = ?').get(d.option_id, p.id)
      if (!opt) return res.status(404).json({ error: 'not found' })
      const snap = JSON.parse(opt.snapshot_json)
      if (!(Date.parse(snap.starts_at) > Date.now())) return res.status(409).json({ error: 'expired' })
      // K12: geänderte Live-Daten müssen vor dem Buchen geprüft werden; verschoben/zurückgezogen ist nicht buchbar.
      const changes = optionChanges(db, { id: d.option_id, screening_id: opt.screening_id }, snap)
      if (changes.some(blocksBooking)) return res.status(409).json({ error: 'changed', changes })
      if (changes.some((c) => !c.acknowledged)) return res.status(409).json({ error: 'review required', changes })
      detail = { option_id: d.option_id, ...(p.booked_option_id && action === 'reschedule' ? { from_option_id: p.booked_option_id } : {}) }
    }
    const ok = db.transaction(() => {
      const { sql, args } = set(d, req)
      const r = db.prepare(`UPDATE proposals SET ${sql}, revision = revision + 1, ics_seq = ics_seq + 1, updated_at = datetime('now')
        WHERE id = ? AND revision = ?`).run(...args, p.id, p.revision)
      if (!r.changes) return false
      if (extra) detail = extra(p, req)
      db.prepare('INSERT INTO proposal_events (proposal_id, user_id, action, revision, detail_json) VALUES (?, ?, ?, ?, ?)')
        .run(p.id, req.user.id, action, p.revision + 1, JSON.stringify(detail))
      return true
    })()
    if (!ok) return res.status(409).json({ error: 'revision conflict' })
    res.json(loadProposals(db, req.user.householdId, p.id)[0])
  }
  const book = (d, req) => ({
    sql: "status = 'booked', booked_option_id = ?, booked_by = ?, booked_at = datetime('now'), ticket_link = COALESCE(?, ticket_link)",
    args: [d.option_id, req.user.id, d.ticket_link ?? null],
  })
  const key = (action) => idempotent(db, (req) => `proposal.${action}:${req.params.id}`)

  // Ein Film, 1-5 verschiedene, kommende, nicht zurückgezogene Vorstellungen. 422 ungültig, 409 inzwischen begonnen.
  function eligibleShows(movieId, ids, res) {
    if (new Set(ids).size !== ids.length) return void res.status(422).json({ error: 'validation failed' })
    const shows = db
      .prepare(
        `SELECT s.*, c.name AS cinema_name, c.street, c.zip, c.lat, c.lng, m.title, m.year, m.runtime
         FROM screenings s JOIN cinemas c ON c.key = s.cinema_key JOIN movies m ON m.id = s.movie_id
         WHERE s.movie_id = ? AND s.withdrawn_at IS NULL AND s.id IN (${ids.map(() => '?').join(',')}) ORDER BY s.starts_at`
      )
      .all(movieId, ...ids)
    if (shows.length !== ids.length) return void res.status(422).json({ error: 'validation failed' })
    // Beim Absenden neu prüfen: inzwischen begonnene Vorstellungen sind nicht mehr wählbar.
    if (shows.some((s) => !(Date.parse(s.starts_at) > Date.now()))) return void res.status(409).json({ error: 'expired' })
    return shows
  }
  function insertOption(pid, s) {
    const snapshot = {
      cinema_key: s.cinema_key, cinema_name: s.cinema_name, street: s.street, zip: s.zip, lat: s.lat, lng: s.lng,
      starts_at: s.starts_at, version: s.version, auditorium: s.auditorium, ticket_url: s.ticket_url,
      title: s.title, year: s.year, runtime: s.runtime,
    }
    return Number(db.prepare('INSERT INTO proposal_options (proposal_id, screening_id, snapshot_json) VALUES (?, ?, ?)').run(pid, s.id, JSON.stringify(snapshot)).lastInsertRowid)
  }

  // K13: offene Abstimmung um Vorstellungen desselben Films ergänzen (max. 5 insgesamt). Neue Optionen starten
  // ohne Stimmen; bestehende Stimmen und Snapshots bleiben unberührt.
  router.post('/proposals/:id/options', key('options'), (req, res) => {
    const p = own(req, res)
    if (!p) return
    const parsed = addSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const { screening_ids, revision: rev } = parsed.data
    if (p.status !== 'open') return res.status(409).json({ error: p.status })
    if (rev !== undefined && rev !== p.revision) return res.status(409).json({ error: 'revision conflict' })
    const existing = db.prepare('SELECT screening_id FROM proposal_options WHERE proposal_id = ?').all(p.id).map((o) => o.screening_id)
    if (existing.length + screening_ids.length > 5 || screening_ids.some((i) => existing.includes(i))) return res.status(422).json({ error: 'validation failed' })
    const shows = eligibleShows(p.movie_id, screening_ids, res)
    if (!shows) return
    const ok = db.transaction(() => {
      if (!db.prepare("UPDATE proposals SET revision = revision + 1, updated_at = datetime('now') WHERE id = ? AND revision = ?").run(p.id, p.revision).changes) return false
      const ids = shows.map((s) => insertOption(p.id, s))
      db.prepare("INSERT INTO proposal_events (proposal_id, user_id, action, revision, detail_json) VALUES (?, ?, 'options', ?, ?)")
        .run(p.id, req.user.id, p.revision + 1, JSON.stringify({ option_ids: ids }))
      return true
    })()
    if (!ok) return res.status(409).json({ error: 'revision conflict' })
    res.json(loadProposals(db, req.user.householdId, p.id)[0])
  })

  router.post('/proposals', idempotent(db, 'proposal.create'), (req, res) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed', details: parsed.error.issues })
    const { movie_id, screening_ids, note } = parsed.data
    const shows = eligibleShows(movie_id, screening_ids, res)
    if (!shows) return

    const id = db.transaction(() => {
      const pid = Number(
        db.prepare('INSERT INTO proposals (household_id, movie_id, created_by, note) VALUES (?, ?, ?, ?)')
          .run(req.user.householdId, movie_id, req.user.id, note || null).lastInsertRowid
      )
      db.prepare("INSERT INTO proposal_events (proposal_id, user_id, action, revision) VALUES (?, ?, 'created', 1)").run(pid, req.user.id)
      db.prepare("INSERT INTO proposal_participants (proposal_id, user_id, source) SELECT ?, user_id, 'snapshot' FROM household_members WHERE household_id = ?")
        .run(pid, req.user.householdId)
      const insVote = db.prepare("INSERT INTO votes (option_id, user_id, value) VALUES (?, ?, 'yes')")
      for (const s of shows) insVote.run(insertOption(pid, s), req.user.id)
      return pid
    })()
    res.status(201).json(loadProposals(db, req.user.householdId, id)[0])
  })

  router.put('/proposals/:id/votes/:optionId', (req, res) => {
    const p = own(req, res)
    if (!p) return
    const parsed = voteSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    // Abstimmen nur, solange offen; danach zählt der gebuchte Stand.
    if (p.status !== 'open') return res.status(409).json({ error: p.status })
    const opt = db.prepare('SELECT id FROM proposal_options WHERE id = ? AND proposal_id = ?').get(Number(req.params.optionId), p.id)
    if (!opt) return res.status(404).json({ error: 'not found' })
    db.transaction(() => {
      db.prepare(
        `INSERT INTO votes (option_id, user_id, value) VALUES (?, ?, ?)
         ON CONFLICT (option_id, user_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).run(opt.id, req.user.id, parsed.data.value)
      // Später Beigetretene werden durch ihre eigene Stimme ausdrücklich Teil der Kohorte (protokolliert über source).
      db.prepare("INSERT OR IGNORE INTO proposal_participants (proposal_id, user_id, source) VALUES (?, ?, 'vote')").run(p.id, req.user.id)
    })()
    res.status(204).end()
  })

  router.post('/proposals/:id/book', key('book'), (req, res) => transition(req, res, 'book', bookSchema, book))
  // Umbuchen ist ein eigener, bestätigter Schritt (nicht verstecktes Neu-Buchen).
  router.post('/proposals/:id/reschedule', key('reschedule'), (req, res) => transition(req, res, 'reschedule', bookSchema, book))
  router.post('/proposals/:id/cancel', key('cancel'), (req, res) => transition(req, res, 'cancel', actionSchema, () => ({ sql: "status = 'cancelled'", args: [] })))
  // Wieder öffnen: Stimmen bleiben erhalten, Buchung wird aufgehoben.
  router.post('/proposals/:id/reopen', key('reopen'), (req, res) =>
    transition(req, res, 'reopen', actionSchema, () => ({ sql: "status = 'open', booked_option_id = NULL, booked_by = NULL, booked_at = NULL", args: [] })))

  // K12: aktuelle Abweichungen geprüft. Quittung statt Snapshot-Änderung; eine Buchung wird nie automatisch verlegt.
  router.post('/proposals/:id/changes/ack', key('review'), (req, res) =>
    transition(req, res, 'review', actionSchema, () => ({ sql: 'status = status', args: [] }), (p, req) => {
      const ids = loadProposals(db, req.user.householdId, p.id)[0].options.flatMap((o) => o.changes.filter((c) => !c.acknowledged).map((c) => c.id))
      const ack = db.prepare("UPDATE option_changes SET acknowledged_at = datetime('now'), acknowledged_by = ? WHERE id = ?")
      for (const id of ids) ack.run(req.user.id, id)
      return { change_ids: ids }
    }))

  // K17: Treffpunkt/Notiz einer gebuchten Vorstellung; Verlauf ohne Inhalte (privat), Revision steigt.
  router.put('/proposals/:id/meeting', (req, res) => {
    const p = own(req, res)
    if (!p) return
    const parsed = meetingSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const d = parsed.data
    if (p.status !== 'booked') return res.status(409).json({ error: 'not booked' })
    if (d.revision !== undefined && d.revision !== p.revision) return res.status(409).json({ error: 'revision conflict' })
    db.transaction(() => {
      db.prepare("UPDATE proposals SET meet_at = ?, meet_place = ?, outing_note = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ?")
        .run(d.meet_at, d.meet_place || null, d.outing_note || null, p.id)
      db.prepare("INSERT INTO proposal_events (proposal_id, user_id, action, revision, detail_json) VALUES (?, ?, 'meeting', ?, '{}')").run(p.id, req.user.id, p.revision + 1)
    })()
    res.json(loadProposals(db, req.user.householdId, p.id)[0])
  })

  // Link zu den gekauften Tickets (aus der Bestätigungs-Mail); landet im Kalendereintrag.
  router.put('/proposals/:id/ticket', (req, res) => {
    const p = own(req, res)
    if (!p) return
    const parsed = ticketSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    if (p.status !== 'booked') return res.status(409).json({ error: 'not booked' })
    if (parsed.data.revision !== undefined && parsed.data.revision !== p.revision) return res.status(409).json({ error: 'revision conflict' })
    db.transaction(() => {
      db.prepare("UPDATE proposals SET ticket_link = ?, updated_at = datetime('now'), ics_seq = ics_seq + 1, revision = revision + 1 WHERE id = ?").run(parsed.data.ticket_link, p.id)
      // Verlauf ohne den Link selbst (privat).
      db.prepare("INSERT INTO proposal_events (proposal_id, user_id, action, revision, detail_json) VALUES (?, ?, 'ticket', ?, '{}')").run(p.id, req.user.id, p.revision + 1)
    })()
    res.json(loadProposals(db, req.user.householdId, p.id)[0])
  })

  // K31: geprüfte Ticketdaten an die Buchung hängen. Abweichendes Datum/Uhrzeit → 409 (nie still umbuchen);
  // Revision + Idempotency-Key; Verlauf ohne Inhalte.
  router.put('/proposals/:id/seats', key('seats'), (req, res) => {
    const p = own(req, res)
    if (!p) return
    const parsed = seatsSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const d = parsed.data
    if (p.status !== 'booked') return res.status(409).json({ error: 'not booked' })
    if (d.revision !== undefined && d.revision !== p.revision) return res.status(409).json({ error: 'revision conflict' })
    const start = new Date(JSON.parse(db.prepare('SELECT snapshot_json FROM proposal_options WHERE id = ?').get(p.booked_option_id).snapshot_json).starts_at)
    const hm = start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' })
    const fields = [d.date && d.date !== berlinYmd(start) && 'date', d.time && d.time !== hm && 'time'].filter(Boolean)
    if (fields.length) return res.status(409).json({ error: 'ticket mismatch', fields })
    const ok = db.transaction(() => {
      const r = db.prepare(`UPDATE proposals SET ticket_option_id = booked_option_id, ticket_auditorium = ?, ticket_seats_json = ?, ticket_by = ?,
          ics_seq = ics_seq + CASE WHEN ? IS NOT NULL AND ? IS NOT ticket_link THEN 1 ELSE 0 END, ticket_link = COALESCE(?, ticket_link),
          revision = revision + 1, updated_at = datetime('now') WHERE id = ? AND revision = ?`)
        .run(d.auditorium || null, JSON.stringify(d.seats.map(({ row, seat }) => ({ row: row || null, seat }))), req.user.id,
          d.ticket_link ?? null, d.ticket_link ?? null, d.ticket_link ?? null, p.id, p.revision)
      if (!r.changes) return false
      db.prepare("INSERT INTO proposal_events (proposal_id, user_id, action, revision, detail_json) VALUES (?, ?, 'seats', ?, ?)")
        .run(p.id, req.user.id, p.revision + 1, JSON.stringify({ seats: d.seats.length }))
      return true
    })()
    if (!ok) return res.status(409).json({ error: 'revision conflict' })
    res.json(loadProposals(db, req.user.householdId, p.id)[0])
  })

  router.get('/proposals/:id.ics', (req, res) => {
    const p = own(req, res)
    if (!p) return
    const ev = eventForProposal(db, p.id, publicUrl(req))
    if (!ev) return res.status(409).json({ error: 'not booked' })
    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="kino-${p.id}.ics"`)
    res.send(icsCalendar([ev]))
  })

  return router
}
