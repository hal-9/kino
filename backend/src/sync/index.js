import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { berlinYmd, normTitle, slugify } from 'shared'
import { createFetch } from './util.js'
import * as kinoheld from './kinoheld.js'
import * as yorck from './yorck.js'
import * as zoopalast from './zoopalast.js'
import * as uci from './uci.js'
import * as berlinde from './berlinde.js'
import * as tmdb from '../tmdb.js'
import * as letterboxd from '../letterboxd.js'

const CINEMAS_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'cinemas.json')
const ADAPTERS = { kinoheld, yorck, zoopalast, uci, berlinde }

// Lease über Prozesse (Server-Timer, CLI): kurze Transaktionen, nie über Netzabrufe gehalten.
const LEASE_TTL_MS = 15 * 60_000
class LeaseLost extends Error {}

// → Fencing-Token oder null, wenn ein anderer Besitzer eine gültige Lease hält.
export function acquireLease(db, owner) {
  return db.transaction(() => {
    const now = Date.now()
    const row = db.prepare("SELECT * FROM sync_lease WHERE name = 'sync'").get()
    if (row && row.owner !== owner && Date.parse(row.expires_at) > now) return null
    const token = (row?.token ?? 0) + 1
    db.prepare(
      `INSERT INTO sync_lease (name, owner, token, expires_at) VALUES ('sync', ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, token = excluded.token, expires_at = excluded.expires_at`
    ).run(owner, token, new Date(now + LEASE_TTL_MS).toISOString())
    return token
  }).immediate()
}

// Heartbeat + Fencing: verlängert nur die eigene, noch gültige Lease; sonst LeaseLost (kein Commit mehr).
function holdLease(db, lease) {
  const now = Date.now()
  const ok = db
    .prepare("UPDATE sync_lease SET expires_at = ? WHERE name = 'sync' AND owner = ? AND token = ? AND expires_at > ?")
    .run(new Date(now + LEASE_TTL_MS).toISOString(), lease.owner, lease.token, new Date(now).toISOString()).changes
  if (!ok) throw new LeaseLost('Sync-Lease verloren')
}

export function seedCinemas(db) {
  const favs = JSON.parse(fs.readFileSync(CINEMAS_JSON, 'utf8'))
  const upsert = db.prepare(
    `INSERT INTO cinemas (key, name, chain, kinoheld_id, is_favorite, aliases_json) VALUES (@key, @name, @chain, @kinoheld_id, 1, @aliases)
     ON CONFLICT (key) DO UPDATE SET name = excluded.name, chain = excluded.chain, kinoheld_id = excluded.kinoheld_id,
       is_favorite = 1, aliases_json = excluded.aliases_json, updated_at = datetime('now')`
  )
  const aud = db.prepare('INSERT OR IGNORE INTO auditoriums (cinema_key, name) VALUES (?, ?)')
  db.transaction(() => {
    for (const c of favs) {
      upsert.run({ key: c.key, name: c.name, chain: c.chain, kinoheld_id: c.kinoheld_id, aliases: JSON.stringify(c.aliases) })
      for (const a of c.auditoriums) aud.run(c.key, a.name)
    }
  })()
}

function upsertKinoheldCinemas(db, list) {
  const byId = db.prepare('SELECT key FROM cinemas WHERE kinoheld_id = ?')
  const update = db.prepare(
    `UPDATE cinemas SET street = @street, zip = @zip, lat = @lat, lng = @lng, kinoheld_slug = @slug, updated_at = datetime('now') WHERE key = @key`
  )
  const insert = db.prepare(
    `INSERT OR IGNORE INTO cinemas (key, name, chain, street, zip, lat, lng, kinoheld_id, kinoheld_slug)
     VALUES (@key, @name, @chain, @street, @zip, @lat, @lng, @kinoheldId, @slug)`
  )
  db.transaction(() => {
    for (const c of list) {
      const hit = byId.get(c.kinoheldId)
      if (hit) update.run({ ...c, key: hit.key })
      else insert.run({ ...c, key: slugify(c.name) })
    }
  })()
}

