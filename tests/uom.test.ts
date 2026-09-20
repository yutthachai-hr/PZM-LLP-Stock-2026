// Units of measure: the rate a keyed quantity is converted at, and what is refused.
//
//   npm test
//
// The owner's rule of 20 Sep 2026: one balance per product per site, in the product's
// own unit; everything keyed in another unit is converted at a rate the owner set for
// that product, or one of the two standard measures (g→kg, ml→l). Nothing else is guessed.

import { describe, expect, test } from 'vitest'
import { describeQty, entryFor, factorOf, isLegacyUnitRow, resolveFactor, standardFactor, toBase } from '../src/lib/uom'

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
