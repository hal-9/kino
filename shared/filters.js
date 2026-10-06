// K14: Programm-Filter. Ergebnis je Vorstellung: 'fit' | 'out' | 'unknown' (unbekannt erfüllt nie eine harte Bedingung).
export const AD_MINUTES = 20 // Werbung/Trailer vor dem Film (wie Kalender/Besuche)

export const estimatedEnd = (startsAt, runtime) => (runtime ? Date.parse(startsAt) + (runtime + AD_MINUTES) * 60_000 : null)

const OV = ['OV', 'OmU', 'OmeU']
export const versionFit = (version, ov) => (!ov ? 'fit' : version == null ? 'unknown' : OV.includes(version) ? 'fit' : 'out')
