import { it, expect } from 'vitest'
import { parseOrderText } from './order.js'

it('liest Saal, Reihe und Sitze', () => {
  expect(parseOrderText('Saal 4\nReihe 9, Sitz 11\nReihe 9, Sitz 12')).toEqual({ auditorium: '4', row: '9', seats: '11, 12' })
})
it('leer → null', () => expect(parseOrderText('')).toEqual({ auditorium: null, row: null, seats: null }))
