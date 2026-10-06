import { it, expect, describe } from 'vitest'
import { parseOrderText, parseTicketText, checkTicket } from './order.js'

it('liest Saal, Reihe und Sitze', () => {
  expect(parseOrderText('Saal 4\nReihe 9, Sitz 11\nReihe 9, Sitz 12')).toEqual({ auditorium: '4', row: '9', seats: '11, 12' })
})
it('leer → null', () => expect(parseOrderText('')).toEqual({ auditorium: null, row: null, seats: null }))

describe('parseTicketText (K31)', () => {
  const text = 'Deine Tickets für Digger\nZoo Palast, Saal 4\nMi, 07.10.2026 19:50 Uhr\nReihe 9, Sitz 11\nReihe 10, Sitz 3\nTickets: https://www.kinoheld.de/t/abc javascript:alert(1)'

  it('AC01: Felder mit Fundstelle, mehrere Plätze behalten ihre Reihe, nur http(s)-Links', () => {
    const p = parseTicketText(text)
    expect(p.date.value).toBe('2026-10-07')
    expect(text.slice(...p.date.at)).toBe('07.10.2026')
    expect(p.time.value).toBe('19:50')
    expect(p.auditorium.value).toBe('4')
    expect(p.seats.map(({ row, seat }) => [row, seat])).toEqual([['9', '11'], ['10', '3']])
    expect(p.links.map((l) => l.value)).toEqual(['https://www.kinoheld.de/t/abc'])
    expect(p.unresolved).toEqual([])
  })

  it('AC01: Teil-/unbekannter Text → offene Felder zum manuellen Ergänzen; ungültiges Datum nicht geraten', () => {
    expect(parseTicketText('Sitz 5').unresolved).toEqual(['date', 'time', 'auditorium'])
    expect(parseTicketText('Sitz 5').seats).toEqual([{ row: null, seat: '5', at: [0, 6] }])
    expect(parseTicketText('31.02.2026 20:00').date).toBeNull()
    expect(parseTicketText('hallo').unresolved).toEqual(['date', 'time', 'auditorium', 'seats'])
  })

  it('AC02: Abgleich mit der Buchung in Berliner Zeit; Film/Kino nur bei Nennung passend', () => {
    const snap = { starts_at: '2026-10-07T17:50:00Z', cinema_name: 'Zoo Palast', title: 'Digger' }
    expect(checkTicket({ date: '2026-10-07', time: '19:50' }, snap, text)).toEqual({ date: 'match', time: 'match', cinema: 'match', film: 'match' })
    expect(checkTicket({ date: '2026-10-08', time: null }, snap, 'Delphi')).toEqual({ date: 'conflict', time: 'unknown', cinema: 'unknown', film: 'unknown' })
  })
})
