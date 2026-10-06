// K12: Live-Abweichungen einer Option gegenüber ihrem unveränderlichen Snapshot. Läuft lazy beim Lesen
// (wie materializeVisits) und speichert jede Abweichung einmal. Unbekannt (null) ist keine Änderung.
const MAX_HOPS = 5

function diffs(db, option, snap) {
  const byId = db.prepare('SELECT * FROM screenings WHERE id = ?')
  const moveOf = db.prepare("SELECT new_value, source FROM screening_changes WHERE screening_id = ? AND field = 'moved_to' ORDER BY id DESC LIMIT 1")
  let s = byId.get(option.screening_id)
  if (!s) return []
  let movedBy = null
  for (let i = 0, m; i < MAX_HOPS && (m = moveOf.get(s.id)); i++) {
    const next = byId.get(Number(m.new_value))
    if (!next) break
    s = next
    movedBy = m.source
  }
  const out = []
  const prov = JSON.parse(s.provenance_json ?? '{}')
  if (movedBy && Date.parse(s.starts_at) !== Date.parse(snap.starts_at)) out.push({ field: 'starts_at', before: snap.starts_at, after: s.starts_at, source: movedBy, certainty: 'confirmed' })
  if (movedBy && s.cinema_key !== snap.cinema_key) out.push({ field: 'cinema', before: snap.cinema_key, after: s.cinema_key, source: movedBy, certainty: 'confirmed' })
  for (const f of ['version', 'auditorium']) {
    if (snap[f] != null && s[f] != null && snap[f] !== s[f]) out.push({ field: f, before: snap[f], after: s[f], source: prov[f]?.source ?? movedBy, certainty: 'confirmed' })
  }
  if (s.withdrawn_at) {
    out.push({ field: 'availability', before: 'active', after: 'withdrawn', source: null, certainty: 'confirmed' })
  } else {
    // Teilweise Abwesenheit: alle aktiven Quellen haben die Vorstellung zuletzt nicht gesehen → unsicher, keine Absage.
    const o = db.prepare('SELECT COUNT(*) n, SUM(missing_count > 0) missing FROM screening_observations WHERE screening_id = ? AND withdrawn_at IS NULL').get(s.id)
    if (o.n > 0 && o.missing === o.n) out.push({ field: 'availability', before: 'active', after: 'missing', source: null, certainty: 'uncertain' })
  }
  return out
}

// option = proposal_options-Zeile; liefert die aktuell gültigen Abweichungen mit Speicher-ID und Quittung.
export function optionChanges(db, option, snap, now = Date.now()) {
  if (!option.screening_id || !(Date.parse(snap.starts_at) > now)) return []
  const save = db.prepare(
    `INSERT INTO option_changes (option_id, field, before_value, after_value, source, certainty) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (option_id, field, after_value) DO NOTHING`
  )
  const get = db.prepare('SELECT id, detected_at, acknowledged_at FROM option_changes WHERE option_id = ? AND field = ? AND after_value IS ?')
  return diffs(db, option, snap).map((d) => {
    save.run(option.id, d.field, d.before, d.after, d.source, d.certainty)
    const row = get.get(option.id, d.field, d.after)
    return { id: row.id, ...d, detected_at: row.detected_at, acknowledged: Boolean(row.acknowledged_at) }
  })
}

// Nicht buchbar, egal ob quittiert: Vorstellung verschoben, anderes Kino oder zurückgezogen.
export const blocksBooking = (c) => c.field === 'starts_at' || c.field === 'cinema' || c.after === 'withdrawn'
