// kinoheld-Bestelltext ("Saal 4, Reihe 9, Sitz 11 / Sitz 12") → Felder für den Besuch.
export function parseOrderText(text) {
  const t = String(text ?? '')
  const uniq = (xs) => [...new Set(xs)]
  const auditorium = /Saal\s*([^\n,]+)/.exec(t)?.[1].trim() ?? null
  const rows = uniq([...t.matchAll(/Reihe\s*(\w+)/g)].map((m) => m[1]))
  const seats = uniq([...t.matchAll(/Sitz\s*(\d+)/g)].map((m) => m[1]))
  return { auditorium, row: rows.join(', ') || null, seats: seats.join(', ') || null }
}
