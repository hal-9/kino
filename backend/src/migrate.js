import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(__dirname, '..', 'migrations')

// upTo: nur Migrationen bis einschließlich dieses Dateinamens (Upgrade-Tests auf befüllter Alt-DB).
export function runMigrations(db, { upTo, dir = migrationsDir } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name))
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    if (applied.has(file) || (upTo && file > upTo)) continue
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    // SQLite-Verfahren für Tabellen-Neuaufbau: FK-Prüfung nur während der Migration aus (geht nur außerhalb
    // einer Transaktion), vor dem Commit aber vollständig prüfen; Verstöße rollen die Migration zurück.
    const fk = db.pragma('foreign_keys', { simple: true })
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.exec(sql)
        const bad = db.pragma('foreign_key_check')
        if (bad.length) throw new Error(`${file}: foreign_key_check ${JSON.stringify(bad.slice(0, 3))}`)
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file)
      })()
    } finally {
      db.pragma(`foreign_keys = ${fk ? 'ON' : 'OFF'}`)
    }
  }
}
