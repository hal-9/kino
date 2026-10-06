import { describe, it, expect } from 'vitest'
import { berlinIso, normTitle, slugify, versionFromLanguages } from './normalize.js'

describe('berlinIso', () => {
  it('Sommerzeit +02:00', () => expect(berlinIso('2026-10-13', '20:15')).toBe('2026-10-13T20:15:00+02:00'))
  it('Winterzeit +01:00', () => expect(berlinIso('2026-12-16', '17:15')).toBe('2026-12-16T17:15:00+01:00'))
  it('Umstellungstag 2026-10-25 ist schon Winterzeit', () => expect(berlinIso('2026-10-25', '20:00')).toBe('2026-10-25T20:00:00+01:00'))
})

describe('normTitle', () => {
  it('entfernt Versions- und Jahres-Marker, Umlaute', () => {
    expect(normTitle('Digger (2026)')).toBe('digger')
    expect(normTitle('Always Lalisa (OmU)')).toBe('always lalisa')
    expect(normTitle('Über Männer – OV')).toBe('ueber maenner')
  })
  it('slugify', () => expect(slugify('Kino International')).toBe('kino-international'))
})

describe('versionFromLanguages', () => {
  it.each([
    ['Englisch', null, 'OV'],
    ['Koreanisch', 'Englisch', 'OmeU'],
    ['Französisch', 'Deutsch', 'OmU'],
    ['Deutsch', null, 'DF'],
    [null, null, null],
  ])('%s / %s → %s', (a, s, v) => expect(versionFromLanguages(a, s)).toBe(v))
})
