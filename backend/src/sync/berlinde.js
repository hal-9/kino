import { berlinIso } from 'shared'
import { decodeEntities, getHtml } from './util.js'

export const MIN_ROWS = 20
const MARKER = /\((OmU|OV|OmeU)\)/i
const canon = (v) => ({ omu: 'OmU', ov: 'OV', omeu: 'OmeU' })[v.toLowerCase()]

export function parseBerlinde(html) {
  const start = html.indexOf('Filme im Cineplex Alhambra')
  if (start < 0) throw new Error('berlin.de: Alhambra-Block fehlt')
  const rows = []
  for (const li of html.slice(start).split(/<li>\s*<span class="js-accordion__heading"/).slice(1)) {
    const rawTitle = decodeEntities(/js-accordion__trigger">([^<]+)</.exec(li)?.[1] ?? '').trim()
    if (!rawTitle) continue
    const titleVersion = MARKER.exec(rawTitle)?.[1]
    const title = rawTitle.replace(MARKER, '').trim()
    for (const r of li.matchAll(/<td>[^<,]*,\s*(\d\d)\.(\d\d)\.(\d\d)<\/td>\s*<td>(\d\d:\d\d)(?:\s*\((OmU|OV|OmeU)\))?<\/td>/gi)) {
      const marker = r[5] ?? titleVersion
      rows.push({
        cinemaKey: 'cineplex-alhambra',
        cinemaName: 'Cineplex Alhambra',
        startsAt: berlinIso(`20${r[3]}-${r[2]}-${r[1]}`, r[4]),
        title,
        year: null,
        version: marker ? canon(marker) : 'DF', // berlin.de markiert nur Originalfassungen
        auditorium: null,
        attrs: [],
        ticketUrl: 'https://www.cineplex.de/berlin-alhambra/programm/',
        source: 'berlinde',
        sourceId: null,
        runtime: null,
      })
    }
  }
  return rows
}

export async function fetchShows(ctx) {
  const html = await getHtml(ctx, 'https://www.berlin.de/kino/_bin/kinodetail.php/34187/', 'berlinde-alhambra.html')
  return parseBerlinde(html)
}