function loadCinemas(db) {
  return new Map(
    db.prepare('SELECT * FROM cinemas').all().map((c) => [c.key, { ...c, aliases: JSON.parse(c.aliases_json) }])
  )
}

// Schlüssel einer Beobachtung: Provider-ID, sonst Fallback Kino|Titel|UTC-Zeitpunkt|Saal|Fassung
// (bewusst ohne Ticket-Token und Auslastung). Ändert sich ein Fallback-Feld, entsteht eine neue Beobachtung.
export const sourceKey = (row) =>
  row.sourceId != null && row.sourceId !== ''
    ? String(row.sourceId)
    : [row.cinemaKey, normTitle(row.title), new Date(row.startsAt).toISOString(), row.auditorium ?? '', row.version ?? ''].join('|')

const fits = (a, b) => a == null || b == null || a === b

// Kandidaten: Vorstellungen desselben Films, Kinos und Zeitpunkts (mit den Quellen, die sie schon beobachtet haben).
// Treffer nur bei genau einem verträglichen Kandidaten: bekannte Saal-/Fassungswerte müssen gleich sein, und
// dieselbe Quelle kennt ihn nicht schon unter anderem Schlüssel. Mehrdeutig → keine Zusammenlegung.
export function resolveScreening(row, candidates) {
  const ok = candidates.filter((c) => !c.sources.includes(row.source) && fits(c.version, row.version) && fits(c.auditorium, row.auditorium))
  return ok.length === 1 ? ok[0].id : null
}

// Film: exakter normierter Titel (+ Jahr), sonst verifizierter Alias (TMDB-Originaltitel). Titelanfänge sind
// kein Beweis; ein Titel ohne Jahr wird bei mehreren gleichnamigen Filmen keinem zugeschlagen.
export function pickMovie(candidates, year) {
  if (year) {
    const exact = candidates.find((m) => m.year === year)
    if (exact) return { id: exact.id }
    return candidates.length === 1 && candidates[0].year == null ? { id: candidates[0].id, adoptYear: true } : null
  }
  if (candidates.length === 1) return { id: candidates[0].id }
  const yearless = candidates.find((m) => m.year == null)
  return yearless ? { id: yearless.id } : null
}

// Basis (kinoheld, Ketten-Aggregator) zuerst geladen, Häuser/Overlays gehen bei Feldwerten vor.
const TIER = { kinoheld: 0 }
const tier = (source) => TIER[source] ?? 1
const MATERIAL = ['version', 'auditorium']

