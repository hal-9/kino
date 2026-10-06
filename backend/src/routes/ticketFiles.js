import crypto from 'node:crypto'
import fs from 'node:fs'
import express, { Router } from 'express'
import { requireAuth } from '../auth.js'
import { extOf, extractTicket, filePath, inspectFile, limits, removeFile, storeFile } from '../uploads.js'

const MAX_FILES = 10
const DECLARED = ['application/pdf', 'image/png', 'image/jpeg']

// K32: Ticket-Dateien einer gebuchten Vorstellung. Lesen: Haushalt; Löschen: wer hochgeladen hat.
export function ticketFilesRouter(db) {
  const router = Router()
  router.use(['/ticket-files', '/proposals/:id([0-9]+)/ticket-files'], requireAuth(db))

  const proposal = (req) => db.prepare('SELECT id, status FROM proposals WHERE id = ? AND household_id = ?').get(Number(req.params.id), req.user.householdId)
  const shape = (f) => ({ id: f.id, mime: f.mime, size: f.size, pages: f.pages, width: f.width, height: f.height, uploaded_by: f.uploaded_by, created_at: f.created_at })
  // Datei samt Haushaltsprüfung über die Buchung; fremd oder unbekannt → 404 (keine Existenz-Auskunft).
  const fileOf = (req) => db
    .prepare('SELECT f.* FROM ticket_files f JOIN proposals p ON p.id = f.proposal_id WHERE f.id = ? AND p.household_id = ?')
    .get(Number(req.params.fid), req.user.householdId)

  router.get('/proposals/:id([0-9]+)/ticket-files', (req, res) => {
    if (!proposal(req)) return res.status(404).json({ error: 'not found' })
    res.json({ files: db.prepare('SELECT * FROM ticket_files WHERE proposal_id = ? ORDER BY id').all(Number(req.params.id)).map(shape) })
  })

  // Roher Body (Content-Type = Dateityp). Erst Größe (413), dann Inhalt (415/422), dann speichern.
  router.post('/proposals/:id([0-9]+)/ticket-files', (req, res, next) => express.raw({ type: () => true, limit: limits().bytes })(req, res, next), (req, res) => {
    const p = proposal(req)
    if (!p) return res.status(404).json({ error: 'not found' })
    if (p.status !== 'booked') return res.status(409).json({ error: 'not booked' })
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!buf.length) return res.status(422).json({ error: 'empty file' })
    const declared = String(req.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
    if (!DECLARED.includes(declared)) return res.status(415).json({ error: 'unsupported type' })
    const info = inspectFile(buf)
    if (info.error) return res.status(info.error === 'unsupported type' ? 415 : 422).json({ error: info.error })
    if (info.mime !== declared) return res.status(415).json({ error: 'type mismatch' })
    const sha = crypto.createHash('sha256').update(buf).digest('hex')
    const extraction = extractTicket(buf, info.mime)
    // Wiederholung derselben Datei → vorhandener Eintrag (kein Duplikat, keine zweite Datei).
    const dup = db.prepare('SELECT * FROM ticket_files WHERE proposal_id = ? AND sha256 = ?').get(p.id, sha)
    if (dup) return res.json({ file: shape(dup), extraction })
    if (db.prepare('SELECT COUNT(*) n FROM ticket_files WHERE proposal_id = ?').get(p.id).n >= MAX_FILES) return res.status(422).json({ error: 'too many files' })
    const key = storeFile(buf)
    let id
    try {
      id = Number(db.prepare(`INSERT INTO ticket_files (storage_key, proposal_id, uploaded_by, mime, size, sha256, pages, width, height)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key, p.id, req.user.id, info.mime, buf.length, sha, info.pages ?? null, info.width ?? null, info.height ?? null).lastInsertRowid)
    } catch (e) {
      removeFile(key) // keine verwaiste Datei
      throw e
    }
    res.status(201).json({ file: shape(db.prepare('SELECT * FROM ticket_files WHERE id = ?').get(id)), extraction })
  })

  router.get('/ticket-files/:fid([0-9]+)', (req, res) => {
    const f = fileOf(req)
    if (!f) return res.status(404).json({ error: 'not found' })
    let data
    try { data = fs.readFileSync(filePath(f.storage_key)) } catch { return res.status(404).json({ error: 'not found' }) }
    res.set({
      'Content-Type': f.mime,
      'Content-Disposition': `attachment; filename="ticket-${f.id}.${extOf(f.mime)}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    })
    res.send(data)
  })

  router.delete('/ticket-files/:fid([0-9]+)', (req, res) => {
    const f = fileOf(req)
    if (!f) return res.status(404).json({ error: 'not found' })
    if (f.uploaded_by !== req.user.id) return res.status(403).json({ error: 'forbidden' })
    db.prepare('DELETE FROM ticket_files WHERE id = ?').run(f.id)
    removeFile(f.storage_key)
    res.status(204).end()
  })

  return router
}
