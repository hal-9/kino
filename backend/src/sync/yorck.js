import { berlinIso } from 'shared'
import { getOk, keyByAlias } from './util.js'

export const MIN_ROWS = 150

function versionFromFormats(formats) {
  const f = formats.map((x) => String(x))
  for (const v of ['OmeU', 'OmU', 'OV', 'DF']) if (f.includes(v)) return v
  return null
}

export async function fetchShows(ctx) {
  const html = await (await getOk(ctx, 'https://www.yorck.de/filme', { headers: { accept: 'text/html' } })).text()
  const m = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s.exec(html)
  if (!m) throw new Error('yorck: __NEXT_DATA__ fehlt')
  const props = JSON.parse(m[1]).props.pageProps
  const rows = []
  for (const film of [...(props.films ?? []), ...(props.specials ?? [])]) {
    const f = film.fields
    for (const s of f.sessions ?? []) {
      const sf = s.fields
      const cinemaName = sf.cinema?.fields?.name?.trim()
      if (!cinemaName || !sf.startTime) continue
      const formats = sf.formats ?? []
      const version = versionFromFormats(formats)
      rows.push({
        cinemaKey: keyByAlias(ctx, cinemaName),
        cinemaName,
        // Yorck schreibt im Sommer +01:00; nur die lokalen Anteile gelten.
        startsAt: berlinIso(sf.startTime.slice(0, 10), sf.startTime.slice(11, 16)),
        title: f.title,
        year: null,
        version,
        auditorium: null,
        attrs: formats.filter((x) => !['OmeU', 'OmU', 'OV', 'DF'].includes(x)),
        ticketUrl: `https://www.yorck.de/filme/${f.slug}`,
        source: 'yorck',
        sourceId: s.sys?.id ?? null,
        runtime: f.runtime || null,
      })
    }
  }
  return rows
}
