import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { setupTestApp, loginCookie } from './helpers.js'
import { runMigrations } from '../src/migrate.js'
import { cleanupUploads, extractPdfText, inspectFile, pdfUnescape, uploadDir } from '../src/uploads.js'

// Synthetische Testdateien (keine echten Tickets).
export function pdf(content, { pages = 1, flate = true } = {}) {
  const body = flate ? zlib.deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1')
  const kids = Array.from({ length: pages }, (_, i) => `${10 + i} 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n`).join('')
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count ${pages} >> endobj\n${kids}4 0 obj << /Length ${body.length}${flate ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'),
    body, Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ])
}
const png = (w, h) => {
  const b = Buffer.alloc(40)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b)
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
  return b
}
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0])
const TICKET = 'BT (Digger) Tj (07.10.2099 19:50 Uhr) Tj [(Saal ) -20 (4)] TJ (Reihe 9 Platz 11 Platz 12) Tj (Back\\\\slash \\(x\\)) Tj ET'

describe('K32 Datei-Prüfung und Text', () => {
  it('erkennt Typ am Inhalt; Grenzen für Seiten/Pixel; Backslash-Escapes', () => {
    expect(inspectFile(pdf('x'))).toEqual({ mime: 'application/pdf', pages: 1 })
    expect(inspectFile(pdf('x', { pages: 21 }))).toEqual({ error: 'too many pages' })
    expect(inspectFile(pdf('x').subarray(0, 40))).toEqual({ error: 'truncated' })
    expect(inspectFile(png(800, 600))).toEqual({ mime: 'image/png', width: 800, height: 600 })
    expect(inspectFile(png(20000, 20000))).toEqual({ error: 'too many pixels' })
    expect(inspectFile(jpeg(640, 480))).toEqual({ mime: 'image/jpeg', width: 640, height: 480 })
    expect(inspectFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({ error: 'unsupported type' })
    expect(inspectFile(Buffer.from('PK\u0003\u0004zip'))).toEqual({ error: 'unsupported type' })
    expect(pdfUnescape('a\\\\b \\(c\\) \\101\\n')).toBe('a\\b (c) A\n')
    expect(pdfUnescape('zeile\\\nweiter')).toBe('zeileweiter')
    expect(extractPdfText(pdf(TICKET))).toBe('Digger\n07.10.2099 19:50 Uhr\nSaal 4\nReihe 9 Platz 11 Platz 12\nBack\\slash (x)')
  })
})

describe('K32 Ticket-Dateien', () => {
  let app, db, users, c1, c2, eve, p
  beforeEach(async () => {
    ;({ app, db, users } = setupTestApp())
    c1 = await loginCookie(app, users[0])
    c2 = await loginCookie(app, users[1])
    db.prepare("INSERT INTO households (id, name) VALUES (2, 'Andere')").run()
    const eveId = Number(db.prepare("INSERT INTO users (name, email, password_digest) VALUES ('eve', 'eve@example.com', ?)").run(bcrypt.hashSync('password9', 4)).lastInsertRowid)
    db.prepare('INSERT INTO household_members (household_id, user_id) VALUES (2, ?)').run(eveId)
    eve = await loginCookie(app, { email: 'eve@example.com', password: 'password9' })
    db.prepare("INSERT INTO cinemas (key, name) VALUES ('zoo-palast', 'Zoo Palast')").run()
    const mid = Number(db.prepare("INSERT INTO movies (title, norm_title, year) VALUES ('Digger', 'digger', 2026)").run().lastInsertRowid)
    const sid = Number(db.prepare("INSERT INTO screenings (cinema_key, movie_id, starts_at, source) VALUES ('zoo-palast', ?, '2099-10-07T19:50:00+02:00', 'zoopalast')").run(mid).lastInsertRowid)
    p = (await request(app).post('/api/proposals').set('Cookie', c1).send({ movie_id: mid, screening_ids: [sid] })).body
  })
  afterEach(() => { delete process.env.UPLOAD_MAX_BYTES })
  const book = () => request(app).post(`/api/proposals/${p.id}/book`).set('Cookie', c1).send({ option_id: p.options[0].id }).expect(200)
  const up = (buf, type = 'application/pdf', cookie = c1, pid = p.id) => request(app).post(`/api/proposals/${pid}/ticket-files`).set('Cookie', cookie).set('Content-Type', type).send(buf)
  const files = () => (fs.existsSync(uploadDir()) ? fs.readdirSync(uploadDir()) : [])

  it('AC01: zu groß, Typ-Fehler, HTML/SVG/Archiv, Pfadtricks werden sicher abgelehnt; nichts gespeichert', async () => {
    expect((await up(pdf(TICKET))).status).toBe(409) // noch nicht gebucht
    await book()
    process.env.UPLOAD_MAX_BYTES = '200'
    expect((await up(pdf('x'.repeat(500), { flate: false }))).status).toBe(413)
    delete process.env.UPLOAD_MAX_BYTES
    expect((await up(png(10, 10), 'application/pdf')).body).toEqual({ error: 'type mismatch' })
    expect((await up(pdf('x'), 'image/png')).status).toBe(415)
    expect((await up(Buffer.from('<html><script>alert(1)</script></html>'), 'text/html')).status).toBe(415)
    expect((await up(Buffer.from('<html></html>'), 'application/pdf')).status).toBe(415)
    expect((await up(Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(415)
    expect((await up(Buffer.from('PK\u0003\u0004'), 'application/zip')).status).toBe(415)
    expect((await up(png(30000, 30000), 'image/png')).status).toBe(422)
    expect((await up(Buffer.alloc(0))).status).toBe(422)
    expect(files()).toEqual([])
    for (const u of ['/api/ticket-files/..%2F..%2Fetc%2Fpasswd', '/api/ticket-files/1%2F..', '/api/ticket-files/..\\..\\app.db']) {
      expect((await request(app).get(u).set('Cookie', c1)).status).toBe(404)
    }
  })

  it('AC02/AC05: anderer Haushalt bekommt nichts; Lesen nur angemeldet, als Anhang mit nosniff/CSP; Löschen nur Hochladende', async () => {
    await book()
    const { body } = await up(pdf(TICKET)).expect(201)
    const id = body.file.id
    expect((await request(app).get(`/api/ticket-files/${id}`)).status).toBe(401)
    expect((await request(app).get(`/api/ticket-files/${id}`).set('Cookie', eve)).status).toBe(404)
    expect((await request(app).get(`/api/proposals/${p.id}/ticket-files`).set('Cookie', eve)).status).toBe(404)
    expect((await up(pdf('y'), 'application/pdf', eve)).status).toBe(404)
    const r = await request(app).get(`/api/ticket-files/${id}`).set('Cookie', c2).buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))) }).expect(200)
    expect(r.headers['content-type']).toBe('application/pdf')
    expect(r.headers['content-disposition']).toBe(`attachment; filename="ticket-${id}.pdf"`)
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['content-security-policy']).toContain('sandbox')
    expect(r.body.equals(pdf(TICKET))).toBe(true)
    expect((await request(app).delete(`/api/ticket-files/${id}`).set('Cookie', eve)).status).toBe(404)
    expect((await request(app).delete(`/api/ticket-files/${id}`).set('Cookie', c2)).status).toBe(403)
    // Speicherort: zufälliger Hex-Schlüssel, außerhalb des Frontends; nicht im Kalender.
    expect(files()).toEqual([db.prepare('SELECT storage_key FROM ticket_files').get().storage_key])
    expect(files()[0]).toMatch(/^[0-9a-f]{32}$/)
    expect(path.resolve(uploadDir()).startsWith(path.resolve(path.join(__dirname, '..', '..', 'frontend')))).toBe(false)
    const ics = (await request(app).get(`/api/proposals/${p.id}.ics`).set('Cookie', c1)).text
    expect(ics).not.toMatch(/ticket-files/)
  })

  it('AC03: Text-PDF liefert Kandidaten (kein Rohtext); ohne Text/Bild → manuelle Eingabe', async () => {
    await book()
    const ok = (await up(pdf(TICKET)).expect(201)).body.extraction
    expect(ok).toEqual({ status: 'ok', fields: { date: '2099-10-07', time: '19:50', auditorium: '4', seats: [{ row: '9', seat: '11' }, { row: '9', seat: '12' }] } })
    expect((await up(pdf('BT ET')).expect(201)).body.extraction.status).toBe('none')
    const broken = Buffer.concat([pdf('x', { flate: false }).subarray(0, 60), Buffer.from(' /Filter /FlateDecode >>\nstream\nnot-zlib\nendstream\n%%EOF')])
    expect((await up(broken)).body.extraction?.status ?? 'rejected').toMatch(/none|rejected/)
    expect((await up(png(100, 100), 'image/png').expect(201)).body.extraction).toEqual({ status: 'not_supported' })
    expect(JSON.stringify(db.prepare('SELECT * FROM ticket_files').all())).not.toMatch(/Reihe|19:50/)
  })

  it('AC04: Wiederholung ohne Duplikat; Löschen entfernt Datei; Aufräumen verwaister Dateien', async () => {
    await book()
    const a = (await up(pdf(TICKET)).expect(201)).body.file
    const b = (await up(pdf(TICKET)).expect(200)).body.file
    expect(b.id).toBe(a.id)
    expect(files()).toHaveLength(1)
    fs.writeFileSync(path.join(uploadDir(), 'deadbeef.tmp'), 'x')
    fs.writeFileSync(path.join(uploadDir(), 'ffffffffffffffffffffffffffffffff'), 'x')
    const second = (await up(png(10, 10), 'image/png').expect(201)).body.file
    fs.unlinkSync(path.join(uploadDir(), db.prepare('SELECT storage_key FROM ticket_files WHERE id = ?').get(second.id).storage_key))
    expect(cleanupUploads(db)).toEqual({ removed: 2, missing: 1 })
    expect(files()).toHaveLength(1)
    expect((await request(app).get(`/api/ticket-files/${second.id}`).set('Cookie', c1)).status).toBe(404)
    await request(app).delete(`/api/ticket-files/${a.id}`).set('Cookie', c1).expect(204)
    expect(files()).toEqual([])
    expect((await request(app).get(`/api/proposals/${p.id}/ticket-files`).set('Cookie', c1)).body.files.map((f) => f.id)).toEqual([second.id])
  })
})

describe('Migration 023 auf befüllter DB', () => {
  it('additiv; nur PDF/PNG/JPEG erlaubt', () => {
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kino-mig-')), 'up.db'))
    db.pragma('foreign_keys = ON')
    runMigrations(db, { upTo: '022_room_notes.sql' })
    db.prepare("INSERT INTO users (id, name, email, password_digest) VALUES (1, 'a', 'a@example.com', 'x')").run()
    db.prepare("INSERT INTO movies (id, title, norm_title) VALUES (7, 'Digger', 'digger')").run()
    db.prepare("INSERT INTO proposals (id, household_id, movie_id, created_by, status, ticket_link) VALUES (5, 1, 7, 1, 'booked', 'https://t.example/x')").run()
    runMigrations(db)
    expect(db.prepare('SELECT ticket_link FROM proposals').get().ticket_link).toBe('https://t.example/x')
    expect(() => db.prepare("INSERT INTO ticket_files (storage_key, proposal_id, uploaded_by, mime, size, sha256) VALUES ('k', 5, 1, 'image/svg+xml', 1, 's')").run()).toThrow(/CHECK/)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