// Felder einer Vorstellung aus ihren aktiven Beobachtungen ableiten: Rang (Overlay vor Basis), dann neuester
// Capture, dann Quellname. Unabhängig von Import-Reihenfolge; Herkunft je Feld, materielle Änderungen protokolliert.
// Auslastung: neueste Beobachtung einer Quelle, die Auslastung meldet (null = unbekannt, nicht „frei“).
function refreshScreening(db, id, now) {
  const obs = db.prepare('SELECT * FROM screening_observations WHERE screening_id = ? AND withdrawn_at IS NULL').all(id)
  if (!obs.length) return
  obs.sort((a, b) => tier(b.source) - tier(a.source) || b.observed_at.localeCompare(a.observed_at) || a.source.localeCompare(b.source))
  const prov = {}
  const next = {}
  for (const f of ['version', 'auditorium', 'ticket_url']) {
    const o = obs.find((x) => x[f] != null)
    next[f] = o?.[f] ?? null
    if (o) prov[f] = { source: o.source, observed_at: o.observed_at }
  }
  const cap = obs.filter((o) => o.capacity_at).sort((a, b) => b.capacity_at.localeCompare(a.capacity_at))[0]
  if (cap) prov.capacity = { source: cap.source, observed_at: cap.capacity_at }
  const old = db.prepare('SELECT * FROM screenings WHERE id = ?').get(id)
  const logChange = db.prepare('INSERT INTO screening_changes (screening_id, field, old_value, new_value, source, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
  // Nur Änderungen eines bekannten Werts sind Korrekturen; Auffüllen von unbekannt nicht.
  for (const f of MATERIAL) if (old[f] != null && old[f] !== next[f] && old.provenance_json) logChange.run(id, f, old[f], next[f], prov[f]?.source ?? null, now)
  db.prepare(
    `UPDATE screenings SET version = ?, auditorium = ?, ticket_url = ?, attrs_json = ?, capacity = ?, capacity_at = ?,
       provenance_json = ?, last_seen_at = ?, withdrawn_at = NULL WHERE id = ?`
  ).run(
    next.version, next.auditorium, next.ticket_url, JSON.stringify([...new Set(obs.flatMap((o) => JSON.parse(o.attrs_json)))].sort()),
    cap?.capacity ?? null, cap?.capacity_at ?? null, JSON.stringify(prov), now, id
  )
}

function mergeRows(db, rows, observedAt) {
  db.function('norm_title', { deterministic: true }, (t) => (t == null ? null : normTitle(t)))
  const byNorm = db.prepare('SELECT id, year FROM movies WHERE norm_title = ? ORDER BY id')
  const byAlias = db.prepare('SELECT id, year FROM movies WHERE tmdb_id IS NOT NULL AND norm_title(title_original) = ? ORDER BY id')
  const setYear = db.prepare('UPDATE movies SET year = ? WHERE id = ?')
  const insMovie = db.prepare('INSERT INTO movies (title, norm_title, year, runtime) VALUES (?, ?, ?, ?)')
  const setRuntime = db.prepare('UPDATE movies SET runtime = ? WHERE id = ? AND runtime IS NULL')
  const hasCinema = db.prepare('SELECT 1 FROM cinemas WHERE key = ?')
  const insCinema = db.prepare('INSERT INTO cinemas (key, name) VALUES (?, ?)')
  const observed = db.prepare(
    `SELECT s.* FROM screening_observations o JOIN screenings s ON s.id = o.screening_id
     WHERE o.source = ? AND o.source_key = ? AND s.movie_id = ? AND s.cinema_key = ? AND datetime(s.starts_at) = datetime(?)`
  )
  const candidates = db.prepare(
    `SELECT s.*, (SELECT group_concat(o.source) FROM screening_observations o WHERE o.screening_id = s.id) AS sources
     FROM screenings s WHERE s.cinema_key = ? AND s.movie_id = ? AND datetime(s.starts_at) = datetime(?)`
  )
  const byId = db.prepare('SELECT * FROM screenings WHERE id = ?')
  const insShow = db.prepare(
    `INSERT INTO screenings (cinema_key, movie_id, starts_at, version, auditorium, attrs_json, ticket_url, source, source_id)
     VALUES (@cinemaKey, @movieId, @startsAt, @version, @auditorium, @attrs, @ticketUrl, @source, @sourceId)`
  )
  const observe = db.prepare(
    `INSERT INTO screening_observations (screening_id, source, source_key, cinema_key, title, year, starts_at, version, auditorium,
       attrs_json, ticket_url, runtime, capacity, capacity_at, observed_at, first_seen_at, last_seen_at)
     VALUES (@screeningId, @source, @key, @cinemaKey, @title, @year, @startsAt, @version, @auditorium,
       @attrs, @ticketUrl, @runtime, @capacity, @capacityAt, @observedAt, @observedAt, @observedAt)
     ON CONFLICT (source, source_key) DO UPDATE SET screening_id = excluded.screening_id, cinema_key = excluded.cinema_key,
       title = excluded.title, year = excluded.year, starts_at = excluded.starts_at, version = excluded.version,
       auditorium = excluded.auditorium, attrs_json = excluded.attrs_json, ticket_url = excluded.ticket_url,
       runtime = excluded.runtime, capacity = excluded.capacity, capacity_at = excluded.capacity_at,
       observed_at = excluded.observed_at, last_seen_at = excluded.observed_at, missing_count = 0, missing_since = NULL, withdrawn_at = NULL
     WHERE excluded.observed_at >= screening_observations.observed_at -- ältere Captures drehen nichts zurück
     RETURNING id`
  )
  const obsId = db.prepare('SELECT id, screening_id FROM screening_observations WHERE source = ? AND source_key = ?')
  // K12: Derselbe Anbieter-Schlüssel zeigt jetzt auf eine andere Vorstellung (Zeit/Film korrigiert) → Umzug protokollieren;
  // die alte Vorstellung ohne aktive Beobachtung gilt als zurückgezogen (Quelle hat sie ausdrücklich ersetzt).
  const logMove = db.prepare("INSERT INTO screening_changes (screening_id, field, old_value, new_value, source, changed_at) VALUES (?, 'moved_to', NULL, ?, ?, ?)")
  const retireOrphan = db.prepare(
    `UPDATE screenings SET withdrawn_at = ? WHERE id = ? AND withdrawn_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM screening_observations WHERE screening_id = ? AND withdrawn_at IS NULL)`
  )
  const movieCache = new Map()
  const seen = new Set() // IDs der in diesem Lauf beobachteten screening_observations
  const touched = new Set() // Vorstellungen, deren Felder neu abzuleiten sind

  function movieId(row) {
    const norm = normTitle(row.title)
    const ck = `${norm}|${row.year ?? ''}`
    if (movieCache.has(ck)) return movieCache.get(ck)
    let ms = byNorm.all(norm)
    if (!ms.length) ms = byAlias.all(norm)
    const hit = pickMovie(ms, row.year)
    if (hit?.adoptYear) setYear.run(row.year, hit.id)
    const id = hit?.id ?? Number(insMovie.run(row.title, norm, row.year, row.runtime).lastInsertRowid)
    if (row.runtime) setRuntime.run(row.runtime, id)
    movieCache.set(ck, id)
    return id
  }

  db.transaction(() => {
    for (const row of rows) {
      if (!hasCinema.get(row.cinemaKey)) insCinema.run(row.cinemaKey, row.cinemaName)
      const id = movieId(row)
      const key = sourceKey(row)
      const attrs = JSON.stringify(row.attrs)
      let old = observed.get(row.source, key, id, row.cinemaKey, row.startsAt)
      if (!old) {
        const cands = candidates.all(row.cinemaKey, id, row.startsAt).map((c) => ({ ...c, sources: c.sources?.split(',') ?? [] }))
        const sid = resolveScreening(row, cands)
        old = sid && byId.get(sid)
      }
      const screeningId = old ? old.id : Number(insShow.run({ ...row, movieId: id, attrs }).lastInsertRowid)
      // capacity undefined = Quelle meldet keine Auslastung; null = gemeldet, aber unbekannt.
      const capacity = row.capacity === undefined ? { capacity: null, capacityAt: null } : { capacity: row.capacity, capacityAt: observedAt }
      const prior = obsId.get(row.source, key)
      const o = observe.get({ ...row, ...capacity, screeningId, key, attrs, observedAt })
      seen.add(o?.id ?? obsId.get(row.source, key).id)
      if (o && prior && prior.screening_id !== screeningId) {
        logMove.run(prior.screening_id, String(screeningId), row.source, observedAt)
        retireOrphan.run(observedAt, prior.screening_id, prior.screening_id)
      }
      touched.add(screeningId)
    }
  })()
  return { seen, touched }
}

// Mindestabstand zwischen erster und bestätigender Abwesenheit (Sync läuft alle 12 h, Mac-Inbox öfter).
const WITHDRAW_AFTER_HOURS = 6

// Nur bei vollständig gemeldetem Scope (Kinos × Tage) und neuem Capture-Inhalt: nicht gesehene Beobachtungen
// dieser Quelle zählen als abwesend; zwei verschiedene Captures mit Abstand ziehen sie zurück (weich, nichts gelöscht).
// Eine Vorstellung gilt erst als zurückgezogen, wenn keine Quelle sie mehr aktiv beobachtet.
function retireMissing(db, source, coverage, seen, now) {
  const scoped = db
    .prepare(
      `SELECT id, screening_id FROM screening_observations WHERE source = ? AND withdrawn_at IS NULL
         AND cinema_key IN (SELECT value FROM json_each(?)) AND substr(starts_at, 1, 10) BETWEEN ? AND ?
         AND datetime(starts_at) > datetime(?)`
    )
    .all(source, JSON.stringify(coverage.cinemas), coverage.from, coverage.to, now)
  const miss = db.prepare('UPDATE screening_observations SET missing_count = missing_count + 1, missing_since = COALESCE(missing_since, ?) WHERE id = ?')
  const withdraw = db.prepare(
    `UPDATE screening_observations SET withdrawn_at = ? WHERE id = ? AND missing_count >= 2
       AND datetime(missing_since) <= datetime(?, '-${WITHDRAW_AFTER_HOURS} hours')`
  )
  const retire = db.prepare(
    `UPDATE screenings SET withdrawn_at = ? WHERE id = ? AND withdrawn_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM screening_observations WHERE screening_id = ? AND withdrawn_at IS NULL)`
  )
  const changed = []
  for (const o of scoped) {
    if (seen.has(o.id)) continue
    miss.run(now, o.id)
    if (!withdraw.run(now, o.id, now).changes) continue
    if (!retire.run(now, o.screening_id, o.screening_id).changes) changed.push(o.screening_id)
  }
  return changed
}

// Ein Quell-Import ist eine Transaktion: Daten, Rückzüge und Erfolgszeitpunkte gemeinsam oder gar nicht.
// last_ok_at = letzter erfolgreicher (auch teilweiser) Import; last_complete_import_at nur mit vollständigem Scope.
function importSource(db, source, rows, coverage, now, capturedAt = now, lease) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  db.transaction(() => {
    if (lease) holdLease(db, lease) // in derselben Transaktion: nur der gültige Besitzer committet
    const { seen, touched } = mergeRows(db, rows, capturedAt)
    const prev = db.prepare('SELECT last_digest FROM source_health WHERE source = ?').get(source)
    // Derselbe Inhalt erneut (z. B. Cache-Replay) ist keine neue Abwesenheitsbeobachtung.
    const fresh = coverage && prev?.last_digest !== digest
    // Noch aktiv beobachtete Vorstellungen, deren Beobachtung dieser Quelle zurückgezogen wurde, neu ableiten.
    if (fresh) for (const id of retireMissing(db, source, coverage, seen, now)) touched.add(id)
    for (const id of touched) refreshScreening(db, id, now)
    db.prepare(
      `INSERT INTO source_health (source, last_ok_at, last_count, last_error, last_attempt_at, last_captured_at, last_complete_import_at, last_digest)
       VALUES (@source, @now, @count, NULL, @now, @capturedAt, @complete, @digest)
       ON CONFLICT (source) DO UPDATE SET last_ok_at = @now, last_count = @count, last_error = NULL, last_attempt_at = @now,
         last_captured_at = @capturedAt, last_complete_import_at = COALESCE(@complete, last_complete_import_at),
         last_digest = COALESCE(@digest, last_digest)`
    ).run({ source, now, capturedAt, count: rows.length, complete: coverage ? now : null, digest: fresh ? digest : null })
  })()
}

