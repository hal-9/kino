// K37: Kurze Evidenz-Notizen je Ticket (Completion-Template) aus docs/PROGRESS.json + git log erzeugen.
// [Local] node tools/evidence.mjs  → implementation-evidence/Kxx.md. Nur lesen/schreiben im Repo, kein Netz.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const progress = JSON.parse(fs.readFileSync(path.join(root, 'docs/PROGRESS.json'), 'utf8'))
const log = execFileSync('git', ['log', '--format=%H %P %s'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
const commitOf = (id) => {
  const line = log.find((l) => l.split(' ')[2] === `${id}:`)
  if (!line) return null
  const [sha, parent] = line.split(' ')
  return { sha: sha.slice(0, 7), parent: parent.slice(0, 7) }
}
const list = (xs) => (xs?.length ? xs.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n') : '- none recorded')
const obj = (o) => (o && typeof o === 'object' ? Object.entries(o).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n') : '- none recorded')

const STANDARD = ['status', 'date', 'scope', 'commands', 'modified', 'acceptance', 'migration_notes', 'gaps', 'deferred', 'not_run', 'next_ready', 'current_source_finding', 'reproduced']
const dir = path.join(root, 'implementation-evidence')
fs.mkdirSync(dir, { recursive: true })
const ids = Object.keys(progress).sort()
for (const id of ids) {
  const e = progress[id]
  const c = commitOf(id)
  const rev = c ? `${c.parent} → ${c.sha}` : e.checkout?.sha ? `${e.checkout.sha.slice(0, 7)} (baseline, no code change)` : 'no dedicated commit'
  const finding = e.current_source_finding ?? (e.reproduced ? JSON.stringify(e.reproduced) : null) ?? 'not separately recorded (new functionality or see scope)'
  const md = `# ${id} completion note

Generated from docs/PROGRESS.json by tools/evidence.mjs. Records only what PROGRESS.json states; not-run items stay not run.

Task/substep: ${id}${e.scope ? ` - ${e.scope}` : ''}
Status: ${e.status}
Actual checkout before/after: ${rev}
Current-source finding: ${finding}

## Changed paths and purpose
${list(e.modified)}

## Commands actually run
${obj(e.commands)}

## Acceptance criteria
${obj(e.acceptance)}

## Data/privacy/compatibility
${e.migration_notes ?? 'No migration notes recorded.'}

## Deployment/rollback
No production action taken by this task. ${id === 'K24' || id === 'K25' ? 'Deploy/rollback/backup scripts exercised only in isolated stub rehearsals (see acceptance).' : ''}

## Remaining gaps
${list([...(e.gaps ?? []), ...(e.not_run ?? []).map((n) => `not run: ${n}`), ...(e.deferred ?? []).map((d) => `deferred: ${typeof d === 'string' ? d : JSON.stringify(d)}`)])}

## Other recorded evidence
${obj(Object.fromEntries(Object.entries(e).filter(([k]) => !STANDARD.includes(k))))}

## Next dependency-ready task
${(e.next_ready ?? []).join(', ') || '-'}
`
  fs.writeFileSync(path.join(dir, `${id}.md`), md)
}
console.log(`${ids.length} notes in implementation-evidence/`)
