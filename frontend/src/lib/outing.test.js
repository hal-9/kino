import { describe, expect, it } from 'vitest'
import { directionsUrl, endText, nextOuting } from './outing.js'

const opt = (id, starts_at, extra = {}) => ({ id, snapshot: { starts_at, cinema_name: 'Delphi LUX', runtime: 100, ...extra } })
const booked = (id, o, extra = {}) => ({ id, status: 'booked', booked_option_id: o.id, options: [o], created_at: '2020-01-01', ...extra })

describe('K17 nächster Kinoabend', () => {
  it('AC01: früheste zukünftige Buchung, egal wie alt; Vergangenes/Offenes zählt nicht', () => {
    const now = Date.parse('2099-10-01T00:00:00Z')
    const list = [
      booked(1, opt(11, '2099-10-20T20:00:00+02:00')),
      booked(2, opt(21, '2099-10-13T20:00:00+02:00')),
      booked(3, opt(31, '2099-09-01T20:00:00+02:00')),
      { id: 4, status: 'open', options: [opt(41, '2099-10-02T20:00:00+02:00')] },
    ]
    expect(nextOuting(list, now).p.id).toBe(2)
    expect(nextOuting([], now)).toBeNull()
  })

  it('AC02: unbekannte Laufzeit → ausdrückliche Schätzung', () => {
    expect(endText({ starts_at: '2099-10-13T20:00:00+02:00', runtime: 100 })).toBe('Ende ca. 22:00 (inkl. ~20 Min. Werbung)')
    expect(endText({ starts_at: '2099-10-13T20:00:00+02:00', runtime: null })).toBe('Ende ca. 22:20 (geschätzt: Laufzeit unbekannt, 120 Min. angenommen)')
  })

  it('Route-Link kodiert die Adresse', () => {
    expect(directionsUrl({ cinema_name: 'Kino & Café', street: 'Kantstraße 10', zip: '10623' }))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=Kino%20%26%20Caf%C3%A9%2C%20Kantstra%C3%9Fe%2010%2C%2010623%20Berlin')
  })
})
