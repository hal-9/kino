import { describe, it, expect } from 'vitest'
import { localRange } from './planning.js'

describe('K27 localRange', () => {
  it('über Mitternacht, Sommer-/Winterzeit, Lücke und Doppelstunde', () => {
    expect(localRange('2026-07-10', '20:00', '23:00')).toEqual({ starts_at: '2026-07-10T18:00:00.000Z', ends_at: '2026-07-10T21:00:00.000Z' })
    expect(localRange('2026-07-10', '22:00', '01:00')).toEqual({ starts_at: '2026-07-10T20:00:00.000Z', ends_at: '2026-07-10T23:00:00.000Z' })
    // 28.→29.03.: 22:00 CET bis 04:00 CEST = 5 echte Stunden
    expect(localRange('2026-03-28', '22:00', '04:00')).toEqual({ starts_at: '2026-03-28T21:00:00.000Z', ends_at: '2026-03-29T02:00:00.000Z' })
    expect(localRange('2026-03-28', '22:00', '02:30')).toBeNull() // Frühjahrslücke
    expect(localRange('2026-10-24', '22:00', '02:30')).toBeNull() // Herbst-Doppelstunde
    expect(localRange('2026-10-24', '22:00', '22:00')).toBeNull()
    expect(localRange('2026-02-29', '18:00', '20:00')).toBeNull()
  })
})
