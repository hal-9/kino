import { AD_MINUTES, estimatedEnd } from 'shared'

export const FALLBACK_RUNTIME = 120 // wie Kalender/Auto-Besuche, aber hier ausdrücklich als Annahme benannt

// K17: nächste gebuchte, noch nicht begonnene Vorstellung (unabhängig vom Alter des Vorschlags).
export function nextOuting(proposals, now = Date.now()) {
  return proposals
    .filter((p) => p.status === 'booked')
    .map((p) => ({ p, option: p.options.find((o) => o.id === p.booked_option_id) }))
    .filter((x) => x.option && Date.parse(x.option.snapshot.starts_at) > now)
    .sort((a, b) => Date.parse(a.option.snapshot.starts_at) - Date.parse(b.option.snapshot.starts_at))[0] ?? null
}

const hm = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
export function endText(snapshot) {
  if (snapshot.runtime) return `Ende ca. ${hm(estimatedEnd(snapshot.starts_at, snapshot.runtime))} (inkl. ~${AD_MINUTES} Min. Werbung)`
  return `Ende ca. ${hm(estimatedEnd(snapshot.starts_at, FALLBACK_RUNTIME))} (geschätzt: Laufzeit unbekannt, ${FALLBACK_RUNTIME} Min. angenommen)`
}

export const address = (s) => [s.cinema_name, s.street, [s.zip, 'Berlin'].filter(Boolean).join(' ')].filter(Boolean).join(', ')
// Route ohne Standortzugriff: nur Ziel kodiert in einem Karten-Link.
export const directionsUrl = (s) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address(s))}`
