import { describe, it, expect } from 'vitest'
import { canTransition, screeningRowProblems } from './contracts.js'

const ok = { cinemaKey: 'zoo-palast', title: 'Digger', startsAt: '2026-10-07T19:50:00+02:00', source: 'zoopalast', year: 2026, runtime: 124, version: 'OV', auditorium: 'Kino 1', ticketUrl: 'https://example.com/t' }

describe('Verträge (K26)', () => {
  it('gültige Zeile hat keine Probleme; Nullfelder erlaubt', () => {
    expect(screeningRowProblems(ok)).toEqual([])
    expect(screeningRowProblems({ ...ok, year: null, runtime: null, version: null, auditorium: null, ticketUrl: null })).toEqual([])
  })

  it('AC01: fehlerhafte Daten werden benannt', () => {
    expect(screeningRowProblems(null)).toEqual(['row'])
    expect(screeningRowProblems({ ...ok, startsAt: '2026-10-07T19:50' })).toEqual(['startsAt']) // ohne Offset: nicht raten
    expect(screeningRowProblems({ ...ok, title: '  ', cinemaKey: '' })).toEqual(['cinemaKey', 'title'])
    expect(screeningRowProblems({ ...ok, ticketUrl: 'javascript:alert(1)', runtime: -5, year: 3000 })).toEqual(['year', 'runtime', 'ticketUrl'])
  })

  it('AC02: Übergänge ohne Server testbar', () => {
    expect(canTransition('book', 'open')).toBe(true)
    expect(canTransition('book', 'booked')).toBe(false)
    expect(canTransition('reopen', 'cancelled')).toBe(true)
    expect(canTransition('nope', 'open')).toBe(false)
  })
})
