// K21/D08: Kennzahlen mit fester Bedeutung, gleich für Bildschirm und Export.
// Eingabe je Besuch (eine Person): { id, user_id, event_key, movie_id, runtime, attendance }.
// event_key = verlässlich verknüpfte physische Vorstellung (Screening/Buchung) oder null (ungruppiert).
// - outings: verschiedene Vorstellungen; ungruppierte Besuche zählen einzeln (nie per Titel/Tag geraten).
// - films: verschiedene movie_id (lokale Film-Identität); Besuche ohne Film zählen nicht.
// - person_visits: Personen je Vorstellung (doppelte Einträge derselben Person bei derselben Vorstellung einmal).
// - minutes: Summe bekannter Filmlaufzeiten je Personenbesuch, ohne Werbung/Trailer; unbekannte Laufzeit separat.
// - unconfirmed: davon automatisch abgeleitet (inferred) oder Alt-Übernahme (legacy), eingerechnet und ausgewiesen.
// Gelöschte und „nicht dabei“-Besuche existieren nicht mehr und zählen nie.
export function aggregateVisits(visits) {
  const seen = new Set()
  const events = new Set()
  const films = new Set()
  let personVisits = 0, minutes = 0, unknownRuntime = 0, unconfirmed = 0, ungrouped = 0
  for (const v of visits) {
    const event = v.event_key ?? `visit:${v.id}`
    const key = `${v.user_id}|${event}`
    if (seen.has(key)) continue
    seen.add(key)
    events.add(event)
    if (v.event_key == null) ungrouped++
    if (v.movie_id != null) films.add(v.movie_id)
    personVisits++
    if (v.runtime > 0) minutes += v.runtime
    else unknownRuntime++
    if (v.attendance === 'inferred' || v.attendance === 'legacy') unconfirmed++
  }
  return {
    outings: events.size, films: films.size, person_visits: personVisits,
    minutes, person_hours: Math.round((minutes / 60) * 10) / 10, unknown_runtime: unknownRuntime, unconfirmed, ungrouped,
  }
}
