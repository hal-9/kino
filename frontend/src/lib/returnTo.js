// K16: Rücksprung nach dem Login nur zu bekannten internen Routen. Keine absoluten/protokoll-relativen URLs,
// keine Backslashes, Steuerzeichen oder Kodier-Tricks, kein Login-/Registrier-Kreis. Sonst Startseite.
const ROUTE = /^\/(vorschlaege(\/[0-9]+)?|besuche(\/[0-9]+)?|einstellungen|wrapped)?([?][A-Za-z0-9=&%._:+-]*)?$/

export function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 300) return '/'
  let decoded
  try { decoded = decodeURIComponent(value) } catch { return '/' }
  // Auch die dekodierte Form prüfen: %2F%2F, %5C, %0A dürfen keinen Umweg öffnen.
  for (const v of [value, decoded]) {
    if ([...v].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f || ch.charCodeAt(0) === 0x5c)) return '/'
    if (v.startsWith('//')) return '/'
  }
  return ROUTE.test(value) ? value : '/'
}

export const loginPath = (location) => {
  const here = location.pathname + location.search
  const safe = safeReturnTo(here)
  return safe === '/' ? '/login' : `/login?next=${encodeURIComponent(safe)}`
}
