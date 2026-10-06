import { berlinIso, versionFromLanguages } from 'shared'
import { getOk } from './util.js'

export const MIN_ROWS = 50
const BASE = 'https://backend.premiumkino.de/v1/de/zoopalast'
const HEADERS = { origin: 'https://zoopalast.premiumkino.de', referer: 'https://zoopalast.premiumkino.de/', accept: 'application/json' }

// → [{ id, name, seats }]
export async function fetchAuditoriums(ctx) {
  const cfg = await (await getOk(ctx, `${BASE}/config`, { headers: HEADERS })).json()
  return cfg.cinema.auditoriums.map((a) => ({ id: a.id, name: a.name, seats: a.seatTotal }))
}

export async function fetchShows(ctx) {
  const auds = new Map((await fetchAuditoriums(ctx)).map((a) => [a.id, a.name]))
  const prog = await (await getOk(ctx, `${BASE}/program`, { headers: HEADERS })).json()
  const movies = new Map(prog.movies.map((m) => [m.id, m]))
  const rows = prog.performances.map((p) => {
    const mv = movies.get(p.movieId)
    const lang = /Sprache:\s*([^,]+)(?:,\s*Untertitel:\s*(.+))?/.exec(p.language ?? '')
    return {
      cinemaKey: 'zoo-palast',
      cinemaName: 'Zoo Palast',
      startsAt: berlinIso(p.begin.slice(0, 10), p.begin.slice(11, 16)),
      title: mv?.name ?? p.title,
      year: mv?.year ?? null,
      version: lang ? versionFromLanguages(lang[1].trim(), lang[2]?.trim()) : null,
      auditorium: auds.get(p.auditoriumId) ?? null,
      attrs: [],
      // Auslastung ist flüchtig: eigenes Feld statt Attribut; fehlende Angabe = unbekannt.
      capacity: p.workload == null ? null : p.workload >= 80 ? 'nearly_sold_out' : 'available',
      ticketUrl: `https://zoopalast.premiumkino.de/film/${p.slug}`,
      source: 'zoopalast',
      sourceId: p.id,
      runtime: mv?.minutes ?? null,
    }
  })
  // Das Programm-JSON listet alle kommenden Vorstellungen des Hauses: vollständig ab heute bis zum letzten gelisteten Tag.
  const days = rows.map((r) => r.startsAt?.slice(0, 10)).filter(Boolean).sort()
  return { rows, coverage: days.length ? { cinemas: ['zoo-palast'], from: ctx.today, to: days.at(-1) } : null }
}
