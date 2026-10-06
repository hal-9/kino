import { getDb } from '../db.js'
import { runMigrations } from '../migrate.js'
import { runSync } from './index.js'

const db = getDb()
runMigrations(db)
await runSync(db)
process.exit(0)
