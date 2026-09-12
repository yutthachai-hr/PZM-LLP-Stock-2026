// Which units a quantity may be keyed in, and what actually reaches the ledger.
//
//   npm test
//
// Reported from the floor: creating a product lets you pick EA, but on the receiving
// screen an EA product had no unit control at all — subUnitsFor() only knew KG and L, and
// everything else fell back to plain text. The unit had not gone missing; there was simply
// never a control to show it.

import { describe, expect, test } from 'vitest'
import { entryUnitsFor, subUnitsFor } from '../src/components/QtyInput'

describe('the unit list is never empty', () => {
  test('a product with no sub-units still offers its own unit', () => {
    // This is the reported bug: EA produced an empty list, so the screen rendered text.
    expect(subUnitsFor('EA')).toEqual([])
    expect(entryUnitsFor('EA').map((u) => u.label)).toEqual(['EA'])
  })

  test('Pack and Lot behave the same as any other base unit', () => {
    expect(entryUnitsFor('Pack').map((u) => u.label)).toEqual(['Pack'])
    expect(entryUnitsFor('Lot').map((u) => u.label)).toEqual(['Lot'])
  })

  test('a product with no unit at all still renders something selectable', () => {
    expect(entryUnitsFor('').map((u) => u.label)).toEqual(['-'])
  })
})

describe('weight and volume keep their sub-units', () => {
  test('kilograms can be keyed in grams', () => {
    expect(entryUnitsFor('KG').map((u) => [u.label, u.factor])).toEqual([
      ['KG', 1],
      ['กรัม (g)', 0.001],
    ])
  })

  test('litres can be keyed in millilitres, however the unit is spelled', () => {
    for (const spelling of ['L', 'lt', 'Liter', 'ลิตร']) {
      expect(entryUnitsFor(spelling).map((u) => u.factor)).toEqual([1, 0.001])
    }
  })
})

describe('packs come from the product, not from a table', () => {
  test('a pack is offered with its own multiplier and name', () => {
    // "1 Pack" is 12 of one thing and 300 of another, so there is no universal factor —
    // it has to be the product's own.
    const units = entryUnitsFor('EA', 300, 'ลัง')
    expect(units.map((u) => [u.label, u.factor])).toEqual([
      ['EA', 1],
      ['ลัง (×300)', 300],
    ])
  })

  test('the pack name is free text, so Lot and Pack both work', () => {
    expect(entryUnitsFor('EA', 24, 'Lot')[1].label).toBe('Lot (×24)')
    expect(entryUnitsFor('EA', 6, 'Pack')[1].label).toBe('Pack (×6)')
  })

  test('an unnamed pack still says what it is', () => {
    expect(entryUnitsFor('EA', 12)[1].label).toBe('Pack (×12)')
  })

  test('a pack of one is not a unit', () => {
    // It would be a second entry for the same number — pick it and nothing changes, which
    // reads as the control being broken.
    expect(entryUnitsFor('EA', 1, 'Pack')).toHaveLength(1)
  })

  test('a missing or nonsense pack size is ignored rather than offered', () => {
    expect(entryUnitsFor('EA', 0, 'Pack')).toHaveLength(1)
    expect(entryUnitsFor('EA', -5, 'Pack')).toHaveLength(1)
    expect(entryUnitsFor('EA', undefined, 'Pack')).toHaveLength(1)
  })

  test('a pack sits alongside the sub-unit, not instead of it', () => {
    const units = entryUnitsFor('KG', 2, 'ถุง')
    expect(units.map((u) => u.factor)).toEqual([1, 2, 0.001])
  })

  test('the base unit is always first, so the default records what was typed', () => {
    for (const units of [entryUnitsFor('EA', 300, 'ลัง'), entryUnitsFor('KG', 2)]) {
      expect(units[0].factor).toBe(1)
    }
  })
})

describe('what reaches the ledger', () => {
  // QtyInput multiplies the typed number by the chosen factor and hands the parent base
  // units. The balance is one number per product per location, so a movement recorded in
  // "Lot" alongside one in "EA" would make that number unreadable.
  const keyed = (typed: number, factor: number) => Math.round(typed * factor * 1000) / 1000

  test('two cases of 300 become 600 pieces, not 2', () => {
    const pack = entryUnitsFor('EA', 300, 'ลัง')[1]
    expect(keyed(2, pack.factor)).toBe(600)
  })

  test('500 grams becomes half a kilogram', () => {
    const grams = entryUnitsFor('KG')[1]
    expect(keyed(500, grams.factor)).toBe(0.5)
  })

  test('a fractional pack still converts', () => {
    const pack = entryUnitsFor('EA', 24, 'Lot')[1]
    expect(keyed(0.5, pack.factor)).toBe(12)
  })
})
