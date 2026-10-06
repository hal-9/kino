import { describe, it, expect } from 'vitest'
import { addDays, berlinIso, berlinYmd, isValidYmd, normTitle, slugify, versionFromLanguages } from './normalize.js'

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

describe('Zeitumstellung (K02)', () => {
  it('nutzt den Offset der echten Ortszeit, nicht Mittag', () => {
    expect(berlinIso('2026-03-29', '01:30')).toBe('2026-03-29T01:30:00+01:00')
    expect(berlinIso('2026-03-29', '03:30')).toBe('2026-03-29T03:30:00+02:00')
    expect(berlinIso('2026-10-25', '01:30')).toBe('2026-10-25T01:30:00+02:00')
    expect(berlinIso('2026-10-25', '03:30')).toBe('2026-10-25T03:30:00+01:00')
  })
  it('Frühjahrslücke und doppelte Herbststunde sind ohne Provider-Offset unaufgelöst (null)', () => {
    expect(berlinIso('2026-03-29', '02:30')).toBeNull()
    expect(berlinIso('2026-10-25', '02:30')).toBeNull()
  })
  it('ungültige Eingaben → null', () => {
    expect(berlinIso('2026-02-30', '20:00')).toBeNull()
    expect(berlinIso('2026-10-13', '24:00')).toBeNull()
    expect(berlinIso('2026-10-13', undefined)).toBeNull()
  })
})

describe('isValidYmd / berlinYmd / addDays', () => {
  it.each([['2026-02-30', false], ['2026-02-29', false], ['2028-02-29', true], ['2026-13-01', false], ['2026-1-01', false], ['2026-10-06', true]])(
    '%s → %s', (s, ok) => expect(isValidYmd(s)).toBe(ok))
  it('Berliner Kalenderdatum unabhängig von UTC', () => {
    expect(berlinYmd(new Date('2026-10-06T22:30:00Z'))).toBe('2026-10-07')
    expect(berlinYmd(new Date('2026-10-06T21:30:00Z'))).toBe('2026-10-06')
  })
  it('addDays über Monats- und DST-Grenzen', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
  })
})
