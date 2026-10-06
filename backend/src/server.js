import { getDb } from './db.js'
import { runMigrations } from './migrate.js'
import { createApp } from './app.js'
import { runSync, seedCinemas } from './sync/index.js'
import { cleanupUploads } from './uploads.js'

const db = getDb()
runMigrations(db)
seedCinemas(db)
// K32: abgebrochene Uploads (Datei ohne Eintrag) entfernen; fehlende Dateien nur melden.
const up = cleanupUploads(db)
if (up.removed || up.missing) console.log(`uploads: ${up.removed} verwaist entfernt, ${up.missing} fehlen`)

const port = process.env.PORT || 3005
createApp(db).listen(port, () => {
  console.log(`Kino-API läuft auf Port ${port}`)
})

const sync = () => runSync(db).catch((e) => console.error('sync:', e))
setTimeout(sync, 15_000)
setInterval(sync, 12 * 60 * 60 * 1000)
