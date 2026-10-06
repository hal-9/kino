// K26: kleine gemeinsame Verträge (reine Funktionen, ohne Provider/UI testbar).

// Planungsstatus-Übergänge eines Vorschlags (D04): Aktion → erlaubte Ausgangsstatus.
export const PROPOSAL_TRANSITIONS = {
  book: ['open'], reschedule: ['booked'], cancel: ['open', 'booked'], reopen: ['booked', 'cancelled'], review: ['open', 'booked'],
}
export const canTransition = (action, status) => Boolean(PROPOSAL_TRANSITIONS[action]?.includes(status))

/**
 * Zeile eines Quell-Adapters (eine beobachtete Vorstellung), bevor sie importiert wird.
 * @typedef {{ cinemaKey: string, title: string, startsAt: string, year?: number|null, runtime?: number|null,
 *   version?: string|null, auditorium?: string|null, ticketUrl?: string|null, source: string, sourceId?: string|null }} ScreeningRow
 */

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)$/
const optStr = (v, max) => v == null || (typeof v === 'string' && v.length <= max)
const optNum = (v, lo, hi) => v == null || (Number.isFinite(v) && v >= lo && v <= hi)

// Liste der Probleme (leer = gültig). Zeit nur mit Offset/Z (keine stille Ortszeit), Ticket-Link nur http(s).
export function screeningRowProblems(row) {
  const p = []
  if (!row || typeof row !== 'object') return ['row']
  if (typeof row.cinemaKey !== 'string' || !row.cinemaKey.trim() || row.cinemaKey.length > 100) p.push('cinemaKey')
  if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 300) p.push('title')
  if (typeof row.startsAt !== 'string' || !INSTANT.test(row.startsAt) || Number.isNaN(Date.parse(row.startsAt))) p.push('startsAt')
  if (typeof row.source !== 'string' || !row.source) p.push('source')
  if (!optNum(row.year, 1888, 2100)) p.push('year')
  if (!optNum(row.runtime, 1, 1000)) p.push('runtime')
  if (!optStr(row.version, 20)) p.push('version')
  if (!optStr(row.auditorium, 100)) p.push('auditorium')
  if (!optStr(row.ticketUrl, 2000) || (row.ticketUrl != null && !/^https?:\/\//i.test(row.ticketUrl))) p.push('ticketUrl')
  return p
}
