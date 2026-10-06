import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import request from 'supertest'
import { setupTestApp, loginCookie, setNow } from './helpers.js'
import { runSync, acquireLease } from '../src/sync/index.js'
import * as uci from '../src/sync/uci.js'

// K06: Quellen unabhängig, Capture-Alter erhalten, nur ein Schreiber (Lease mit Fencing), Diagnose ohne Geheimnisse.
const here = path.dirname(fileURLToPath(import.meta.url))
const show = (title, sourceId, source = 'zoopalast') => ({
  cinemaKey: 'zoo-palast', cinemaName: 'Zoo Palast', title, startsAt: '2099-10-13T20:00:00+02:00', year: null, version: null,
  auditorium: null, attrs: [], ticketUrl: null, sourceId, runtime: null, source,
})
const opts = (adapters) => ({ adapters, log() {}, minRows: () => 1, fetch: async () => ({ status: 404 }) })
const titles = (db) => db.prepare('SELECT title FROM movies ORDER BY title').all().map((r) => r.title)

describe('Quellenbetrieb', () => {
  let app, db, users
  beforeEach(() => ({ app, db, users } = setupTestApp()))
  afterEach(() => {
    vi.useRealTimers()
    delete process.env.INBOX_DIR
  })

  it('AC01: ein fehlernder Provider blockiert den anderen nicht', async () => {
    await runSync(db, opts({ kinoheld: { fetchShows: async () => { throw new Error('boom') } }, zoopalast: { fetchShows: async () => [show('A', 'a')] } }))
    expect(titles(db)).toEqual(['A'])
    expect(db.prepare("SELECT last_error FROM source_health WHERE source = 'kinoheld'").get().last_error).toBe('boom')
  })

  it('AC02: Inbox-HTML behält sein ursprüngliches Capture-Alter', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'))
    fs.copyFileSync(path.join(here, 'fixtures', 'uci.html'), path.join(dir, 'uci.html'))
    const captured = new Date(Date.now() - 10 * 3600_000)
    captured.setMilliseconds(0)
    fs.utimesSync(path.join(dir, 'uci.html'), captured, captured)
    process.env.INBOX_DIR = dir
    const res = await uci.fetchShows({ fetch: async () => ({ status: 403 }), cinemas: new Map(), today: '2026-10-06', log() {} })
    expect(res.capturedAt).toBe(captured.toISOString())
    await runSync(db, opts({ uci }))
    expect(db.prepare("SELECT last_captured_at FROM source_health WHERE source = 'uci'").get().last_captured_at).toBe(captured.toISOString())
    expect(db.prepare("SELECT DISTINCT observed_at FROM screening_observations WHERE source = 'uci'").all()).toEqual([{ observed_at: captured.toISOString() }])
  })

  it('AC03: solange ein anderer Prozess die Lease hält, schreibt dieser Lauf nichts', async () => {
    const other = new Database(process.env.DATABASE_PATH)
    expect(acquireLease(other, 'other-process')).toBe(1)
    const res = await runSync(db, opts({ zoopalast: { fetchShows: async () => [show('A', 'a')] } }))
    expect(res).toEqual({ skipped: true })
    expect(titles(db)).toEqual([])
    other.close()
  })

  it('AC04: abgelaufene Lease eines abgestürzten Prozesses wird übernommen; wer die Lease verloren hat, committet nicht', async () => {
    setNow('2099-10-01T08:00:00Z')
    expect(acquireLease(db, 'crashed')).toBe(1)
    setNow('2099-10-01T08:16:00Z') // TTL 15 min abgelaufen
    expect(await runSync(db, opts({ zoopalast: { fetchShows: async () => [show('Nach Absturz', 'c')] } }))).toMatchObject({ ok: ['zoopalast'] })

    // A holt Daten (Netz, außerhalb jeder Transaktion) und verliert dabei die Lease an B.
    let release
    const gate = new Promise((r) => (release = r))
    const a = runSync(db, opts({ zoopalast: { fetchShows: async () => { await gate; return [show('Von A', 'a')] } } }))
    await new Promise((r) => setTimeout(r, 20))
    setNow('2099-10-01T08:40:00Z')
    const b = new Database(process.env.DATABASE_PATH)
    expect(await runSync(b, opts({ yorck: { fetchShows: async () => [show('Von B', 'b', 'yorck')] } }))).toMatchObject({ ok: ['yorck'] })
    release()
    expect(await a).toMatchObject({ leaseLost: true })
    expect(titles(db)).toEqual(['Nach Absturz', 'Von B'])
    expect(db.prepare('SELECT token FROM sync_lease').get().token).toBe(4) // crashed, Übernahme, A, B
    b.close()
  })

  it('AC05: Readiness und Quellen-Diagnose verraten keine Geheimnisse und keine privaten Daten', async () => {
    process.env.TMDB_API_KEY = 'tmdb-secret-123'
    try {
      const ready = await request(app).get('/api/readyz')
      expect(ready.status).toBe(200)
      expect(ready.body).toEqual({ ok: true, db: 'ok' })
      await runSync(db, opts({ zoopalast: { fetchShows: async () => { throw new Error('HTTP 403 https://backend.premiumkino.de/v1/de/zoopalast/program') } } }))
      expect((await request(app).get('/api/sources')).status).toBe(401)
      const cookie = await loginCookie(app, users[0])
      const sources = (await request(app).get('/api/sources').set('Cookie', cookie)).body.sources
      const allowed = ['source', 'last_ok_at', 'last_count', 'last_error', 'last_error_at', 'last_attempt_at', 'last_captured_at', 'last_complete_import_at']
      for (const s of sources) expect(Object.keys(s).every((k) => allowed.includes(k))).toBe(true)
      const text = JSON.stringify([ready.body, sources])
      for (const secret of ['tmdb-secret-123', process.env.REGISTER_INVITE_CODE, process.env.DATABASE_PATH]) expect(text).not.toContain(secret)
    } finally {
      delete process.env.TMDB_API_KEY
    }
  })
})

