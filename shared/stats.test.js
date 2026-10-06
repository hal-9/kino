import { describe, it, expect } from 'vitest'
import { aggregateVisits } from './stats.js'

const v = (id, user_id, event_key, extra = {}) => ({ id, user_id, event_key, movie_id: 1, runtime: 120, attendance: 'confirmed', ...extra })

describe('aggregateVisits (D08)', () => {
  it('AC01: fünf Personen bei einer 120-Minuten-Vorstellung', () => {
    const r = aggregateVisits([1, 2, 3, 4, 5].map((u) => v(u, u, 'screening:9')))
    expect(r).toMatchObject({ outings: 1, films: 1, person_visits: 5, person_hours: 10, unknown_runtime: 0 })
  })

  it('AC02: zweite Vorstellung desselben Films = neuer Abend, kein neuer Film; Duplikat derselben Person zählt einmal', () => {
    const r = aggregateVisits([v(1, 1, 'screening:9'), v(2, 1, 'screening:10'), v(3, 1, 'screening:10')])
    expect(r).toMatchObject({ outings: 2, films: 1, person_visits: 2 })
  })

  it('AC03: unbekannte Laufzeit nicht in der Summe, separat gezählt; ungruppiert einzeln', () => {
    const r = aggregateVisits([v(1, 1, null, { runtime: null }), v(2, 2, null), v(3, 1, null, { movie_id: null, attendance: 'inferred' })])
    expect(r).toMatchObject({ outings: 3, films: 1, person_visits: 3, minutes: 240, unknown_runtime: 1, ungrouped: 3, unconfirmed: 1 })
  })

  it('leer: alles 0', () => {
    expect(aggregateVisits([])).toEqual({ outings: 0, films: 0, person_visits: 0, minutes: 0, person_hours: 0, unknown_runtime: 0, unconfirmed: 0, ungrouped: 0 })
  })
})
