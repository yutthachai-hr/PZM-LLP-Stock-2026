// Owner decision 4 (9 Oct 2026): the R&D unit validator — a dry run that never guesses a unit
// and never writes. What each filled row would do, and what it refuses.
//
//   npm test
import { describe, expect, test } from 'vitest'
// @ts-expect-error — a plain .mjs script, no type declarations
import { ALLOWED_UNITS, catalogue, suggestions, validateRow } from '../scripts/rnd-units.mjs'

type Row = Record<string, string>
const cat = catalogue() as { sku: string }[]
const bySku = new Map(cat.map((p) => [p.sku, p]))
const v = (r: Row, seen = new Set<string>()) => validateRow(r, bySku, seen) as { status: string; issues: string[]; patch?: Record<string, unknown> }
const id = cat[0].sku

describe('R&D unit dry run', () => {
  test('the catalogue has 228 R&D products', () => expect(cat.length).toBe(228))
  test('blank stays MISSING_UNIT — nothing is filled in for the owner', () => {
    expect(v({ productId: id, SKU: id }).status).toBe('MISSING_UNIT')
  })
  test('one unit: the product becomes that unit, no conversion', () => {
    expect(v({ productId: id, SKU: id, proposedUnit: 'KG' })).toEqual({ status: 'OK', issues: [], patch: { unitType: 'KG', unit: 'KG' } })
  })
  test('bought in one unit, kept in another: the factor is required and becomes a conversion', () => {
    expect(v({ productId: id, proposedUnit: 'Pack', baseUnit: 'EA' }).status).toBe('ERROR_CONVERSION_FACTOR')
    expect(v({ productId: id, proposedUnit: 'Pack', baseUnit: 'EA', conversionFactor: '0' }).status).toBe('ERROR_CONVERSION_FACTOR')
    expect(v({ productId: id, proposedUnit: 'Pack', baseUnit: 'EA', conversionFactor: '12' }).patch).toEqual({ unitType: 'EA', unit: 'EA', unitConversions: [{ label: 'Pack', size: 12 }] })
  })
  test('refuses unknown products, a SKU that does not match, duplicates, units off the list', () => {
    expect(v({ productId: 'NOPE', proposedUnit: 'KG' }).status).toBe('ERROR_UNKNOWN_PRODUCT')
    expect(v({ productId: id, SKU: 'X-1', proposedUnit: 'KG' }).status).toBe('ERROR_SKU_MISMATCH')
    const seen = new Set<string>()
    v({ productId: id, proposedUnit: 'KG' }, seen)
    expect(v({ productId: id, proposedUnit: 'KG' }, seen).status).toBe('ERROR_DUPLICATE_ROW')
    expect(v({ productId: id, proposedUnit: 'x'.repeat(21) }).status).toBe('ERROR_UNIT_NOT_ALLOWED')
  })
  test('only the other brands\' units, with Carton instead of Bottle (owner, 9 Oct)', () => {
    expect(ALLOWED_UNITS).toEqual(['KG', 'EA', 'Pack', 'Carton'])
    for (const bad of ['Bottle', 'BOTTLE', 'Jar', 'L']) {
      const r = v({ productId: id, proposedUnit: bad })
      expect(r.status, bad).toBe('ERROR_UNIT_NOT_ALLOWED')
      expect(r.issues[0]).toContain(bad)
    }
    expect(v({ productId: id, proposedUnit: 'Carton', baseUnit: 'Bottle', conversionFactor: '12' }).status).toBe('ERROR_UNIT_NOT_ALLOWED')
    // Any spelling of an allowed unit is written the way the other brands write it.
    expect(v({ productId: id, proposedUnit: 'carton', baseUnit: 'ea', conversionFactor: '12' }).patch).toEqual({ unitType: 'EA', unit: 'EA', unitConversions: [{ label: 'Carton', size: 12 }] })
  })
  test('suggestions come only from the same product in Pizza Mania / Le Lapin, and are never applied', () => {
    const s = suggestions() as Map<string, { unit: string; from: string }>
    expect(s.size).toBeGreaterThan(0)
    expect(s.size).toBeLessThan(cat.length) // most R&D products have no counterpart: no suggestion
    for (const x of s.values()) {
      expect(ALLOWED_UNITS).toContain(x.unit)
      expect(x.from).toMatch(/^(Pizza Mania|Le Lapin) /)
    }
    const [sku, x] = [...s.entries()][0]
    // A row carrying only the suggestion is still missing its unit.
    expect(v({ productId: sku, suggestedUnit: x.unit } as Row).status).toBe('MISSING_UNIT')
  })
})
