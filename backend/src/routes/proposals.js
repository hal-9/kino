import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { eventForProposal, icsCalendar, publicUrl } from '../ics.js'

const createSchema = z.object({
  movie_id: z.number().int(),
  screening_ids: z.array(z.number().int()).min(1).max(5),
  note: z.string().trim().max(300).optional(),
})
const voteSchema = z.object({ value: z.enum(['yes', 'maybe', 'no']) })
const link = z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u))
const bookSchema = z.object({ option_id: z.number().int(), ticket_link: link.nullish() })
const ticketSchema = z.object({ ticket_link: link.nullable() })

export function loadProposals(db, householdId, id) {
  const rows = db
    .prepare(
      `SELECT p.*, m.title, m.year, m.runtime FROM proposals p JOIN movies m ON m.id = p.movie_id
       WHERE p.household_id = ? AND ${id ? 'p.id = ?' : `p.status != 'cancelled' AND (p.status = 'open' OR datetime(p.updated_at) > datetime('now', '-60 days'))`}
       ORDER BY p.created_at DESC, p.id DESC`
    )
    .all(...(id ? [householdId, id] : [householdId]))
  const opts = db.prepare('SELECT * FROM proposal_options WHERE proposal_id = ? ORDER BY id')
  const votes = db.prepare('SELECT user_id, value FROM votes WHERE option_id = ?')
  return rows.map((p) => ({
    id: p.id,
    status: p.status,
    movie: { id: p.movie_id, title: p.title, year: p.year, runtime: p.runtime },
    note: p.note,
    created_by: p.created_by,
    booked_option_id: p.booked_option_id,
    ticket_link: p.ticket_link,
    options: opts.all(p.id).map((o) => ({
      id: o.id,
      snapshot: JSON.parse(o.snapshot_json),
      votes: Object.fromEntries(votes.all(o.id).map((v) => [v.user_id, v.value])),
    })),
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

  router.get('/proposals', (req, res) => {
    const members = db
      .prepare('SELECT u.id, u.name FROM household_members m JOIN users u ON u.id = m.user_id WHERE m.household_id = ? ORDER BY m.joined_at, u.id')
      .all(req.user.householdId)
    res.json({ members, proposals: loadProposals(db, req.user.householdId) })
  })

  router.post('/proposals', (req, res) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed', details: parsed.error.issues })
    const { movie_id, screening_ids, note } = parsed.data
    const ids = [...new Set(screening_ids)]
    const shows = db
      .prepare(
        `SELECT s.*, c.name AS cinema_name, c.street, c.zip, c.lat, c.lng, m.title, m.year, m.runtime
         FROM screenings s JOIN cinemas c ON c.key = s.cinema_key JOIN movies m ON m.id = s.movie_id
         WHERE s.movie_id = ? AND s.id IN (${ids.map(() => '?').join(',')}) ORDER BY s.starts_at`
      )
      .all(movie_id, ...ids)
    if (shows.length !== ids.length) return res.status(422).json({ error: 'validation failed' })
    // Beim Absenden neu prüfen: inzwischen begonnene Vorstellungen sind nicht mehr wählbar.
    if (shows.some((s) => !(Date.parse(s.starts_at) > Date.now()))) return res.status(409).json({ error: 'expired' })

    const id = db.transaction(() => {
      const pid = Number(
        db.prepare('INSERT INTO proposals (household_id, movie_id, created_by, note) VALUES (?, ?, ?, ?)')
          .run(req.user.householdId, movie_id, req.user.id, note || null).lastInsertRowid
      )
      const insOpt = db.prepare('INSERT INTO proposal_options (proposal_id, screening_id, snapshot_json) VALUES (?, ?, ?)')
      const insVote = db.prepare("INSERT INTO votes (option_id, user_id, value) VALUES (?, ?, 'yes')")
      for (const s of shows) {
        const snapshot = {
          cinema_key: s.cinema_key, cinema_name: s.cinema_name, street: s.street, zip: s.zip, lat: s.lat, lng: s.lng,
          starts_at: s.starts_at, version: s.version, auditorium: s.auditorium, ticket_url: s.ticket_url,
          title: s.title, year: s.year, runtime: s.runtime,
        }
        insVote.run(Number(insOpt.run(pid, s.id, JSON.stringify(snapshot)).lastInsertRowid), req.user.id)
      }
      return pid
    })()
    res.status(201).json(loadProposals(db, req.user.householdId, id)[0])
  })

  router.put('/proposals/:id/votes/:optionId', (req, res) => {
    const p = own(req, res)
    if (!p) return
    const parsed = voteSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    if (p.status === 'cancelled') return res.status(409).json({ error: 'cancelled' })
    const opt = db.prepare('SELECT id FROM proposal_options WHERE id = ? AND proposal_id = ?').get(Number(req.params.optionId), p.id)
    if (!opt) return res.status(404).json({ error: 'not found' })
    db.prepare(
      `INSERT INTO votes (option_id, user_id, value) VALUES (?, ?, ?)
       ON CONFLICT (option_id, user_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(opt.id, req.user.id, parsed.data.value)
    res.status(204).end()
  })

  router.post('/proposals/:id/book', (req, res) => {
    const p = own(req, res)
    if (!p) return
    const parsed = bookSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    if (p.status === 'cancelled') return res.status(409).json({ error: 'cancelled' })
    const opt = db.prepare('SELECT snapshot_json FROM proposal_options WHERE id = ? AND proposal_id = ?').get(parsed.data.option_id, p.id)
    if (!opt) return res.status(404).json({ error: 'not found' })
    if (!(Date.parse(JSON.parse(opt.snapshot_json).starts_at) > Date.now())) return res.status(409).json({ error: 'expired' })
    db.prepare(
      `UPDATE proposals SET status = 'booked', booked_option_id = ?, booked_by = ?, booked_at = datetime('now'), updated_at = datetime('now'),
       ticket_link = COALESCE(?, ticket_link) WHERE id = ?`
    ).run(parsed.data.option_id, req.user.id, parsed.data.ticket_link ?? null, p.id)
    res.json(loadProposals(db, req.user.householdId, p.id)[0])
  })

  // Link zu den gekauften Tickets (aus der Bestätigungs-Mail); landet im Kalendereintrag.
  router.put('/proposals/:id/ticket', (req, res) => {
    const p = own(req, res)
    if (!p) return
    const parsed = ticketSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    if (p.status !== 'booked') return res.status(409).json({ error: 'not booked' })
    db.prepare("UPDATE proposals SET ticket_link = ?, updated_at = datetime('now') WHERE id = ?").run(parsed.data.ticket_link, p.id)
    res.json(loadProposals(db, req.user.householdId, p.id)[0])
  })

  router.post('/proposals/:id/cancel', (req, res) => {
    const p = own(req, res)
    if (!p) return
    db.prepare(`UPDATE proposals SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(p.id)
    res.status(204).end()
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
