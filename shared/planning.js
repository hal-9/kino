import { addDays, berlinIso } from './normalize.js'
import { estimatedEnd, isHm, timeFit } from './filters.js'

// K27: manuell eingetragener Zeitraum (Berliner Datum + Uhrzeiten) → echte Zeitpunkte (UTC).
// Ende ≤ Beginn = über Mitternacht (Ende am Folgetag). Uhrzeit in Zeitumstellungs-Lücke/-Doppelstunde → null (nicht raten).
export function localRange(date, from, to) {
  if (!isHm(from) || !isHm(to) || from === to) return null
  const start = berlinIso(date, from)
  const end = berlinIso(to < from ? addDays(date, 1) : date, to)
  if (!start || !end) return null
  return { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() }
}

// K28/D07: „Nächster Kinoabend“ – reine, deterministische Zuordnung. Erst harte Filter, dann transparente Punkte.
// Unbekannt (Laufzeit/Fassung/Zeiten) ist nie „passt“. Punkte können ein hartes Nein nie aufwiegen.
export const MATCH_POINTS = { interest: 20, cinema: 5, version: 2 }
const OV_SET = ['OV', 'OmU', 'OmeU']

function versionState(version, want) {
  if (version == null) return 'unknown'
  return (want === 'ov' ? OV_SET.includes(version) : version === 'DF') ? 'fit' : 'no'
}

// Passung einer Person zu einer Vorstellung: { fit: 'fit'|'no'|'unknown', reasons: [code] } (nur Codes, keine Werte).
export function personFit(person, s) {
  const p = person.prefs ?? {}
  const out = []
  const add = (state, code) => { if (state !== 'fit') out.push({ state, code }) }
  if (p.version?.strength === 'hard') {
    const v = versionState(s.version, p.version.value)
    add(v, v === 'unknown' ? 'version_unknown' : 'version')
  }
  if (p.cinemas?.strength === 'hard') add(p.cinemas.keys.includes(s.cinema_key) ? 'fit' : 'no', 'cinema')
  const buffer = p.buffer_minutes ?? 0
  const runtime = s.runtime > 0 ? s.runtime + buffer : null
  if (p.earliest || p.latest_end) {
    const t = timeFit(s.starts_at, runtime, { earliest: p.earliest || undefined, latestEnd: p.latest_end || undefined })
    add(t === 'out' ? 'no' : t, t === 'unknown' ? 'runtime_unknown' : 'time')
  }
  const start = Date.parse(s.starts_at)
  const end = estimatedEnd(s.starts_at, runtime)
  const ranges = (person.availability ?? []).map((a) => ({ kind: a.kind, from: Date.parse(a.starts_at), to: Date.parse(a.ends_at) }))
  if (ranges.some((r) => r.kind === 'busy' && r.from < (end ?? start + 1) && r.to > start)) add('no', 'availability')
  else if (end == null) add('unknown', 'runtime_unknown')
  else if (!ranges.some((r) => r.kind === 'free' && r.from <= start && r.to >= end)) add('unknown', 'availability_unknown')
  const fit = out.some((r) => r.state === 'no') ? 'no' : out.length ? 'unknown' : 'fit'
  return { fit, reasons: [...new Set(out.map((r) => r.code))] }
}

function softScore(people, s) {
  const parts = []
  const count = (code, n) => n && parts.push({ code, people: n, points: n * MATCH_POINTS[code] })
  count('interest', people.filter((p) => (p.interested ?? []).includes(s.movie_id)).length)
  count('cinema', people.filter((p) => p.prefs?.cinemas?.keys.includes(s.cinema_key)).length)
  count('version', people.filter((p) => p.prefs?.version && versionState(s.version, p.prefs.version.value) === 'fit').length)
  return { score: parts.reduce((n, x) => n + x.points, 0), parts }
}

// mode 'all' = alle Ausgewählten müssen können (ein Nein schließt aus; Unbekanntes → 'tentative').
// mode 'max' = möglichst viele bekannte Zusagen (nichts wird verschwiegen: passt/passt nicht/unbekannt je Person).
// Liefert höchstens `limit` echte Vorstellungen, gern weniger; excluded zählt Ausschlussgründe (für freiwilliges Lockern).
export function matchScreenings({ screenings, people, mode = 'all', limit = 3 }) {
  const ranked = []
  const excluded = {}
  for (const s of screenings) {
    const fits = people.map((p) => ({ user_id: p.id, ...personFit(p, s) }))
    const known = fits.filter((f) => f.fit === 'fit').length
    const no = fits.filter((f) => f.fit === 'no')
    if ((mode === 'all' && no.length) || no.length === fits.length) {
      for (const code of new Set(no.flatMap((f) => f.reasons))) excluded[code] = (excluded[code] ?? 0) + 1
      continue
    }
    const status = known === fits.length ? 'feasible' : mode === 'all' ? 'tentative' : 'partial'
    ranked.push({ screening: s, status, known_fit: known, people: fits, ...softScore(people, s) })
  }
  const statusRank = (r) => (r.status === 'feasible' ? 0 : 1)
  ranked.sort((a, b) =>
    (mode === 'max' ? b.known_fit - a.known_fit : statusRank(a) - statusRank(b)) ||
    b.score - a.score || b.known_fit - a.known_fit ||
    Date.parse(a.screening.starts_at) - Date.parse(b.screening.starts_at) || a.screening.id - b.screening.id)
  return { results: ranked.slice(0, limit), considered: screenings.length, excluded }
}