// Fehlversuch nach Rollback separat festhalten; Erfolgszeitpunkte bleiben unverändert.
function recordFailure(db, source, message, now) {
  db.prepare(
    `INSERT INTO source_health (source, last_error, last_error_at, last_attempt_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (source) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at, last_attempt_at = excluded.last_attempt_at`
  ).run(source, message, now, now)
}

export async function runSync(db, { fetch = createFetch(), log = console.log, adapters = ADAPTERS, today, minRows = (m) => m.MIN_ROWS } = {}) {
  const lease = { owner: `${os.hostname()}:${process.pid}:${crypto.randomUUID()}` }
  lease.token = acquireLease(db, lease.owner)
  if (!lease.token) {
    log('sync: läuft bereits (Lease belegt), übersprungen')
    return { skipped: true }
  }
  try {
    today ??= berlinYmd()
    seedCinemas(db)
    const ctx = { fetch, log, today, cinemas: loadCinemas(db) }

    if (adapters.kinoheld?.fetchCinemas) {
      try {
        const list = await adapters.kinoheld.fetchCinemas(ctx)
        holdLease(db, lease)
        upsertKinoheldCinemas(db, list)
        ctx.cinemas = loadCinemas(db)
        const setAud = db.prepare(
          `INSERT INTO auditoriums (cinema_key, name, seats) VALUES (?, ?, ?)
           ON CONFLICT (cinema_key, name) DO UPDATE SET seats = excluded.seats`
        )
        for (const c of ctx.cinemas.values()) {
          if (!c.is_favorite || !c.kinoheld_id) continue
          for (const a of await adapters.kinoheld.fetchAuditoriums(ctx, c.kinoheld_id).catch(() => [])) {
            if (a.seats != null) setAud.run(c.key, a.name, a.seats)
          }
        }
      } catch (e) {
        log(`kinoheld cinemas: ${e.message}`)
      }
    }
    if (adapters.zoopalast?.fetchAuditoriums) {
      try {
        const set = db.prepare(
          `INSERT INTO auditoriums (cinema_key, name, seats) VALUES ('zoo-palast', ?, ?)
           ON CONFLICT (cinema_key, name) DO UPDATE SET seats = excluded.seats`
        )
        for (const a of await adapters.zoopalast.fetchAuditoriums(ctx)) set.run(a.name, a.seats)
      } catch (e) {
        log(`zoopalast auditoriums: ${e.message}`)
      }
    }

    let total = 0
    const ok = []
    // Basis zuerst, Overlays danach (Reihenfolge der Keys in ADAPTERS); jede Quelle für sich atomar.
    for (const [name, mod] of Object.entries(adapters)) {
      holdLease(db, lease) // Heartbeat vor jedem (langen) Abruf
      const now = new Date().toISOString()
      try {
        // Adapter liefern Zeilen oder { rows, coverage }; coverage = vollständig gemeldeter Scope { cinemas, from, to }.
        const res = await mod.fetchShows(ctx)
        // capturedAt: Zeitpunkt, zu dem die Quelle die Daten geliefert hat (z. B. Alter einer Inbox-Datei).
        const { rows: fetched, coverage = null, capturedAt = now } = Array.isArray(res) ? { rows: res } : res
        // Unaufgelöste Ortszeiten (DST-Lücke/-Doppelstunde, ungültige Daten) nicht raten, sondern verwerfen.
        const r = fetched.filter((x) => x.startsAt)
        if (r.length < fetched.length) log(`${name}: ${fetched.length - r.length} Vorstellungen ohne eindeutige Zeit verworfen`)
        if (r.length < minRows(mod)) throw new Error(`nur ${r.length} Vorstellungen (erwartet ≥ ${minRows(mod)})`)
        importSource(db, name, r, r.length < fetched.length ? null : coverage, now, capturedAt, lease)
        total += r.length
        ok.push(name)
        log(`${name}: ok ${r.length}${coverage ? ' (vollständig)' : ''}`)
      } catch (e) {
        if (e instanceof LeaseLost) throw e
        recordFailure(db, name, e.message, now)
        log(`${name}: FEHLER ${e.message}`)
      }
    }

    holdLease(db, lease)
    await tmdb.enrich(db, { fetch, log }).catch((e) => log(`tmdb: ${e.message}`))
    await letterboxd.syncRatings(db, { fetch, log }).catch((e) => log(`letterboxd: ${e.message}`))
    return { ok, rows: total }
  } catch (e) {
    if (!(e instanceof LeaseLost)) throw e
    log('sync: Lease verloren, Lauf abgebrochen (nichts weiter geschrieben)')
    return { leaseLost: true }
  } finally {
    db.prepare('UPDATE sync_lease SET expires_at = ? WHERE owner = ? AND token = ?').run(new Date().toISOString(), lease.owner, lease.token)
  }
}
