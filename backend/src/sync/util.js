import fs from 'node:fs'
import path from 'node:path'
import { slugify } from 'shared'

const UA = 'LiLief-Kino/1.0 (private use; tuncay)'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// fetch mit UA, 20-s-Timeout und 300 ms Pause vor jedem Request.
export function createFetch() {
  return async (url, opts = {}) => {
    await sleep(300)
    return fetch(url, { ...opts, headers: { 'user-agent': UA, ...opts.headers }, signal: AbortSignal.timeout(20_000) })
  }
}

export async function getOk(ctx, url, opts) {
  const res = await ctx.fetch(url, opts)
  if (res.status !== 200) throw new Error(`HTTP ${res.status} ${url}`)
  return res
}

// ctx.cinemas: Map key → { key, name, aliases: string[], kinoheld_id }
export function keyByAlias(ctx, name) {
  const n = String(name).trim()
  for (const c of ctx.cinemas.values()) if (c.aliases.includes(n) || c.name === n) return c.key
  return slugify(n)
}

export { addDays } from 'shared'

export const decodeEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")

// Seiten, die Rechenzentrums-IPs blocken (UCI, berlin.de), legt der Mac per tools/inbox-sync.sh
// in <data>/inbox ab. Frische Datei (< 36 h) hat Vorrang, sonst Live-Abruf.
export const inboxDir = () => process.env.INBOX_DIR || path.join(path.dirname(process.env.DATABASE_PATH || './data/app.db'), 'inbox')

export async function getHtml(ctx, url, inboxName) {
  const f = path.join(ctx.inboxDir ?? inboxDir(), inboxName)
  try {
    if (Date.now() - fs.statSync(f).mtimeMs < 36 * 3600_000) return fs.readFileSync(f, 'utf8')
  } catch {}
  return (await getOk(ctx, url, { headers: { accept: 'text/html' } })).text()
}
