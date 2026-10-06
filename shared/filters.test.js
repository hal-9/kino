import { describe, it, expect } from 'vitest'
import { timeFit, versionFit, isHm } from './filters.js'

describe('K14 Zeitfilter', () => {
  it('frühester Beginn; Vorstellung nach Mitternacht zählt als spät', () => {
    expect(timeFit('2026-10-13T17:30:00+02:00', 100, { earliest: '18:00' })).toBe('out')
    expect(timeFit('2026-10-13T18:00:00+02:00', 100, { earliest: '18:00' })).toBe('fit')
    expect(timeFit('2026-10-14T00:30:00+02:00', 100, { earliest: '18:00' })).toBe('fit')
  })

  it('spätestes Ende über Mitternacht (AC03)', () => {
    // 22:00 + 120 + 20 = 00:20 am Folgetag
    expect(timeFit('2026-10-13T22:00:00+02:00', 120, { latestEnd: '23:30' })).toBe('out')
    expect(timeFit('2026-10-13T22:00:00+02:00', 120, { latestEnd: '00:30' })).toBe('fit')
    expect(timeFit('2026-10-13T22:00:00+02:00', 120, { latestEnd: '00:15' })).toBe('out')
    // Spätvorstellung 00:30 gehört zum Kinotag davor: Ende 02:50 passt zu „bis 03:00“
    expect(timeFit('2026-10-14T00:30:00+02:00', 120, { latestEnd: '03:00' })).toBe('fit')
  })

  it('Zeitumstellung: Ende wird als echter Zeitpunkt gerechnet (AC03)', () => {
    // Herbst 2026-10-25: 00:00 MESZ + 210 min = 02:30 MEZ (Uhr zurückgestellt), Wanduhr-Rechnung ergäbe 03:30
    expect(timeFit('2026-10-25T00:00:00+02:00', 190, { latestEnd: '03:15' })).toBe('fit')
    // Grenze in der doppelten Stunde ist nicht eindeutig
    expect(timeFit('2026-10-25T00:00:00+02:00', 190, { latestEnd: '02:30' })).toBe('unknown')
    // Frühjahr 2027-03-28: 01:00 MEZ + 140 min = 04:20 MESZ
    expect(timeFit('2027-03-28T01:00:00+01:00', 120, { latestEnd: '04:00' })).toBe('out')
    expect(timeFit('2027-03-28T01:00:00+01:00', 120, { latestEnd: '04:30' })).toBe('fit')
  })

  it('unbekannte Laufzeit/Fassung erfüllen keine harte Bedingung (AC04)', () => {
    expect(timeFit('2026-10-13T20:00:00+02:00', null, { latestEnd: '23:00' })).toBe('unknown')
    expect(timeFit('2026-10-13T20:00:00+02:00', null, {})).toBe('fit')
    expect(versionFit(null, true)).toBe('unknown')
    expect(versionFit('DF', true)).toBe('out')
    expect(versionFit('OmU', true)).toBe('fit')
    expect(versionFit(null, false)).toBe('fit')
  })

  it('validiert Uhrzeiten', () => {
    expect(['18:00', '00:30', '23:59'].every(isHm)).toBe(true)
    expect(['24:00', '7:00', '18:60', 'x', ''].some(isHm)).toBe(false)
  })
})
