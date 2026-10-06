// K15: Abstimmungsstand je Option und nächster Schritt je Vorschlag. Schweigen ist weder Ja noch Verfügbarkeit;
// „alle haben geantwortet“ ist kein Konsens, wenn keine Option ohne Nein bleibt. Nichts davon bucht automatisch.
export function tally(option, participants) {
  const t = { yes: 0, maybe: 0, no: 0, open: 0 }
  for (const v of Object.values(option.votes)) t[v]++
  t.open = participants.filter((u) => !(u in option.votes)).length
  return t
}

const future = (o, now) => Date.parse(o.snapshot.starts_at) > now

export function nextStep(p, meId, now = Date.now()) {
  if (p.status === 'booked') {
    const b = p.options.find((o) => o.id === p.booked_option_id)
    return b && future(b, now) && !p.ticket_link ? { kind: 'ticket' } : null
  }
  if (p.status !== 'open') return null
  const live = p.options.filter((o) => future(o, now))
  if (!live.length) return null
  const missing = (p.participants ?? []).filter((u) => live.some((o) => !(u in o.votes)))
  if (missing.length) return { kind: missing.includes(meId) ? 'my_vote' : 'waiting', missing }
  const fits = live.filter((o) => Object.values(o.votes).includes('yes') && !Object.values(o.votes).includes('no'))
  return fits.length ? { kind: 'ready', fits } : { kind: 'no_fit' }
}
