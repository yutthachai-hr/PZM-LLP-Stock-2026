// Units of measure: the rate a keyed quantity is converted at, and what is refused.
//
//   npm test
//
// The owner's rule of 20 Sep 2026: one balance per product per site, in the product's
// own unit; everything keyed in another unit is converted at a rate the owner set for
// that product, or one of the two standard measures (g→kg, ml→l). Nothing else is guessed.

import { describe, expect, test } from 'vitest'
import { breakdown, describeQty, entryFor, factorOf, isCountUnit, isLegacyUnitRow, resolveFactor, standardFactor, toBase } from '../src/lib/uom'
import { normaliseConversions } from '../src/lib/units'

describe('standard measures', () => {
  test('grams and millilitres, in either spelling, and nothing else', () => {
    expect(standardFactor('g', 'KG')).toBe(0.001)
    expect(standardFactor('กรัม', 'kg')).toBe(0.001)
    expect(standardFactor('KG', 'g')).toBe(1000)
    expect(standardFactor('ml', 'L')).toBe(0.001)
    expect(standardFactor('มล.', 'ลิตร')).toBe(0.001)
    expect(standardFactor('kg', 'l')).toBeNull() // different measures
    expect(standardFactor('oz', 'kg')).toBeNull() // the owner asked for none of these
    expect(standardFactor('Carton', 'EA')).toBeNull()
    expect(standardFactor('KG', 'kg')).toBe(1)
  })
})

describe('the rate for a product', () => {
  const ea = { name: 'Olives', unitType: 'EA', unitConversions: [{ label: 'Carton', size: 500 }] }
  const kg = { name: 'Flour', unitType: 'KG', unitConversions: [{ label: 'Bag', size: 25 }, { label: 'g', size: 0.002 }] }

  test('the base unit is 1; the product\'s own conversion is its size', () => {
    expect(resolveFactor(ea, undefined)).toBe(1)
    expect(resolveFactor(ea, 'ea')).toBe(1)
    expect(resolveFactor(ea, 'carton')).toBe(500)
    expect(resolveFactor(kg, 'Bag')).toBe(25)
  })

  test('a standard measure applies when the product has no rate of its own; the product wins when it has', () => {
    expect(resolveFactor({ unitType: 'KG' }, 'g')).toBe(0.001)
    expect(resolveFactor(kg, 'g')).toBe(0.002)
  })

  test('a unit nobody has stated a rate for is null, and filing it is refused by name', () => {
    expect(resolveFactor(ea, 'Pack')).toBeNull()
    expect(resolveFactor(ea, 'g')).toBeNull() // EA is not a mass
    expect(() => entryFor(ea, 3, 'Pack')).toThrow(/Pack/)
    expect(() => entryFor(ea, 3, 'Pack')).toThrow(/Olives/)
  })

  test('an entry carries both numbers and the rate', () => {
    expect(entryFor(ea, 2, 'Carton')).toEqual({ qty: 1000, entryQty: 2, entryUnit: 'Carton', factor: 500 })
    expect(entryFor(ea, 7, 'EA')).toEqual({ qty: 7, entryQty: 7, factor: 1 })
    expect(entryFor({ unitType: 'KG' }, 500, 'g')).toEqual({ qty: 0.5, entryQty: 500, entryUnit: 'g', factor: 0.001 })
    expect(toBase(1.5, 500)).toBe(750)
    expect(toBase(1, 0.0004)).toBe(0) // three decimals is the ledger's resolution
  })
})

describe('reading a filed row', () => {
  test('the rate is the row\'s own, whatever the product says now', () => {
    expect(factorOf({ qty: 1000, entryQty: 2 })).toBe(500)
    expect(factorOf({ qty: 7 })).toBe(1)
  })

  test('a legacy row is one keyed in another unit and never converted', () => {
    expect(isLegacyUnitRow({ entryUnit: 'Pack' })).toBe(true)
    expect(isLegacyUnitRow({ entryUnit: 'Pack', entryQty: 10 })).toBe(false)
    expect(isLegacyUnitRow({})).toBe(false)
    expect(isLegacyUnitRow({ entryUnit: ' ' })).toBe(false)
  })

  test('is described as people read it', () => {
    expect(describeQty({ qty: 500, unit: 'EA' })).toBe('500 EA')
    expect(describeQty({ qty: 1000, entryQty: 2, entryUnit: 'Carton', unit: 'EA' })).toBe('2 Carton (= 1000 EA)')
    expect(describeQty({ qty: 10, entryUnit: 'Pack', unit: 'EA' })).toBe('10 Pack')
    expect(describeQty({ qty: 0.5, entryQty: 500, entryUnit: 'g', unit: 'KG' }, (n) => n.toLocaleString('en-US'))).toBe('500 g (= 0.5 KG)')
  })
})

