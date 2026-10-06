import crypto from 'node:crypto'

// Optionaler Header Idempotency-Key (nach requireAuth): gleiche Anfrage → gespeicherte Antwort,
// gleicher Key mit anderer Aktion/anderem Inhalt → 409. Nur erfolgreiche Antworten werden gespeichert,
// Fehler dürfen mit demselben Key wiederholt werden. Synchrone Handler (better-sqlite3) laufen nicht verschränkt.
export function idempotent(db, action) {
  return (req, res, next) => {
    const key = req.get('Idempotency-Key')
    if (key === undefined) return next()
    if (!/^[\w-]{8,100}$/.test(key)) return res.status(422).json({ error: 'validation failed' })
    const hash = crypto.createHash('sha256').update(`${action}\n${JSON.stringify(req.body ?? null)}`).digest('hex')
    const row = db.prepare('SELECT action, request_hash, status, response_json FROM idempotency_keys WHERE user_id = ? AND key = ?').get(req.user.id, key)
    if (row) {
      if (row.action !== action || row.request_hash !== hash) return res.status(409).json({ error: 'idempotency key reused' })
      return res.status(row.status).json(JSON.parse(row.response_json))
    }
    const json = res.json.bind(res)
    res.json = (body) => {
      if (res.statusCode < 300) {
        db.prepare("DELETE FROM idempotency_keys WHERE datetime(created_at) < datetime('now', '-7 days')").run()
        db.prepare('INSERT INTO idempotency_keys (user_id, key, action, request_hash, status, response_json) VALUES (?, ?, ?, ?, ?, ?)')
          .run(req.user.id, key, action, hash, res.statusCode, JSON.stringify(body))
      }
      return json(body)
    }
    next()
  }
}
