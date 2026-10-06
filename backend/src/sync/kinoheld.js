import { slugify, versionFromLanguages } from 'shared'
import { addDays, getOk } from './util.js'

export const MIN_ROWS = 300
const URL_ = 'https://next-live.kinoheld.de/graphql'
const HEADERS = { 'content-type': 'application/json', origin: 'https://www.kinoheld.de', accept: 'application/json' }
const DAYS = 14
const CHAINS = [['cinestar', 'cinestar'], ['cineplex', 'cineplex'], ['cinemaxx', 'cinemaxx'], ['uci', 'uci'], ['yorck', 'yorck']]

async function gql(ctx, query) {
  const res = await getOk(ctx, URL_, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query }) })
  const json = await res.json()
  if (json.errors?.length) throw new Error(`kinoheld: ${json.errors[0].message}`)
  return json.data
}

// complete = alle Seiten geholt (nicht an der Seitengrenze abgeschnitten).
async function paged(ctx, build) {
  const items = []
  for (let page = 1; page < 30; page++) {
    const { paginatorInfo, data } = Object.values(await gql(ctx, build(page)))[0]
    items.push(...data)
    if (!paginatorInfo.hasMorePages) return { items, complete: true }
  }
  return { items, complete: false }
}

function chainOf(name) {
  const n = name.toLowerCase()
  return CHAINS.find(([p]) => n.startsWith(p))?.[1] ?? null
}

export async function fetchCinemas(ctx) {
  const { items: list } = await paged(ctx, (page) => `{ cinemas(proximity:{city:"Berlin", distance:25}, first:100, page:${page}) {
    paginatorInfo { hasMorePages }
    data { id name urlSlug street postcode { postcode } city { name } latitude longitude } } }`)
  return list.map((c) => ({
    kinoheldId: Number(c.id), name: c.name, slug: c.urlSlug, street: c.street, zip: c.postcode?.postcode ?? null,
    lat: c.latitude, lng: c.longitude, chain: chainOf(c.name),
  }))
}

// Sälle eines Favoriten-Kinos: [{ name, seats }]
export async function fetchAuditoriums(ctx, kinoheldId) {
  const d = await gql(ctx, `{ cinema(id: ${kinoheldId}) { auditoriums(first: 30) { data { id name seatCount } } } }`)
  return (d.cinema?.auditoriums?.data ?? []).map((a) => ({ name: a.name, seats: a.seatCount }))
}

function versionFromFlags(flags, hasSubtitle) {
  for (const f of flags.filter((x) => x.category === 'LANGUAGE')) {
    if (f.name === 'OmeU') return 'OmeU'
    if (f.name === 'OmU') return 'OmU'
    if (f.name === 'subtitled OV') return hasSubtitle ? null : 'OmeU'
    if (f.name === 'OV' || f.name === 'en') return 'OV'
  }
  return null
}

export async function fetchShows(ctx) {
  const byId = new Map([...ctx.cinemas.values()].filter((c) => c.kinoheld_id).map((c) => [String(c.kinoheld_id), c]))
  const rows = []
  let complete = true
  for (let i = 0; i < DAYS; i++) {
    const date = addDays(ctx.today, i)
    const { items: shows, complete: dayComplete } = await paged(ctx, (page) => `{ programShows(cinemaProximity:{city:"Berlin", distance:25}, dates:["${date}"], first:100, page:${page}) {
      paginatorInfo { hasMorePages }
      data { id beginning isBookable auditorium { name seatCount } audioLanguage { name } subtitleLanguage { name }
             flags { category name } cinema { id name } movie { id title productionYear duration } } } }`)
    complete &&= dayComplete
    for (const s of shows) {
      const cin = byId.get(String(s.cinema.id))
      const version =
        versionFromLanguages(s.audioLanguage?.name, s.subtitleLanguage?.name) ?? versionFromFlags(s.flags, Boolean(s.subtitleLanguage))
      rows.push({
        cinemaKey: cin?.key ?? slugify(s.cinema.name),
        cinemaName: s.cinema.name,
        startsAt: s.beginning,
        title: s.movie.title,
        year: Number(s.movie.productionYear) || null,
        version,
        // Platzhalter-Säle ("Saal 1" ohne Plätze) bei Nicht-Partnerkinos verwerfen.
        auditorium: s.auditorium?.seatCount != null ? s.auditorium.name : null,
        attrs: s.flags.filter((f) => f.category === 'TECHNOLOGY' || f.category === 'EVENT').map((f) => f.name),
        ticketUrl: s.isBookable && cin?.kinoheld_slug ? `https://www.kinoheld.de/kino/berlin/${cin.kinoheld_slug}/vorstellung/${s.id}` : null,
        source: 'kinoheld',
        sourceId: String(s.id),
        runtime: s.movie.duration || null,
      })
    }
  }
  // Vollständig nur für die angefragten Tage und Kinos mit bekannter kinoheld-ID, und nur ohne abgeschnittene Seiten.
  const coverage = complete ? { cinemas: [...byId.values()].map((c) => c.key), from: ctx.today, to: addDays(ctx.today, DAYS - 1) } : null
  return { rows, coverage }
}
