import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'

const schema = z.object({
  line: z.string().trim().min(1).max(140), spoiler: z.boolean().default(false),
  visibility: z.enum(['private', 'reveal', 'household']).default('private'),
}).strict()

// K35: Reaktionen. Sichtbarkeit wird nur hier serverseitig entschieden; nicht freigegebene Werte verlassen den Server nie.
export function reactionsRouter(db) {
  const router = Router()
  router.use('/visits/:id([0-9]+)/reaction', requireAuth(db))
  router.use('/visits/:id([0-9]+)/reactions', requireAuth(db))

  const visitOf = (req) => db.prepare('SELECT * FROM visits WHERE id = ? AND household_id = ?').get(Number(req.params.id), req.user.householdId)
  const ownVisit = (req, res) => {
    const v = visitOf(req)
    if (!v) res.status(404).json({ error: 'not found' })
    else if (v.user_id !== req.user.id) res.status(403).json({ error: 'forbidden' })
    else return v
  }

  router.put('/visits/:id([0-9]+)/reaction', (req, res) => {
    const v = ownVisit(req, res)
    if (!v) return
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(422).json({ error: 'validation failed' })
    const d = parsed.data
    db.prepare(`INSERT INTO visit_reactions (visit_id, user_id, line, spoiler, visibility) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (visit_id) DO UPDATE SET line = excluded.line, spoiler = excluded.spoiler, visibility = excluded.visibility, updated_at = datetime('now')`)
      .run(v.id, req.user.id, d.line, d.spoiler ? 1 : 0, d.visibility)
    res.json({ visit_id: v.id, ...d })
  })

  router.delete('/visits/:id([0-9]+)/reaction', (req, res) => {
    const v = ownVisit(req, res)
    if (!v) return
    db.prepare('DELETE FROM visit_reactions WHERE visit_id = ?').run(v.id)
    res.status(204).end()
  })

  // Reaktionen zum selben Kinoabend (gleiche Buchung) bzw. nur zu diesem Besuch.
  router.get('/visits/:id([0-9]+)/reactions', (req, res) => {
    const v = visitOf(req)
    if (!v) return res.status(404).json({ error: 'not found' })
    const rows = db
      .prepare(
        `SELECT r.*, u.name AS user_name FROM visit_reactions r JOIN visits x ON x.id = r.visit_id JOIN users u ON u.id = r.user_id
         WHERE x.household_id = ? AND ${v.proposal_id ? 'x.proposal_id = ?' : 'x.id = ?'} ORDER BY r.updated_at, r.visit_id`
      )
      .all(req.user.householdId, v.proposal_id ?? v.id)
    // Aufdecken: wer selbst eine nicht-private Reaktion zu diesem Abend hat, sieht die „reveal“-Reaktionen der anderen.
    const revealed = rows.some((r) => r.user_id === req.user.id && r.visibility !== 'private')
    const visible = (r) => r.user_id === req.user.id || r.visibility === 'household' || (r.visibility === 'reveal' && revealed)
    res.json({
      reactions: rows.filter(visible).map((r) => ({ visit_id: r.visit_id, mine: r.user_id === req.user.id, user_name: r.user_name, line: r.line, spoiler: Boolean(r.spoiler), visibility: r.visibility })),
      waiting: rows.filter((r) => r.visibility === 'reveal' && !visible(r)).length, // nur Anzahl, kein Inhalt
    })
  })

  return router
}
