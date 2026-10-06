import { addDays, berlinIso, berlinYmd } from './normalize.js'

// K14: Programm-Filter. Ergebnis je Vorstellung: 'fit' | 'out' | 'unknown' (unbekannt erfüllt nie eine harte Bedingung).
export const AD_MINUTES = 20 // Werbung/Trailer vor dem Film (wie Kalender/Besuche)
export const isHm = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s))
const NIGHT = 6 * 60 // Kinotag endet 06:00: 00:30 gilt als spät am Vortag, nicht als früh.
const minutes = (hm) => { const [h, m] = hm.split(':').map(Number); const t = h * 60 + m; return t < NIGHT ? t + 1440 : t }
const berlinHm = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' })

export const estimatedEnd = (startsAt, runtime) => (runtime ? Date.parse(startsAt) + (runtime + AD_MINUTES) * 60_000 : null)

export function timeFit(startsAt, runtime, { earliest, latestEnd } = {}) {
  const start = Date.parse(startsAt)
  const hm = berlinHm(start)
  if (earliest && minutes(hm) < minutes(earliest)) return 'out'
  if (!latestEnd) return 'fit'
  const end = estimatedEnd(startsAt, runtime)
  if (end == null) return 'unknown'
  // Grenze am Kinotag der Vorstellung; Grenze vor 06:00 liegt in der Nacht danach. Echte Instants (DST-fest).
  const day = minutes(hm) >= 1440 ? addDays(berlinYmd(new Date(start)), -1) : berlinYmd(new Date(start))
  const limitIso = berlinIso(minutes(latestEnd) >= 1440 ? addDays(day, 1) : day, latestEnd)
  if (!limitIso) return 'unknown' // Uhrzeit fällt in Zeitumstellung: nicht eindeutig
  return end <= Date.parse(limitIso) ? 'fit' : 'out'
}

const OV = ['OV', 'OmU', 'OmeU']
export const versionFit = (version, ov) => (!ov ? 'fit' : version == null ? 'unknown' : OV.includes(version) ? 'fit' : 'out')
