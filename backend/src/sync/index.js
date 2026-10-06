import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normTitle, slugify } from 'shared'
import { createFetch } from './util.js'
import * as kinoheld from './kinoheld.js'
import * as yorck from './yorck.js'
import * as zoopalast from './zoopalast.js'
import * as uci from './uci.js'
import * as berlinde from './berlinde.js'

const CINEMAS_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'cinemas.json')
const ADAPTERS = { kinoheld, yorck, zoopalast, uci, berlinde }
let running = false

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

const minuteKey = (iso) => iso.slice(0, 16)
const samePrefix = (a, b) => {
  const n = Math.min(12, a.length, b.length)
  return n >= 4 && a.slice(0, n) === b.slice(0, n)
}

function mergeRows(db, rows) {
  const findMovieYear = db.prepare('SELECT id FROM movies WHERE norm_title = ? AND year = ?')
  const findMovieNull = db.prepare('SELECT id FROM movies WHERE norm_title = ? AND year IS NULL')
  const findMovieAny = db.prepare('SELECT id FROM movies WHERE norm_title = ? ORDER BY year IS NULL, id LIMIT 1')
  const setYear = db.prepare('UPDATE movies SET year = ? WHERE id = ?')
  const insMovie = db.prepare('INSERT INTO movies (title, norm_title, year, runtime) VALUES (?, ?, ?, ?)')
  const setRuntime = db.prepare('UPDATE movies SET runtime = ? WHERE id = ? AND runtime IS NULL')
  const hasCinema = db.prepare('SELECT 1 FROM cinemas WHERE key = ?')
  const insCinema = db.prepare('INSERT INTO cinemas (key, name) VALUES (?, ?)')
  const candidates = db.prepare(
    `SELECT s.*, m.norm_title FROM screenings s JOIN movies m ON m.id = s.movie_id
     WHERE s.cinema_key = ? AND s.starts_at LIKE ? || '%'`
  )
  const insShow = db.prepare(
    `INSERT INTO screenings (cinema_key, movie_id, starts_at, version, auditorium, attrs_json, ticket_url, source, source_id)
     VALUES (@cinemaKey, @movieId, @startsAt, @version, @auditorium, @attrs, @ticketUrl, @source, @sourceId)`
  )
  const updShow = db.prepare(
    `UPDATE screenings SET version = @version, auditorium = @auditorium, attrs_json = @attrs, ticket_url = @ticketUrl,
       last_seen_at = datetime('now') WHERE id = @id`
  )
  const movieCache = new Map()
  const overlayDays = new Map() // 'cinema|day' → Set belegter Screening-IDs

  function movieId(row) {
    const norm = normTitle(row.title)
    const ck = `${norm}|${row.year ?? ''}`
    if (movieCache.has(ck)) return movieCache.get(ck)
    let id
    if (row.year) {
      id = findMovieYear.get(norm, row.year)?.id
      if (!id && (id = findMovieNull.get(norm)?.id)) setYear.run(row.year, id)
    } else id = findMovieAny.get(norm)?.id
    if (!id) id = Number(insMovie.run(row.title, norm, row.year, row.runtime).lastInsertRowid)
    if (row.runtime) setRuntime.run(row.runtime, id)
    movieCache.set(ck, id)
    return id
  }

  db.transaction(() => {
    for (const row of rows) {
      if (!hasCinema.get(row.cinemaKey)) insCinema.run(row.cinemaKey, row.cinemaName)
      const id = movieId(row)
      const norm = normTitle(row.title)
      const old = candidates.all(row.cinemaKey, minuteKey(row.startsAt)).find((s) => s.movie_id === id || samePrefix(s.norm_title, norm))
      const claim = (sid) => {
        if (row.source === 'kinoheld') return
        const k = `${row.cinemaKey}|${row.startsAt.slice(0, 10)}`
        if (!overlayDays.has(k)) overlayDays.set(k, new Set())
        overlayDays.get(k).add(sid)
      }
      if (!old) {
        claim(Number(insShow.run({ ...row, movieId: id, attrs: JSON.stringify(row.attrs) }).lastInsertRowid))
        continue
      }
      claim(old.id)
      const base = row.source === 'kinoheld' // Basis überschreibt nie Overlay-Werte
      const pick = (o, n) => (base ? (o ?? n) : (n ?? o))
      const attrs = [...new Set([...JSON.parse(old.attrs_json), ...row.attrs])]
      updShow.run({
        id: old.id, version: pick(old.version, row.version), auditorium: pick(old.auditorium, row.auditorium),
        attrs: JSON.stringify(attrs), ticketUrl: pick(old.ticket_url, row.ticketUrl),
      })
    }
    // Overlay kennt den Tag vollständig: kinoheld-Zeilen ohne Partner sind Titel-Dubletten (z. B. dt./engl. Titel).
    const stale = db.prepare(
      `SELECT id FROM screenings WHERE source = 'kinoheld' AND cinema_key = ? AND substr(starts_at, 1, 10) = ?`
    )
    const unlink = db.prepare('UPDATE proposal_options SET screening_id = NULL WHERE screening_id = ?')
    const del = db.prepare('DELETE FROM screenings WHERE id = ?')
    for (const [k, keep] of overlayDays) {
      const [cinema, day] = k.split('|')
      for (const { id } of stale.all(cinema, day)) {
        if (keep.has(id)) continue
        unlink.run(id)
        del.run(id)
      }
    }
  })()
}

