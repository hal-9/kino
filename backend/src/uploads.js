import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { parseTicketText } from 'shared'

// K32: private Ticket-Dateien. Grenzen per Umgebung einstellbar, sonst konservative Standards.
export const limits = () => ({
  bytes: Number(process.env.UPLOAD_MAX_BYTES) || 10 * 1024 * 1024,
  pages: Number(process.env.UPLOAD_MAX_PAGES) || 20,
  pixels: Number(process.env.UPLOAD_MAX_PIXELS) || 40_000_000,
})
// Neben der Datenbank (Prod: /data/uploads im Volume), nie unter dem ausgelieferten Frontend.
export const uploadDir = () => process.env.UPLOAD_DIR || path.join(path.dirname(process.env.DATABASE_PATH || './data/app.db'), 'uploads')

const EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }

// Echten Typ am Inhalt erkennen (nie am Namen/Header allein) und Größen prüfen.
// → { mime, pages?, width?, height? } oder { error } (Code für die API).
export function inspectFile(buf, { pages: maxPages, pixels: maxPixels } = limits()) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    if (!buf.subarray(-1024).toString('latin1').includes('%%EOF')) return { error: 'truncated' }
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length
    if (pages > maxPages) return { error: 'too many pages' }
    return { mime: 'application/pdf', pages }
  }
  if (buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.subarray(12, 16).toString('latin1') === 'IHDR') {
    return dims('image/png', buf.readUInt32BE(16), buf.readUInt32BE(20), maxPixels)
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    // Marker bis zum ersten SOF (Start of Frame) durchgehen; begrenzt durch die Dateigröße.
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) return { error: 'invalid image' }
      const m = buf[i + 1]
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return dims('image/jpeg', buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5), maxPixels)
      i += 2 + buf.readUInt16BE(i + 2)
    }
    return { error: 'invalid image' }
  }
  return { error: 'unsupported type' }
}
function dims(mime, width, height, maxPixels) {
  if (!width || !height || width * height > maxPixels) return { error: 'too many pixels' }
  return { mime, width, height }
}

// PDF-Literalstring ohne die umgebenden Klammern → Text (Escapes: \n \r \t \b \f \( \) \\ und \ddd oktal; \ + Zeilenende = Fortsetzung).
export function pdfUnescape(s) {
  return s.replace(/\\(\r\n|\n|\r|[0-7]{1,3}|.)/gs, (_, e) => {
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8) & 0xff)
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\r\n': '', '\n': '', '\r': '' }[e] ?? e
  })
}

// Einfache, begrenzte Text-Extraktion (nur lokal): Inhaltsströme (ggf. Flate) → Strings aus Tj/TJ.
// Eigene Schrift-Kodierungen/Scans liefern nichts → manuelle Eingabe. Kein OCR, kein externer Dienst.
export function extractPdfText(buf) {
  const src = buf.toString('latin1')
  const out = []
  let total = 0
  const re = /<<([^]*?)>>\s*stream\r?\n/g
  for (let m, n = 0; (m = re.exec(src)) && n < 200 && total < 100_000; n++) {
    const start = m.index + m[0].length
    const end = src.indexOf('endstream', start)
    if (end < 0) break
    let data = buf.subarray(start, end)
    if (/\/FlateDecode/.test(m[1])) {
      try { data = zlib.inflateSync(data, { maxOutputLength: 2 * 1024 * 1024 }) } catch { continue }
    } else if (/\/Filter/.test(m[1])) continue
    const text = data.toString('latin1')
    for (const t of text.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/gs)) {
      const part = t[1] !== undefined ? pdfUnescape(t[1]) : [...t[2].matchAll(/\(((?:\\.|[^\\)])*)\)/gs)].map((x) => pdfUnescape(x[1])).join('')
      out.push(part)
      total += part.length
    }
    re.lastIndex = end
  }
  return out.join('\n').slice(0, 100_000)
}

// Nur strukturierte Kandidaten zurückgeben, nie den extrahierten Rohtext (wird nicht gespeichert).
export function extractTicket(buf, mime) {
  if (mime !== 'application/pdf') return { status: 'not_supported' }
  let text
  try { text = extractPdfText(buf) } catch { return { status: 'failed' } }
  const r = parseTicketText(text)
  const fields = { date: r.date?.value ?? null, time: r.time?.value ?? null, auditorium: r.auditorium?.value ?? null, seats: r.seats.map(({ row, seat }) => ({ row, seat })) }
  return { status: fields.date || fields.time || fields.auditorium || fields.seats.length ? 'ok' : 'none', fields }
}

export function storeFile(buf) {
  const dir = uploadDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const key = crypto.randomBytes(16).toString('hex')
  const tmp = path.join(dir, `${key}.tmp`)
  fs.writeFileSync(tmp, buf, { mode: 0o600 })
  fs.renameSync(tmp, path.join(dir, key))
  return key
}
export const filePath = (key) => path.join(uploadDir(), key) // key: nur 32 Hex-Zeichen aus der DB
export const extOf = (mime) => EXT[mime]
export function removeFile(key) {
  try { fs.unlinkSync(filePath(key)) } catch (e) { if (e.code !== 'ENOENT') throw e }
}

// Start-Aufräumen: Dateien ohne Zeile (abgebrochene Uploads, .tmp) löschen; Zeilen ohne Datei nur zählen (nichts raten).
export function cleanupUploads(db) {
  const dir = uploadDir()
  if (!fs.existsSync(dir)) return { removed: 0, missing: 0 }
  const keys = new Set(db.prepare('SELECT storage_key FROM ticket_files').all().map((r) => r.storage_key))
  let removed = 0
  for (const f of fs.readdirSync(dir)) {
    if (!keys.has(f)) { fs.rmSync(path.join(dir, f), { force: true }); removed++ }
  }
  const missing = [...keys].filter((k) => !fs.existsSync(path.join(dir, k))).length
  return { removed, missing }
}
