// Gebuchte, beendete Vorstellungen werden für die gebuchten Teilnehmer (✓ bei der gebuchten Option; Stimmen sind
// nach dem Buchen eingefroren) zum abgeleiteten Besuch (attendance 'inferred'), einmalig je Person.
// Läuft lazy beim Lesen der Besuche/Statistik; gelöschte/„nicht dabei“ bleiben über auto_visits weg,
// bestehende (auch korrigierte/bestätigte) Besuche werden nie angefasst.
export function materializeVisits(db, householdId) {
  const booked = db
    .prepare(
      `SELECT p.id, p.movie_id, p.booked_option_id, o.snapshot_json FROM proposals p
       JOIN proposal_options o ON o.id = p.booked_option_id WHERE p.household_id = ? AND p.status = 'booked'`
    )
    .all(householdId)
  const votes = db.prepare("SELECT user_id FROM votes WHERE option_id = ? AND value = 'yes' ORDER BY user_id")
  const seen = db.prepare('SELECT 1 FROM auto_visits WHERE proposal_id = ? AND user_id = ?')
  const has = db.prepare('SELECT 1 FROM visits WHERE proposal_id = ? AND user_id = ?')
  const mark = db.prepare('INSERT INTO auto_visits (proposal_id, user_id) VALUES (?, ?)')
  const insert = db.prepare(
    `INSERT INTO visits (user_id, household_id, proposal_id, movie_id, snapshot_json, watched_on, auditorium, companions_json, attendance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inferred')`
  )
  db.transaction(() => {
    for (const p of booked) {
      const s = JSON.parse(p.snapshot_json)
      const end = Date.parse(s.starts_at) + ((s.runtime ?? 120) + 20) * 60_000
      if (!(end < Date.now())) continue
      const yes = votes.all(p.booked_option_id).map((v) => v.user_id)
      for (const uid of yes) {
        if (seen.get(p.id, uid)) continue
        mark.run(p.id, uid)
        if (has.get(p.id, uid)) continue
        insert.run(uid, householdId, p.id, p.movie_id, p.snapshot_json, s.starts_at.slice(0, 10), s.auditorium ?? null, JSON.stringify(yes.filter((i) => i !== uid)))
      }
    }
  })()
}
