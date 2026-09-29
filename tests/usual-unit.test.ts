// A new line starts in the unit the product is usually keyed in (owner, 29 Sep 2026).
//
//   npm test

import { describe, expect, test } from 'vitest'
import { unitUsage, usualUnit } from '../src/lib/usualUnit'
import type { StockMovement } from '../src/types'

const pepper = { id: 'pepper', unitType: 'EA', unitConversions: [{ label: 'Pack', size: 100 }] }

let n = 0
const mv = (p: Partial<StockMovement>): StockMovement =>
  ({
    id: `m${n++}`,
    docNo: `D${n}`,
    type: 'issue',
    productId: 'pepper',
    productName: 'Cayenne',
    unit: 'EA',
    qty: 100,
    date: 0,
    byUserId: 'u',
    byUserName: 'u',
    createdAt: 0,
    ...p,
  }) as StockMovement

const pack = { entryUnit: 'Pack', entryQty: 1 }

describe('usualUnit', () => {
  test('the unit keyed most often, per direction', () => {
    const usage = unitUsage([
      mv(pack),
      mv(pack),
      mv({}),
      mv({ type: 'receive' }),
      mv({ type: 'receive' }),
    ])
    expect(usualUnit(pepper, usage, 'out')).toBe('Pack')
    // Received in its own unit: no other unit to propose.
    expect(usualUnit(pepper, usage, 'in')).toBeUndefined()
  })

  test('no history that way: every direction counts', () => {
    const usage = unitUsage([mv(pack), mv({ type: 'consume', ...pack })])
    expect(usualUnit(pepper, usage, 'in')).toBe('Pack')
  })

  test('a tie keeps the product’s own unit', () => {
    const usage = unitUsage([mv(pack), mv({})])
    expect(usualUnit(pepper, usage, 'out')).toBeUndefined()
  })

  test('a unit without a rate is never proposed; legacy and voided rows are ignored', () => {
    const usage = unitUsage([
      mv({ entryUnit: 'Carton', entryQty: 1 }),
      mv({ entryUnit: 'Carton', entryQty: 1 }),
      mv({ entryUnit: 'Pack' }), // legacy: no entryQty
      mv({ ...pack, voided: true }),
    ])
    expect(usualUnit(pepper, usage, 'out')).toBeUndefined()
  })

  test('no history at all: undefined', () => {
    expect(usualUnit(pepper, unitUsage([]), 'out')).toBeUndefined()
  })

  test('lines per product are counted for ranking', () => {
    expect(unitUsage([mv({}), mv({}), mv({ productId: 'x' })]).lines.get('pepper')).toBe(2)
  })
})
