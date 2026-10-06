import { berlinYmd, isValidYmd } from './normalize.js'

// K31: Bestätigungstext (kinoheld u. a.) → Kandidaten mit Fundstelle `at` = [start, end] im Text.
// Läuft nur lokal; der Rohtext wird weder gesendet noch gespeichert. Nicht gefundene Felder stehen in `unresolved`.
export function parseTicketText(text) {
  const t = String(text ?? '')
  const hit = (re) => {
    const m = re.exec(t)
    return m && { m, at: [m.index, m.index + m[0].length] }
  }
  const d = hit(/\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/)
  const ymd = d && `${d.m[3].length === 2 ? `20${d.m[3]}` : d.m[3]}-${d.m[2].padStart(2, '0')}-${d.m[1].padStart(2, '0')}`
  const date = d && isValidYmd(ymd) ? { value: ymd, at: d.at } : null
  const tm = hit(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*Uhr\b/) ?? hit(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  const time = tm && { value: `${tm.m[1].padStart(2, '0')}:${tm.m[2]}`, at: tm.at }
  const a = hit(/Saal\s*([^\n,]+)/)
  const auditorium = a && { value: a.m[1].trim(), at: a.at }
  // Mehrere Plätze behalten ihre Reihe; kein Rückschluss, wer auf welchem Platz sitzt.
  const seats = []
  let row = null
  for (const m of t.matchAll(/Reihe\s*(\w+)|(?:Sitz|Platz)\s*(\d+)/g)) {
    if (m[1]) row = m[1]
    else if (!seats.some((s) => s.row === row && s.seat === m[2])) seats.push({ row, seat: m[2], at: [m.index, m.index + m[0].length] })
  }
  // Nur http(s), nie automatisch abgerufen.
  const links = [...t.matchAll(/https?:\/\/[^\s<>"']+/g)].map((m) => ({ value: m[0], at: [m.index, m.index + m[0].length] }))
  const fields = { date, time, auditorium }
  const unresolved = [...Object.keys(fields).filter((k) => !fields[k]), ...(seats.length ? [] : ['seats'])]
  return { ...fields, seats, links, unresolved }
}

const norm = (s) => String(s ?? '').toLocaleLowerCase('de').replace(/\s+/g, ' ').trim()
const berlinHm = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' })

// Abgleich der geprüften Werte mit der gebuchten Vorstellung: match | conflict | unknown je Feld.
// Film/Kino gelten nur als passend, wenn ihr Name im Text vorkommt; sonst unbekannt (nie still angenommen).
export function checkTicket({ date, time }, snapshot, text = '') {
  const start = new Date(snapshot.starts_at)
  const cmp = (v, want) => (!v ? 'unknown' : v === want ? 'match' : 'conflict')
  const has = (name) => (name && norm(text).includes(norm(name)) ? 'match' : 'unknown')
  return { date: cmp(date, berlinYmd(start)), time: cmp(time, berlinHm(start)), cinema: has(snapshot.cinema_name), film: has(snapshot.title) }
}

// Alt-Schnittstelle für das Besuchsformular.
export function parseOrderText(text) {
  const p = parseTicketText(text)
  const uniq = (xs) => [...new Set(xs.filter(Boolean))]
  return { auditorium: p.auditorium?.value ?? null, row: uniq(p.seats.map((s) => s.row)).join(', ') || null, seats: uniq(p.seats.map((s) => s.seat)).join(', ') || null }
}
