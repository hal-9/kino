import { berlinIso } from 'shared'
import { decodeEntities, getHtml } from './util.js'

export const MIN_ROWS = 50
const ATTRS = { isens: 'iSense', imax: 'IMAX', '3d': '3D', '4dx': '4DX', screenx: 'ScreenX' }

export function parseUci(html) {
  const titles = new Map()
  for (const m of html.matchAll(/\/film\/[^/"]+\/(\d+)\/[^"]*">([^<]+)</g)) titles.set(m[1], decodeEntities(m[2].trim()))
  const rows = []
  for (const m of html.matchAll(/<a href="([^"]+)"\s+class="badge badge-performance[^"]*"([^>]*)>/g)) {
    const attr = (n) => new RegExp(`${n}="([^"]*)"`).exec(m[2])?.[1]
    const date = attr('data-date')
    const title = titles.get(attr('data-tracking-film-id'))
    if (!date || !title) continue
    const tokens = (attr('data-version') ?? '').split('|')
    const version = tokens.includes('ov') ? 'OV' : tokens.includes('omeu') ? 'OmeU' : tokens.includes('omu') ? 'OmU' : 'DF'
    rows.push({
      cinemaKey: 'uci-mercedes-platz',
      cinemaName: 'UCI Luxe Mercedes Platz',
      startsAt: berlinIso(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, attr('data-time')),
      title,
      year: null,
      version,
      auditorium: attr('data-tracking-auditorium') ?? null,
      attrs: tokens.filter((t) => ATTRS[t]).map((t) => ATTRS[t]),
      ticketUrl: decodeEntities(m[1]),
      source: 'uci',
      sourceId: /perf_id=([^&]+)/.exec(m[1])?.[1] ?? null,
      runtime: null,
    })
  }
  return rows
}

export async function fetchShows(ctx) {
  const { html, capturedAt } = await getHtml(ctx, 'https://www.uci-kinowelt.de/kinoprogramm/berlin-mercedes-platz/82', 'uci.html')
  return { rows: parseUci(html), capturedAt }
}