// The five units as the company uses them (owner, 20 Sep 2026): Carton → Pack → EA in a
// chain, a Carton stated in KG, a piece with a weight, pieces to the kilo, and Lot as the
// base unit of firewood alone.
describe('chained and fractional rates', () => {
  const pasta = { name: 'Box Pasta', unitType: 'EA', unitConversions: [{ label: 'Carton', size: 12, of: 'Pack' }, { label: 'Pack', size: 25 }] }
  const mozz = { name: 'Mozzarella', unitType: 'EA', unitConversions: [{ label: 'Carton', size: 8 }, { label: 'KG', size: 1, per: 2.72 }] }
  const sauce = { name: 'Sauce', unitType: 'KG', unitConversions: [{ label: 'EA', size: 1, per: 10 }, { label: 'Carton', size: 5 }] }

  test('a Carton stated in Pack resolves through the Pack to the base', () => {
    expect(resolveFactor(pasta, 'Pack')).toBe(25)
    expect(resolveFactor(pasta, 'Carton')).toBe(300)
    expect(entryFor(pasta, 2, 'Carton')).toEqual({ qty: 600, entryQty: 2, entryUnit: 'Carton', factor: 300 })
  })

  test('a piece with a weight: keying kilograms of an EA product converts to pieces', () => {
    expect(resolveFactor(mozz, 'KG')).toBeCloseTo(1 / 2.72, 6)
    expect(entryFor(mozz, 5.44, 'KG').qty).toBe(2)
    expect(entryFor(mozz, 1, 'KG').qty).toBe(0.368) // a fraction of a piece — the screen warns
    expect(entryFor(mozz, 1, 'Carton').qty).toBe(8)
  })

  test('pieces to the kilo: keying pieces of a KG product converts to kilograms', () => {
    expect(resolveFactor(sauce, 'EA')).toBe(0.1)
    expect(entryFor(sauce, 3, 'EA').qty).toBe(0.3)
    expect(entryFor(sauce, 1, 'Carton').qty).toBe(5)
    // grams still work on a KG product alongside its own rows
    expect(entryFor(sauce, 500, 'g').qty).toBe(0.5)
  })

  test('a broken chain is no rate: a missing link, a self-reference, a circle', () => {
    expect(resolveFactor({ unitType: 'EA', unitConversions: [{ label: 'Carton', size: 12, of: 'Pack' }] }, 'Carton')).toBeNull()
    expect(resolveFactor({ unitType: 'EA', unitConversions: [{ label: 'Carton', size: 12, of: 'Carton' }] }, 'Carton')).toBeNull()
    expect(resolveFactor({ unitType: 'EA', unitConversions: [{ label: 'A', size: 2, of: 'B' }, { label: 'B', size: 2, of: 'A' }] }, 'A')).toBeNull()
  })

  test('a base quantity reads back in the larger units, largest first', () => {
    expect(breakdown(320, pasta)).toBe('1 Carton 20 EA')
    expect(breakdown(675, pasta)).toBe('2 Carton 3 Pack')
    expect(breakdown(20, pasta)).toBe('') // nothing larger fits: the base figure already says it
    expect(breakdown(17, mozz)).toBe('2 Carton 1 EA') // the KG row (under one base unit) is not used
    expect(breakdown(0, pasta)).toBe('')
    expect(breakdown(5, { unitType: 'EA' })).toBe('')
  })

  test('count units are the ones a fraction is suspicious in', () => {
    expect(isCountUnit('EA')).toBe(true)
    expect(isCountUnit('Carton')).toBe(true)
    expect(isCountUnit('KG')).toBe(false)
    expect(isCountUnit('ml')).toBe(false)
  })
})

describe('tidying rows before they are stored', () => {
  test('keeps per and of, drops the base as a reference, drops dangling and circular rows', () => {
    const rows = normaliseConversions(
      [
        { label: 'Carton', size: 12, of: 'Pack' },
        { label: 'Pack', size: 25, of: 'EA' }, // "of the base" is the default, not stored
        { label: 'KG', size: 1, per: 2.72 },
        { label: 'Bag', size: 3, of: 'Sack' }, // Sack is defined nowhere
        { label: 'X', size: 2, of: 'Y' },
        { label: 'Y', size: 2, of: 'X' },
        { label: 'EA', size: 1 }, // the base itself
        { label: 'Zero', size: 1, per: 0 },
      ],
      'EA',
    )
    expect(rows).toEqual([
      { label: 'Carton', size: 12, of: 'Pack' },
      { label: 'Pack', size: 25 },
      { label: 'KG', size: 1, per: 2.72 },
    ])
  })
})
