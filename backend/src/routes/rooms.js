import { Router } from 'express'
import { z } from 'zod'
import { isValidYmd, normRoom } from 'shared'
import { requireAuth } from '../auth.js'

const score = z.number().int().min(1).max(5).nullable().default(null)
const fields = {
  noted_on: z.string().refine(isValidYmd),
  row: z.string().trim().max(30).nullable().default(null),
  seat: z.string().trim().max(30).nullable().default(null),
  comfort: score, sightline: score, sound: score,
  note: z.string().trim().max(500).nullable().default(null),
  shared: z.boolean().default(false),
}
const createSchema = z.object({ cinema_key: z.string().max(100), room: z.string().trim().min(1).max(60), visit_id: z.number().int().nullable().default(null), ...fields }).strict()
const patchSchema = z.object(fields).partial().strict()

// K30: persönliche Saal-Notizen (Text/Liste, keine Sitzplan-Geometrie, keine „bester Platz“-Aussage).
export function roomsRouter(db) {
  const router = Router()
  router.use('/rooms', requireAuth(db))

  const shape = (r, uid) => ({
    id: r.id, mine: r.user_id === uid, user_name: r.user_name, cinema_key: r.cinema_key, room: r.room_label, noted_on: r.noted_on,
    visit_id: r.user_id === uid ? r.visit_id : null, row: r.row, seat: r.seat, comfort: r.comfort, sightline: r.sightline, sound: r.sound,
    note: r.note, shared: Boolean(r.shared), updated_at: r.updated_at,
  })
  // Sichtbar: eigene Notizen + ausdrücklich geteilte aus dem eigenen Haushalt.
  const visible = `(n.user_id = ? OR (n.shared = 1 AND n.household_id = ?))`

  // ?cinema_key=&room= → Notizen genau dieses Saals in diesem Kino; ohne Parameter → alle eigenen.
  router.get('/rooms/notes', (req, res) => {
    const { cinema_key, room } = req.query
    const uid = req.user.id
    if ((cinema_key === undefined) !== (room === undefined)) return res.status(422).json({ error: 'validation failed' })
    const where = cinema_key === undefined ? 'n.user_id = ?' : `${visible} AND n.cinema_key = ? AND n.room_key = ?`
    const args = cinema_key === undefined ? [uid] : [uid, req.user.householdId, String(cinema_key), normRoom(room)]
    const notes = db
      .prepare(`SELECT n.*, u.name AS user_name FROM room_notes n JOIN users u ON u.id = n.user_id WHERE ${where} ORDER BY n.noted_on DESC, n.id DESC`)
      .all(...args)
      .map((r) => shape(r, uid))
    res.json({ notes })
  })

  router.post('/rooms/notes', (req, res) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const d = parsed.data
    if (!normRoom(d.room) || !db.prepare('SELECT 1 FROM cinemas WHERE key = ?').get(d.cinema_key)) return res.status(422).json({ error: 'validation failed' })
    if (d.visit_id !== null && !db.prepare('SELECT 1 FROM visits WHERE id = ? AND user_id = ?').get(d.visit_id, req.user.id)) return res.status(422).json({ error: 'validation failed' })
    const id = Number(db.prepare(
      `INSERT INTO room_notes (user_id, household_id, cinema_key, room_key, room_label, visit_id, noted_on, row, seat, comfort, sightline, sound, note, shared)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, req.user.householdId, d.cinema_key, normRoom(d.room), d.room, d.visit_id, d.noted_on, d.row || null, d.seat || null,
      d.comfort, d.sightline, d.sound, d.note || null, d.shared ? 1 : 0).lastInsertRowid)
    res.status(201).json(shape({ ...db.prepare('SELECT * FROM room_notes WHERE id = ?').get(id), user_name: req.user.name }, req.user.id))
  })

  // Nur der Besitzer; fremde (auch geteilte) Notizen sind für Schreibzugriffe nicht vorhanden.
  const own = (req, res) => {
    const n = db.prepare('SELECT * FROM room_notes WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id)
    if (!n) res.status(404).json({ error: 'not found' })
    return n
  }

  router.patch('/rooms/notes/:id([0-9]+)', (req, res) => {
    const n = own(req, res)
    if (!n) return
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const next = { ...n, ...parsed.data }
    db.prepare(`UPDATE room_notes SET noted_on = ?, row = ?, seat = ?, comfort = ?, sightline = ?, sound = ?, note = ?, shared = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(next.noted_on, next.row || null, next.seat || null, next.comfort, next.sightline, next.sound, next.note || null, next.shared ? 1 : 0, n.id)
    res.json(shape({ ...db.prepare('SELECT * FROM room_notes WHERE id = ?').get(n.id), user_name: req.user.name }, req.user.id))
  })

  router.delete('/rooms/notes/:id([0-9]+)', (req, res) => {
    const n = own(req, res)
    if (!n) return
    db.prepare('DELETE FROM room_notes WHERE id = ?').run(n.id)
    res.status(204).end()
  })

  return router
}
