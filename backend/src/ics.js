const pad = (n) => String(n).padStart(2, '0')
const utc = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

// Zeilen > 75 Oktette falten (Umbruch + Leerzeichen), ohne UTF-8-Zeichen zu zerteilen.
export function fold(line) {
  const out = []
  let cur = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const b = Buffer.byteLength(ch)
    if (bytes + b > limit) {
      out.push(cur)
      cur = ' '
      bytes = 1
      limit = 75
    }
    cur += ch
    bytes += b
  }
  out.push(cur)
  return out.join('\r\n')
}

export function icsEvent({ uid, seq, start, end, summary, location, geo, description, url }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utc(new Date())}`,
    `SEQUENCE:${seq}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${esc(summary)}`,
    `LOCATION:${esc(location)}`,
  ]
  if (geo) lines.push(`GEO:${geo}`)
  lines.push(`DESCRIPTION:${esc(description)}`, `URL:${url}`,
    'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY', 'DESCRIPTION:Kino in einer Stunde', 'END:VALARM', 'END:VEVENT')
  return lines.map(fold).join('\r\n')
}

export function icsCalendar(events, { name = 'LiLief-Kino' } = {}) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LiLief//Kino//DE', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${name}`,
    ...events, 'END:VCALENDAR',
  ].join('\r\n') + '\r\n'
}

export const publicUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`

// Gebuchter Vorschlag → VEVENT (Daten aus dem eingefrorenen Snapshot).
export function eventForProposal(db, proposalId, base) {
  const p = db.prepare('SELECT * FROM proposals WHERE id = ? AND status = ? AND booked_option_id IS NOT NULL').get(proposalId, 'booked')
  if (!p) return null
  const opt = db.prepare('SELECT * FROM proposal_options WHERE id = ?').get(p.booked_option_id)
  const s = JSON.parse(opt.snapshot_json)
  const who = db
    .prepare(`SELECT u.name FROM votes v JOIN users u ON u.id = v.user_id WHERE v.option_id = ? AND v.value = 'yes' ORDER BY u.name`)
    .all(opt.id).map((r) => r.name)
  const start = new Date(s.starts_at)
  const link = `${base}/vorschlaege/${p.id}`
  const place = [s.cinema_name, s.street, [s.zip, 'Berlin'].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return icsEvent({
    uid: `proposal-${p.id}@kino.tunikb.com`,
    seq: Math.floor(new Date(p.updated_at.replace(' ', 'T') + 'Z').getTime() / 1000),
    start,
    end: new Date(start.getTime() + ((s.runtime ?? 120) + 20) * 60_000),
    summary: `🎬 ${s.title}${s.version ? ` (${s.version})` : ''} · ${s.cinema_name}`,
    location: place,
    geo: s.lat != null && s.lng != null ? `${s.lat};${s.lng}` : null,
    description: [s.auditorium, who.length && `dabei: ${who.join(', ')}`, s.ticket_url && `Tickets: ${s.ticket_url}`, `Vorschlag: ${link}`].filter(Boolean).join(' · '),
    url: link,
  })
}
