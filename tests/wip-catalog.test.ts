// Work-in-process items numbered for the catalogue (owner, 29 Sep 2026).
//
//   npm test

import { describe, expect, test } from 'vitest'
import { missingWip, WIP_ITEMS } from '../src/seed/wip'
import { LLP_PRODUCTS, PZM_PRODUCTS } from '../src/seed/catalog.generated'

// The workbook importer's own test for an item code (lib/stockSheet).
const SKU_RE = /^[A-Z]{2,8}(?:-[A-Z0-9]{2,})+$/

describe('WIP catalogue', () => {
  const all = [...WIP_ITEMS.PZM, ...WIP_ITEMS.LLP]

  test('every code is a well-formed item code, and unique', () => {
    for (const i of all) expect(i.sku).toMatch(SKU_RE)
    expect(new Set(all.map((i) => i.sku)).size).toBe(all.length)
  })

  test('each brand in its own numbering: PZM WIP-01-…, LLP WIP-LL-01-…', () => {
    expect(WIP_ITEMS.PZM.every((i) => /^WIP-01-\d{2}-\d{3}$/.test(i.sku))).toBe(true)
    expect(WIP_ITEMS.LLP.every((i) => /^WIP-LL-01-\d{2}-\d{3}$/.test(i.sku))).toBe(true)
  })

  test('no code collides with the company catalogue', () => {
    const taken = new Set([...PZM_PRODUCTS, ...LLP_PRODUCTS].map((p) => p.sku))
    expect(all.filter((i) => taken.has(i.sku))).toEqual([])
  })

  test('a dough ball knows its tray', () => {
    expect(WIP_ITEMS.PZM.find((i) => i.sku === 'WIP-01-01-001')?.unitConversions).toEqual([{ label: 'ถาด', size: 12 }])
  })

  test('only what a catalogue lacks is offered, matched by code', () => {
    const left = missingWip(WIP_ITEMS.LLP, [{ sku: 'wip-ll-01-05-001' }])
    expect(left.map((i) => i.sku)).not.toContain('WIP-LL-01-05-001')
    expect(left).toHaveLength(WIP_ITEMS.LLP.length - 1)
  })
})