describe('tools/inbox-sync.sh', () => {
  it('AC01: fällt UCI aus, wird berlin.de trotzdem atomar veröffentlicht (mtime erhalten), Exit ≠ 0', () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fakebin-'))
    const calls = path.join(bin, 'calls.log')
    const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${calls}"\n${body}\n`, { mode: 0o755 })
    stub('curl', `out=""; url=""; while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift;; http*) url=$1;; esac; shift; done
case "$url" in *uci*) exit 22;; esac
echo '<h2>Filme im Cineplex Alhambra</h2>' > "$out"`)
    stub('ssh', 'exit 0')
    stub('scp', 'exit 0')
    const script = path.join(here, '..', '..', 'tools', 'inbox-sync.sh')
    // Sicherung gegen echte Netz-/VPS-Zugriffe: Stubs müssen gewinnen (Skript darf PATH nicht ersetzen),
    // und ein leeres HOME ohne ~/.ssh/config macht den Host „vps“ unauflösbar.
    expect(fs.readFileSync(script, 'utf8')).not.toMatch(/export PATH="\/(?!.*\$PATH)/)
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'))
    const r = spawnSync('bash', [script], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home }, encoding: 'utf8', timeout: 10_000 })
    const log = fs.readFileSync(calls, 'utf8')
    expect(r.status).not.toBe(0)
    expect(log).toMatch(/scp -pq .*berlinde-alhambra\.html vps:\/opt\/kino\/data\/inbox\/\.berlinde-alhambra\.html\.tmp/)
    expect(log).toMatch(/ssh vps mv \/opt\/kino\/data\/inbox\/\.berlinde-alhambra\.html\.tmp \/opt\/kino\/data\/inbox\/berlinde-alhambra\.html/)
    expect(log).not.toMatch(/scp .*uci\.html/)
    expect(log).toMatch(/ssh vps .*src\/sync\/run\.js/)
    expect(execFileSync('bash', ['-n', script]).toString()).toBe('')
  })
})
