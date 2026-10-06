import { describe, expect, it } from 'vitest'
import { nextStep, tally } from './decision.js'

const opt = (id, votes, starts_at = '2099-10-13T20:00:00+02:00') => ({ id, votes, snapshot: { starts_at } })
const open = (options, participants = [1, 2, 3, 4, 5]) => ({ status: 'open', participants, options, ticket_link: null })

describe('K15 Abstimmungsstand', () => {
  it('AC01: 3 Ja / 1 Vielleicht / 1 offen', () => {
    expect(tally(opt(1, { 1: 'yes', 2: 'yes', 3: 'yes', 4: 'maybe' }), [1, 2, 3, 4, 5])).toEqual({ yes: 3, maybe: 1, no: 0, open: 1 })
  })

  it('AC02: Schweigen wird nie Ja; fehlende Stimme hält „bereit“ zurück', () => {
    const p = open([opt(1, { 1: 'yes', 2: 'yes', 3: 'yes', 4: 'yes' })])
    expect(nextStep(p, 1)).toEqual({ kind: 'waiting', missing: [5] })
    expect(nextStep(p, 5).kind).toBe('my_vote')
  })

  it('AC05: alle geantwortet, aber jede Option mit Nein → keine passt; sonst bereit', () => {
    const all = (v) => Object.fromEntries([1, 2, 3].map((u, i) => [u, v[i]]))
    expect(nextStep(open([opt(1, all(['yes', 'no', 'yes'])), opt(2, all(['no', 'yes', 'yes']))], [1, 2, 3]), 1)).toEqual({ kind: 'no_fit' })
    const ready = nextStep(open([opt(1, all(['yes', 'no', 'yes'])), opt(2, all(['yes', 'maybe', 'yes']))], [1, 2, 3]), 1)
    expect(ready.kind).toBe('ready')
    expect(ready.fits.map((o) => o.id)).toEqual([2])
  })

  it('gebucht ohne Ticket-Link → nicht erfasst; vergangene Optionen zählen nicht', () => {
    expect(nextStep({ status: 'booked', booked_option_id: 1, ticket_link: null, options: [opt(1, {})] }, 1)).toEqual({ kind: 'ticket' })
    expect(nextStep({ status: 'booked', booked_option_id: 1, ticket_link: 'https://t.example', options: [opt(1, {})] }, 1)).toBeNull()
    expect(nextStep(open([opt(1, {}, '2000-01-01T20:00:00+01:00')]), 1)).toBeNull()
  })
})
