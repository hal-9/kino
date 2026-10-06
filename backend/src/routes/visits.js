import { Router } from 'express'
import { z } from 'zod'
import { isValidYmd, normTitle } from 'shared'
import { requireAuth } from '../auth.js'
import { idempotent } from '../idempotency.js'
import { materializeVisits } from '../autoVisits.js'

const ymd = z.string().refine(isValidYmd)
const fields = {
  watched_on: ymd,
  auditorium: z.string().trim().max(60).nullish(),
  row: z.string().trim().max(30).nullish(),
  seats: z.string().trim().max(60).nullish(),
  companions: z.array(z.number().int()).max(10).default([]),
  note: z.string().trim().max(500).nullish(),
}
const createSchema = z.object({
  ...fields,
  proposal_id: z.number().int().optional(),
  screening_id: z.number().int().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  year: z.number().int().min(1888).max(2100).nullish(),
  cinema_key: z.string().max(100).optional(),
})
const patchSchema = z.object(fields).partial()

export function visitsRouter(db) {
  const router = Router()
  router.use('/visits', requireAuth(db))
  router.patch('/me', requireAuth(db), (req, res) => {
    const parsed = z.object({ letterboxd_user: z.string().trim().regex(/^[A-Za-z0-9_-]{0,40}$/) }).safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const value = parsed.data.letterboxd_user || null
    db.prepare('UPDATE users SET letterboxd_user = ? WHERE id = ?').run(value, req.user.id)
    res.json({ letterboxd_user: value })
  })
  router.get('/settings', requireAuth(db), (req, res) => {
    res.json(db.prepare('SELECT letterboxd_user FROM users WHERE id = ?').get(req.user.id))
  })

  const members = (hid) =>
    db.prepare('SELECT u.id, u.name FROM household_members m JOIN users u ON u.id = m.user_id WHERE m.household_id = ? ORDER BY m.joined_at, u.id').all(hid)

  const shape = (r) => ({
    id: r.id, user_id: r.user_id, user_name: r.user_name, proposal_id: r.proposal_id, movie_id: r.movie_id, tmdb_id: r.tmdb_id,
    snapshot: JSON.parse(r.snapshot_json), watched_on: r.watched_on, auditorium: r.auditorium, row: r.row, seats: r.seats,
    companions: JSON.parse(r.companions_json), letterboxd_rating: r.letterboxd_rating, note: r.note,
  })
  const load = (where, ...args) =>
    db
      .prepare(
        `SELECT v.*, u.name AS user_name, m.tmdb_id FROM visits v JOIN users u ON u.id = v.user_id LEFT JOIN movies m ON m.id = v.movie_id
         WHERE ${where} ORDER BY v.watched_on DESC, v.id DESC`
      )
      .all(...args)
      .map(shape)

  const validCompanions = (ids, hid) => {
    const ok = new Set(members(hid).map((m) => m.id))
    return [...new Set(ids)].filter((i) => ok.has(i))
  }

  router.get('/visits', (req, res) => {
    materializeVisits(db, req.user.householdId)
    const year = String(req.query.year ?? '')
    if (year && !/^\d{4}$/.test(year)) return res.status(422).json({ error: 'validation failed' })
    const visits = year
      ? load("v.household_id = ? AND substr(v.watched_on, 1, 4) = ?", req.user.householdId, year)
      : load('v.household_id = ?', req.user.householdId)
    res.json({ members: members(req.user.householdId), visits })
  })

  router.get('/visits/pending', (req, res) => {
    materializeVisits(db, req.user.householdId)
    const rows = db
      .prepare(
        `SELECT p.id AS proposal_id, o.snapshot_json FROM proposals p JOIN proposal_options o ON o.id = p.booked_option_id
         WHERE p.household_id = ? AND p.status = 'booked' AND datetime(json_extract(o.snapshot_json, '$.starts_at')) < datetime(?)
           AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.proposal_id = p.id AND v.user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM auto_visits a WHERE a.proposal_id = p.id AND a.user_id = ?)
         ORDER BY json_extract(o.snapshot_json, '$.starts_at') DESC`
      )
      .all(req.user.householdId, new Date().toISOString(), req.user.id, req.user.id)
    res.json({ pending: rows.map((r) => ({ proposal_id: r.proposal_id, snapshot: JSON.parse(r.snapshot_json) })) })
  })

  router.post('/visits', idempotent(db, 'visit.create'), (req, res) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed', details: parsed.error.issues })
    const d = parsed.data
    const hid = req.user.householdId
    let snapshot, movieId = null, proposalId = null

    if (d.proposal_id) {
      const row = db
        .prepare(
          `SELECT p.id, p.movie_id, o.snapshot_json FROM proposals p JOIN proposal_options o ON o.id = p.booked_option_id
           WHERE p.id = ? AND p.household_id = ? AND p.status = 'booked'`
        )
        .get(d.proposal_id, hid)
      if (!row) return res.status(422).json({ error: 'validation failed' })
      snapshot = JSON.parse(row.snapshot_json)
      movieId = row.movie_id
      proposalId = row.id
    } else if (d.screening_id) {
      const s = db
        .prepare(
          `SELECT s.*, c.name AS cinema_name, c.street, c.zip, c.lat, c.lng, m.title, m.year, m.runtime
           FROM screenings s JOIN cinemas c ON c.key = s.cinema_key JOIN movies m ON m.id = s.movie_id WHERE s.id = ?`
        )
        .get(d.screening_id)
      if (!s) return res.status(422).json({ error: 'validation failed' })
      snapshot = {
        cinema_key: s.cinema_key, cinema_name: s.cinema_name, street: s.street, zip: s.zip, lat: s.lat, lng: s.lng,
        starts_at: s.starts_at, version: s.version, auditorium: s.auditorium, ticket_url: s.ticket_url,
        title: s.title, year: s.year, runtime: s.runtime,
      }
      movieId = s.movie_id
    } else {
      // Freitext: Film + Kino.
      const c = db.prepare('SELECT * FROM cinemas WHERE key = ?').get(d.cinema_key ?? '')
      if (!d.title || !c) return res.status(422).json({ error: 'validation failed' })
      const norm = normTitle(d.title)
      movieId =
        db.prepare('SELECT id FROM movies WHERE norm_title = ? AND (year IS ? OR year IS NULL) ORDER BY year IS NULL LIMIT 1').get(norm, d.year ?? null)?.id ??
        Number(db.prepare('INSERT INTO movies (title, norm_title, year) VALUES (?, ?, ?)').run(d.title, norm, d.year ?? null).lastInsertRowid)
      const m = db.prepare('SELECT title, year, runtime FROM movies WHERE id = ?').get(movieId)
      snapshot = {
        cinema_key: c.key, cinema_name: c.name, street: c.street, zip: c.zip, lat: c.lat, lng: c.lng, starts_at: null,
        version: null, auditorium: null, ticket_url: null, title: m.title, year: m.year, runtime: m.runtime,
      }
    }

    const id = Number(
      db
        .prepare(
          `INSERT INTO visits (user_id, household_id, proposal_id, movie_id, snapshot_json, watched_on, auditorium, row, seats, companions_json, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.user.id, hid, proposalId, movieId, JSON.stringify(snapshot), d.watched_on, d.auditorium || snapshot.auditorium || null,
          d.row || null, d.seats || null, JSON.stringify(validCompanions(d.companions, hid)), d.note || null
        ).lastInsertRowid
    )
    res.status(201).json(load('v.id = ?', id)[0])
  })

  const ownVisit = (req, res) => {
    const v = db.prepare('SELECT * FROM visits WHERE id = ? AND household_id = ?').get(Number(req.params.id), req.user.householdId)
    if (!v) res.status(404).json({ error: 'not found' })
    else if (v.user_id !== req.user.id) res.status(403).json({ error: 'forbidden' })
    else return v
  }

  router.patch('/visits/:id', (req, res) => {
    const v = ownVisit(req, res)
    if (!v) return
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const d = parsed.data
    const next = {
      watched_on: d.watched_on ?? v.watched_on,
      auditorium: 'auditorium' in d ? d.auditorium || null : v.auditorium,
      row: 'row' in d ? d.row || null : v.row,
      seats: 'seats' in d ? d.seats || null : v.seats,
      note: 'note' in d ? d.note || null : v.note,
      companions: d.companions ? JSON.stringify(validCompanions(d.companions, v.household_id)) : v.companions_json,
    }
    db.prepare('UPDATE visits SET watched_on = ?, auditorium = ?, row = ?, seats = ?, note = ?, companions_json = ? WHERE id = ?')
      .run(next.watched_on, next.auditorium, next.row, next.seats, next.note, next.companions, v.id)
    res.json(load('v.id = ?', v.id)[0])
  })

  router.delete('/visits/:id', (req, res) => {
    const v = ownVisit(req, res)
    if (!v) return
    db.prepare('DELETE FROM visits WHERE id = ?').run(v.id)
    res.status(204).end()
  })

  return router
}
