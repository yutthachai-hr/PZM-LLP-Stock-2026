// The quantity box must never rewrite what is being typed (owner, 25 Sep 2026: typing 4 KG
// of a 2.72 KG mozzarella turned into 4.001, then 4000).
//
//   npm test

import { describe, expect, test } from 'vitest'
import { entryOf, showsValue } from '../src/lib/qtyEntry'

const kgOnEa = { key: 'kg', label: 'KG', records: 'KG', factor: 1 / 2.72 }

describe('showsValue', () => {
  test('what was just typed in another unit is left alone, even though the round trip is lossy', () => {
    for (const typed of ['4', '4.5', '0.3', '12', '2.72', '1', '7.25']) {
      const filed = entryOf(typed, kgOnEa as never, kgOnEa.factor)
      expect(showsValue(typed, kgOnEa.factor, filed.qty)).toBe(true)
    }
  })

  test('4 KG of a 2.72 KG piece files as 1.471 EA and the box keeps saying 4', () => {
    const filed = entryOf('4', kgOnEa as never, kgOnEa.factor)
    expect(filed).toMatchObject({ qty: 1.471, entryQty: 4, entryUnit: 'KG' })
    expect(showsValue('4', kgOnEa.factor, 1.471)).toBe(true)
  })

  test('a change from outside (a reset, another line) is still picked up', () => {
    expect(showsValue('4', kgOnEa.factor, 0)).toBe(false)
    expect(showsValue('', kgOnEa.factor, 0)).toBe(true)
    expect(showsValue('4', 1, 5)).toBe(false)
    expect(showsValue('5', 1, 5)).toBe(true)
  })
})