function setHealth(db, source, err, count) {
  db.prepare(
    `INSERT INTO source_health (source, last_ok_at, last_error, last_error_at, last_count) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (source) DO UPDATE SET last_ok_at = COALESCE(excluded.last_ok_at, last_ok_at),
       last_error = excluded.last_error, last_error_at = COALESCE(excluded.last_error_at, last_error_at),
       last_count = COALESCE(excluded.last_count, last_count)`
  ).run(source, err ? null : new Date().toISOString(), err ? String(err) : null, err ? new Date().toISOString() : null, err ? null : count)
}

export async function runSync(db, { fetch = createFetch(), log = console.log, adapters = ADAPTERS, today, minRows = (m) => m.MIN_ROWS } = {}) {
  if (running) return { skipped: true }
  running = true
  try {
    today ??= new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
    seedCinemas(db)
    const ctx = { fetch, log, today, cinemas: loadCinemas(db) }

    if (adapters.kinoheld?.fetchCinemas) {
      try {
        upsertKinoheldCinemas(db, await adapters.kinoheld.fetchCinemas(ctx))
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

    const rows = []
    const ok = []
    // Basis zuerst, Overlays danach (Reihenfolge der Keys in ADAPTERS).
    for (const [name, mod] of Object.entries(adapters)) {
      try {
        const r = await mod.fetchShows(ctx)
        if (r.length < minRows(mod)) throw new Error(`nur ${r.length} Vorstellungen (erwartet ≥ ${minRows(mod)})`)
        rows.push(...r)
        ok.push(name)
        setHealth(db, name, null, r.length)
        log(`${name}: ok ${r.length}`)
      } catch (e) {
        setHealth(db, name, e.message)
        log(`${name}: FEHLER ${e.message}`)
      }
    }

    mergeRows(db, rows)

    // Quelle erreichbar und listet die Vorstellung nicht mehr = abgesetzt.
    if (ok.length) {
      const marks = ok.map(() => '?').join(',')
      const gone = `source IN (${marks}) AND last_seen_at < datetime('now', '-36 hours') AND datetime(starts_at) > datetime('now')`
      db.transaction(() => {
        db.prepare(`UPDATE proposal_options SET screening_id = NULL WHERE screening_id IN (SELECT id FROM screenings WHERE ${gone})`).run(...ok)
        db.prepare(`DELETE FROM screenings WHERE ${gone}`).run(...ok)
      })()
    }
    return { ok, rows: rows.length }
  } finally {
    running = false
  }
}
