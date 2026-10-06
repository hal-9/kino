import { addDays, berlinIso } from './normalize.js'
import { isHm } from './filters.js'

// K27: manuell eingetragener Zeitraum (Berliner Datum + Uhrzeiten) → echte Zeitpunkte (UTC).
// Ende ≤ Beginn = über Mitternacht (Ende am Folgetag). Uhrzeit in Zeitumstellungs-Lücke/-Doppelstunde → null (nicht raten).
export function localRange(date, from, to) {
  if (!isHm(from) || !isHm(to) || from === to) return null
  const start = berlinIso(date, from)
  const end = berlinIso(to < from ? addDays(date, 1) : date, to)
  if (!start || !end) return null
  return { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() }
}
