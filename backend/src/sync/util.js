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

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const decodeEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
