// Work-in-process items numbered for the catalogue (owner, 29 Sep 2026).
//
//   npm test

import { describe, expect, test } from 'vitest'
import { missingWip, WIP_ITEMS } from '../src/seed/wip'
import { wipCode } from '../src/lib/wipCode'
import { LLP_PRODUCTS, PZM_PRODUCTS } from '../src/seed/catalog.generated'

// The workbook importer's own test for an item code (lib/stockSheet).
const SKU_RE = /^[A-Z]{2,8}(?:-[A-Z0-9]{2,})+$/

describe('WIP catalogue', () => {
  const all = [...WIP_ITEMS.PZM, ...WIP_ITEMS.LLP]

  test('every code is a well-formed item code, and unique', () => {
    for (const i of all) expect(i.sku).toMatch(SKU_RE)
    expect(new Set(all.map((i) => i.sku)).size).toBe(all.length)
  })

  // "รันตามลำดับ" (owner, 30 Sep 2026): one running number per brand, no gaps, in file order.
  test('each brand numbered 1, 2, 3 … in its own series', () => {
    expect(WIP_ITEMS.PZM.map((i) => i.sku)).toEqual(WIP_ITEMS.PZM.map((_, n) => wipCode(n + 1, 'PZM')))
    expect(WIP_ITEMS.LLP.map((i) => i.sku)).toEqual(WIP_ITEMS.LLP.map((_, n) => wipCode(n + 1, 'LLP')))
  })

  test('PZM 1–20 keep the numbers the workbook gives them, cookies follow', () => {
    expect(WIP_ITEMS.PZM.find((i) => i.sku === 'WIP-007')?.name).toBe('House Italian')
    expect(WIP_ITEMS.PZM.find((i) => i.sku === 'WIP-018')?.name).toBe('Pizza Sauce truffes')
    expect(WIP_ITEMS.PZM.find((i) => i.sku === 'WIP-021')?.name).toBe('THE YUMMY')
  })

  test('no code collides with the company catalogue', () => {
    const taken = new Set([...PZM_PRODUCTS, ...LLP_PRODUCTS].map((p) => p.sku))
    expect(all.filter((i) => taken.has(i.sku))).toEqual([])
  })

  test('a dough ball knows its tray', () => {
    expect(WIP_ITEMS.PZM.find((i) => i.sku === 'WIP-001')?.unitConversions).toEqual([{ label: 'ถาด', size: 12 }])
  })

  test('only what a catalogue lacks is offered, matched by code', () => {
    const left = missingWip(WIP_ITEMS.LLP, [{ sku: 'wip-ll-001' }])
    expect(left.map((i) => i.sku)).not.toContain('WIP-LL-001')
    expect(left).toHaveLength(WIP_ITEMS.LLP.length - 1)
  })
})
