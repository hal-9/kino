import { describe, it, expect } from 'vitest'
import { versionFit } from './filters.js'

describe('K14 Fassungsfilter', () => {
  it('unbekannte Fassung erfüllt keine harte Bedingung (AC04)', () => {
    expect(versionFit(null, true)).toBe('unknown')
    expect(versionFit('DF', true)).toBe('out')
    expect(versionFit('OmU', true)).toBe('fit')
    expect(versionFit(null, false)).toBe('fit')
  })
})
