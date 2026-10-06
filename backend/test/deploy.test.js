import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach } from 'vitest'

// Proben deploy/deploy.sh + rollback.sh nur isoliert: git/docker sind Stubs, ssh/scp/curl/wget schlagen laut fehl,
// leeres HOME (kein ~/.ssh/config), KINO_ROOT = Temp-Verzeichnis, Timeout. Nichts davon erreicht den VPS.
const here = path.dirname(fileURLToPath(import.meta.url))
const deployDir = path.join(here, '..', '..', 'deploy')
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p))

let root, bin, calls, home
const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $* TAG=\${KINO_API_TAG:-}" >> "${calls}"\n${body}\n`, { mode: 0o755 })
const sql = (q) => execFileSync('sqlite3', [path.join(root, 'data', 'app.db'), q]).toString().trim()

function run(script, env = {}, args = []) {
  return spawnSync('bash', [path.join(deployDir, script), ...args], {
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, KINO_ROOT: root, HEALTH_TRIES: '2', HEALTH_SLEEP: '0', ...env },
    encoding: 'utf8', timeout: 20_000,
  })
}
const live = () => fs.readFileSync(path.join(root, 'deploy', 'frontend-dist', 'index.html'), 'utf8')
const running = () => fs.readFileSync(path.join(root, '.running'), 'utf8').trim()
const current = () => fs.readFileSync(path.join(root, 'deploy', 'releases', 'current'), 'utf8').trim()

beforeEach(() => {
  root = tmp('kino-root-')
  bin = tmp('fakebin-')
  home = tmp('home-')
  calls = path.join(bin, 'calls.log')
  fs.writeFileSync(calls, '')
  for (const d of ['backend/migrations', 'data', 'deploy', 'frontend']) fs.mkdirSync(path.join(root, d), { recursive: true })
  fs.writeFileSync(path.join(root, 'backend/migrations/001_init.sql'), 'CREATE TABLE x (id INTEGER);\n')
  sql("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY); INSERT INTO schema_migrations VALUES ('001_init.sql');")
  stub('git', 'case "$1" in rev-parse) echo "$FAKE_SHA";; esac')
  stub('docker', `case "$1" in
  run) rm -rf frontend/dist; [ -n "$FAKE_BUILD_FAIL" ] && exit 1
       mkdir -p frontend/dist/assets
       echo "<script type=module src=\\"/assets/app-$FAKE_SHA.js\\"></script>" > frontend/dist/index.html
       echo "js" > "frontend/dist/assets/app-$FAKE_SHA.js"; echo sw > frontend/dist/sw.js
       [ -n "$FAKE_MISSING_ASSET" ] && rm "frontend/dist/assets/app-$FAKE_SHA.js"; exit 0;;
  compose) case "$2" in
     build) exit 0;;
     up) echo "$KINO_API_TAG" > "$KINO_ROOT/.running";;
     exec) [ "$(cat "$KINO_ROOT/.running")" = "$FAKE_BAD_TAG" ] && { echo '{"ok":false}'; exit 1; }; echo '{"ok":true,"db":"ok"}';;
  esac;;
esac`)
  for (const n of ['ssh', 'scp', 'curl', 'wget']) stub(n, 'echo NETWORK >&2; exit 99')
})

const deploy = (sha, env = {}) => run('deploy.sh', { FAKE_SHA: sha, ...env })

describe('deploy/deploy.sh (K24, isoliert mit Stubs)', () => {
  it('AC02/AC03: Release aktiv, alte Chunks bleiben, Bind-Mount-Verzeichnis bleibt dasselbe; Backup vorher', () => {
    expect(deploy('a1').status).toBe(0)
    const dist = path.join(root, 'deploy', 'frontend-dist')
    const ino = fs.statSync(dist).ino
    expect(deploy('b2').status).toBe(0)
    expect(live()).toContain('/assets/app-b2.js')
    expect(fs.existsSync(path.join(dist, 'assets', 'app-a1.js'))).toBe(true)
    expect(fs.statSync(dist).ino).toBe(ino)
    expect(current()).toBe('b2')
    expect(fs.readdirSync(path.join(root, 'backups')).some((f) => f.endsWith('_pre-b2.db'))).toBe(true)
  })

  it('AC01: fehlgeschlagener Build oder unvollständiges Release lässt Live unverändert', () => {
    deploy('a1')
    for (const env of [{ FAKE_BUILD_FAIL: '1' }, { FAKE_MISSING_ASSET: '1' }]) {
      const r = deploy('c3', env)
      expect(r.status).not.toBe(0)
      expect(live()).toContain('app-a1.js')
      expect(running()).toBe('a1')
      expect(current()).toBe('a1')
    }
    expect(fs.readFileSync(calls, 'utf8')).not.toMatch(/docker compose up .*TAG=c3/)
  })

  it('AC01: fehlgeschlagene Readiness → automatischer Rollback auf vorige API, Frontend unverändert', () => {
    deploy('a1')
    const r = deploy('e5', { FAKE_BAD_TAG: 'e5' })
    expect(r.status).not.toBe(0)
    expect(running()).toBe('a1')
    expect(live()).toContain('app-a1.js')
    expect(current()).toBe('a1')
  })

  it('AC04: Rollback über eine "-- contract"-Migration bricht ab; additive Migration erlaubt', () => {
    deploy('a1')
    fs.writeFileSync(path.join(root, 'backend/migrations/002_add.sql'), 'ALTER TABLE x ADD COLUMN y TEXT;\n')
    sql("INSERT INTO schema_migrations VALUES ('002_add.sql')")
    deploy('b2')
    expect(run('rollback.sh', {}, ['a1']).status).toBe(0)
    expect(running()).toBe('a1')
    expect(current()).toBe('a1')
    deploy('b2')
    fs.writeFileSync(path.join(root, 'backend/migrations/003_drop.sql'), '-- contract: entfernt Spalte y\nALTER TABLE x DROP COLUMN y;\n')
    sql("INSERT INTO schema_migrations VALUES ('003_drop.sql')")
    deploy('c3')
    const r = run('rollback.sh', {}, ['b2'])
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/003_drop\.sql.*nicht rückwärtskompatibel/)
    expect(running()).toBe('c3')
    expect(live()).toContain('app-c3.js')
  })

  it('kein Netz, kein PATH-Überschreiben, Syntax ok', () => {
    deploy('a1')
    run('rollback.sh', {}, ['a1'])
    expect(fs.readFileSync(calls, 'utf8')).not.toMatch(/^(ssh|scp|curl|wget) /m)
    for (const f of ['deploy.sh', 'rollback.sh', 'lib.sh', 'backup.sh']) {
      const src = fs.readFileSync(path.join(deployDir, f), 'utf8')
      expect(src).not.toMatch(/export PATH=|\bssh\b|\bscp\b/)
      expect(execFileSync('bash', ['-n', path.join(deployDir, f)]).toString()).toBe('')
    }
  })
})

describe('deploy/compose.yml (K24-AC05, statisch)', () => {
  it('behält Nicht-root, read-only, no-new-privileges; kein privileged', () => {
    const c = fs.readFileSync(path.join(deployDir, 'compose.yml'), 'utf8')
    expect(c).toMatch(/user: "1000:1000"/)
    expect(c).toMatch(/read_only: true/)
    expect(c).toMatch(/no-new-privileges:true/)
    expect(c).toMatch(/image: kino-api:\$\{KINO_API_TAG:-latest\}/)
    expect(c).not.toMatch(/privileged|cap_add|network_mode: host/)
  })
})
