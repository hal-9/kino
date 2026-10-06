// Minuten, die UTC hinter Berlin liegt (negativ = Berlin voraus).
export function berlinOffsetMinutes(date) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName').value // 'GMT+2'
  const m = /GMT([+-]\d+)/.exec(s)
  return m ? -Number(m[1]) * 60 : 0
}

// Echtes Kalenderdatum im Format YYYY-MM-DD (Schaltjahre, keine Überläufe wie 02-30).
export function isValidYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

// Berliner Kalenderdatum eines Zeitpunkts, unabhängig von Server-/Gerätezeitzone.
export const berlinYmd = (date = new Date()) => date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// '2026-10-13','20:15' → '2026-10-13T20:15:00+02:00' mit dem Offset der tatsächlichen Ortszeit.
// Frühjahrslücke (keine passende Ortszeit) und doppelte Herbststunde (zwei) sind ohne Provider-Offset
// nicht eindeutig → null; Aufrufer verwerfen die Zeile statt sie still zu verschieben.
export function berlinIso(dateYmd, hhmm) {
  const t = /^(\d\d):(\d\d)$/.exec(hhmm ?? '')
  if (!isValidYmd(dateYmd) || !t || Number(t[1]) > 23 || Number(t[2]) > 59) return null
  const [y, m, d] = dateYmd.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d, Number(t[1]), Number(t[2]))
  const fits = [60, 120].filter((off) => -berlinOffsetMinutes(new Date(wall - off * 60_000)) === off)
  if (fits.length !== 1) return null
  const offMin = fits[0]
  const sign = offMin >= 0 ? '+' : '-'
  const a = Math.abs(offMin)
  return `${dateYmd}T${hhmm}:00${sign}${String((a / 60) | 0).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

export function normTitle(t) {
  return String(t).toLowerCase()
    .replace(/\((ov|omu|omeu|df|2d|3d|\d{4})\)/g, ' ').replace(/\b(ov|omu|omeu|df)\b/g, ' ')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

export function slugify(name) {
  return normTitle(name).replace(/\s+/g, '-')
}

// Namen wie 'Deutsch', 'English', 'Englisch', 'Korean'
export function versionFromLanguages(audio, subtitle) {
  const isDe = (s) => /^(de|deutsch|german)/i.test(s || '')
  const isEn = (s) => /^(en|englisch|english)/i.test(s || '')
  if (!audio && !subtitle) return null
  if (isDe(audio) && !subtitle) return 'DF'
  if (subtitle && isDe(subtitle)) return 'OmU'
  if (subtitle && isEn(subtitle)) return 'OmeU'
  if (audio && !isDe(audio) && !subtitle) return 'OV'
  return subtitle ? 'OmU' : null
}

// K30: Saal innerhalb eines Kinos: nur Groß-/Kleinschreibung, Leer- und Satzzeichen vereinheitlichen.
// Bewusst kein Gleichsetzen von „Kino 1“ und „Saal 1“ (nicht verifiziert) – unbekannt wird nicht geraten.
export const normRoom = (name) => String(name ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
