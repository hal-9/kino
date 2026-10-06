export const euro = (n) => (n == null ? '' : n.toFixed(2).replace('.', ',') + ' €')
// Angebot ohne verwertbaren Preis (Mengenrabatt) → „Aktion“.
export const priceOrAktion = (o) => (o?.price == null ? 'Aktion' : euro(o.price))
export const fmtDate = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' }) : ''
