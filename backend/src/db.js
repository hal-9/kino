import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

let db

export function getDb() {
  if (db) return db
  const dbPath = process.env.DATABASE_PATH || './data/app.db'
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function resetDb() {
  if (db) db.close()
  db = undefined
}
