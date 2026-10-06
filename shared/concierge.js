import { addDays, isValidYmd } from './normalize.js'
import { isHm } from './filters.js'

// K34: Satz → prüfbare Programm-Filter (dasselbe Schema wie die Programm-URL, K14). Nie Vorstellungs-IDs, Stimmen
// oder Aktionen. Mehrdeutiges bleibt sichtbar offen (unresolved) statt erfunden. Standard-Anbieter: deterministisch,
// lokal. Ein Modell-Anbieter ist nicht eingebaut (bräuchte Freigabe für Kosten/Datenschutz).
export const FILTER_KEYS = ['tag', 'q', 'ov', 'fav', 'ab', 'bis']
const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag']
// Wortgrenzen auch für Umlaute (\b kennt nur ASCII).
const word = (body) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'gu')
const hm = (h, m = '00') => `${String(h).padStart(2, '0')}:${m}`

// Strenge Prüfung jeder Anbieter-Ausgabe: nur bekannte Felder mit gültigen Werten; alles andere → Fehler.
export function validateFilters(out) {
  const errors = []
  if (!out || typeof out !== 'object' || Array.isArray(out)) return { ok: false, errors: ['shape'] }
  const f = out.filters
  if (!f || typeof f !== 'object' || Array.isArray(f)) return { ok: false, errors: ['filters'] }
  for (const k of Object.keys(out)) if (!['filters', 'unresolved', 'ignored'].includes(k)) errors.push(k)
  for (const [k, v] of Object.entries(f)) {
    const ok = k === 'tag' ? isValidYmd(v)
      : k === 'q' ? typeof v === 'string' && v.length <= 100 && !/[\u0000-\u001f]/.test(v)
      : k === 'ov' || k === 'fav' ? v === true
      : k === 'ab' || k === 'bis' ? isHm(v)
      : false
    if (!ok) errors.push(k)
  }
  const unresolved = out.unresolved ?? []
  const okValue = (u, c) => (u.field === 'tag' ? isValidYmd(c) : isHm(c))
  const okItem = (u) => u && ['tag', 'ab', 'bis', 'version'].includes(u.field) && typeof u.text === 'string' && u.text.length <= 100 &&
    (u.candidates === undefined || (Array.isArray(u.candidates) && u.candidates.length <= 4 && u.candidates.every((c) => okValue(u, c))))
  if (!Array.isArray(unresolved) || unresolved.length > 10 || !unresolved.every(okItem)) errors.push('unresolved')
  return errors.length ? { ok: false, errors } : { ok: true, filters: f, unresolved, ignored: Array.isArray(out.ignored) ? out.ignored.filter((w) => typeof w === 'string').slice(0, 20) : [] }
}

// Deterministischer deutscher Parser. today = Berliner Datum (YYYY-MM-DD).
export function parseFilterText(text, { today }) {
  let t = String(text ?? '').slice(0, 300)
  const filters = {}
  const unresolved = []
  const take = (re, fn) => { t = t.replace(re, (...m) => { fn(...m); return ' ' }) }
  take(/["„“]([^"„“”]{1,100})["“”]/g, (_, q) => { filters.q = q.trim() })
  t = t.toLowerCase()
  take(word('übermorgen'), () => { filters.tag = addDays(today, 2) })
  take(word('heute'), () => { filters.tag = today })
  take(word('morgen'), () => { filters.tag = addDays(today, 1) })
  take(word(`(?:am\\s+|nächsten\\s+|diesen\\s+)?(${WEEKDAYS.join('|')})`), (_, d) => {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
    const first = addDays(today, (WEEKDAYS.indexOf(d) - dow + 7) % 7)
    unresolved.push({ field: 'tag', text: d[0].toUpperCase() + d.slice(1), candidates: [first, addDays(first, 7)] })
  })
  take(word('(früh|rechtzeitig|nicht zu spät)(?:[^,.]*?(?:zu ?hause|daheim|im bett))?'), (m) => unresolved.push({ field: 'bis', text: m.trim() }))
  const time = (field) => (_, h, m) => {
    const hour = Number(h)
    if (hour > 23 || (m && Number(m) > 59)) return
    // „ab 8“ ohne Minuten: 08:00 oder 20:00? Nicht raten.
    if (hour < 12 && !m) unresolved.push({ field, text: `${field === 'ab' ? 'ab' : 'bis'} ${h}`, candidates: [hm(hour), hm(hour + 12)] })
    else filters[field] = hm(hour, m ?? '00')
  }
  take(word('(?:ab|nach|beginn ab)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*uhr)?'), time('ab'))
  take(word('(?:bis|spätestens|ende bis|zuhause um)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*uhr)?'), time('bis'))
  take(word('ov|omu|omeu|original\\p{L}*|englisch\\p{L}*|untertitel\\p{L}*'), () => { filters.ov = true })
  take(word('deutsch\\p{L}*|synchro\\p{L}*|df'), (m) => unresolved.push({ field: 'version', text: m }))
  take(word('favorit\\p{L}*|lieblingskino\\p{L}*'), () => { filters.fav = true })
  const ignored = t.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !['und', 'oder', 'mit', 'ins', 'kino', 'film', 'uhr', 'gerne', 'bitte', 'wir', 'möchten', 'wollen'].includes(w))
  return { filters, unresolved, ignored }
}

// Anbieter austauschbar; jede Ausgabe wird streng geprüft. Fehler/Unsinn → ok:false, bestehende Filter bleiben unberührt.
export async function concierge(text, { today, provider = parseFilterText } = {}) {
  let out
  try {
    out = await provider(text, { today })
  } catch {
    return { ok: false, error: 'provider_failed' }
  }
  const v = validateFilters(out)
  return v.ok ? v : { ok: false, error: 'invalid_output', fields: v.errors }
}
