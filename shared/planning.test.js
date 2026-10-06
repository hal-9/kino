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

import { matchScreenings, personFit } from './planning.js'

describe('K28 matchScreenings', () => {
  // Freitag 9.10.2099, 20:00 Berlin (CEST) = 18:00Z
  const show = (id, extra = {}) => ({ id, movie_id: 7, cinema_key: 'zoo', starts_at: '2099-10-09T20:00:00+02:00', runtime: 100, version: 'OV', ...extra })
  const free = [{ kind: 'free', starts_at: '2099-10-09T16:00:00.000Z', ends_at: '2099-10-09T23:00:00.000Z' }]
  const a = { id: 1, prefs: {}, availability: free, interested: [7] }
  const b = { id: 2, prefs: {}, availability: free, interested: [] }

  it('AC01: ein hartes Nein schlägt beliebig viele Punkte', () => {
    const fans = [1, 3, 4, 5].map((id) => ({ id, prefs: { cinemas: { keys: ['zoo'], strength: 'soft' }, version: { value: 'ov', strength: 'soft' } }, availability: free, interested: [7] }))
    const veto = { id: 2, prefs: { version: { value: 'df', strength: 'hard' } }, availability: free, interested: [7] }
    const r = matchScreenings({ screenings: [show(1)], people: [...fans, veto] })
    expect(r.results).toEqual([])
    expect(r.excluded).toEqual({ version: 1 })
    // Gleiches Nein über Zeiten
    const busy = { ...b, availability: [{ kind: 'busy', starts_at: '2099-10-09T19:00:00.000Z', ends_at: '2099-10-09T20:00:00.000Z' }] }
    expect(matchScreenings({ screenings: [show(1)], people: [a, busy] }).excluded).toEqual({ availability: 1 })
    // 'max' zeigt sie ehrlich mit „passt nicht“, statt sie zu verschweigen
    const m = matchScreenings({ screenings: [show(1)], people: [a, busy], mode: 'max' })
    expect(m.results[0]).toMatchObject({ status: 'partial', known_fit: 1, people: [{ user_id: 1, fit: 'fit' }, { user_id: 2, fit: 'no', reasons: ['availability'] }] })
  })

  it('AC02: unbekannte Laufzeit/Fassung/Zeiten sind nie „passt“', () => {
    expect(personFit(a, show(1, { runtime: null }))).toEqual({ fit: 'unknown', reasons: ['runtime_unknown'] })
    expect(personFit({ ...a, prefs: { version: { value: 'ov', strength: 'hard' } } }, show(1, { version: null })).reasons).toEqual(['version_unknown'])
    expect(personFit({ id: 3, prefs: {} }, show(1))).toEqual({ fit: 'unknown', reasons: ['availability_unknown'] })
    // Spielfilm endet 21:40 + 20 min Werbung + 30 min Puffer = 22:30 > 22:00
    expect(personFit({ ...a, prefs: { latest_end: '22:00', buffer_minutes: 30 } }, show(1)).fit).toBe('no')
    expect(personFit({ ...a, prefs: { latest_end: '22:00' } }, show(1, { runtime: null })).reasons).toContain('runtime_unknown')
    const r = matchScreenings({ screenings: [show(1, { runtime: null })], people: [a, b] })
    expect(r.results[0].status).toBe('tentative')
  })

  it('AC03/AC04: Punkte mit Herkunft; stabile Reihenfolge, weniger als drei erlaubt', () => {
    const shows = [show(3, { cinema_key: 'other' }), show(2), show(1, { starts_at: '2099-10-09T19:00:00+02:00' })]
    const people = [{ ...a, prefs: { cinemas: { keys: ['zoo'], strength: 'soft' } } }, b]
    const r1 = matchScreenings({ screenings: shows, people })
    const r2 = matchScreenings({ screenings: [...shows].reverse(), people })
    expect(r1).toEqual(r2)
    expect(r1.results.map((x) => x.screening.id)).toEqual([1, 2, 3])
    expect(r1.results[0].parts).toEqual([{ code: 'interest', people: 1, points: 20 }, { code: 'cinema', people: 1, points: 5 }])
    expect(r1.results[2].score).toBe(20)
    expect(matchScreenings({ screenings: [show(1)], people }).results).toHaveLength(1)
    expect(matchScreenings({ screenings: [], people }).results).toEqual([])
  })
})
