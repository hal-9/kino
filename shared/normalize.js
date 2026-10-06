// Minuten, die UTC hinter Berlin liegt (negativ = Berlin voraus).
export function berlinOffsetMinutes(date) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName').value // 'GMT+2'
  const m = /GMT([+-]\d+)/.exec(s)
  return m ? -Number(m[1]) * 60 : 0
}

// '2026-10-13','20:15' → '2026-10-13T20:15:00+02:00'
export function berlinIso(dateYmd, hhmm) {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d, 12)) // Mittag, um DST-Grenzen zu vermeiden
  const offMin = -berlinOffsetMinutes(probe)
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
