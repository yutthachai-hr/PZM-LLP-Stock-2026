// Goods on the road are nobody's shelf (24 Sep 2026). The cron Worker hands every location
// to the low-stock check, the transit location included; an empty truck is not a shortage.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { shortages } from '../../src/lib/inventoryRules/lowStock'
import type { Product, StockLocation } from '../../src/types'

const p: Product = { id: 'p', sku: 'S', name: 'COKE', category: 'c', unit: 'EA', unitType: 'EA', minStock: 10, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }
const sites: StockLocation[] = [
  { id: 'main', name: 'คลังหลัก', type: 'warehouse', active: true, createdAt: 1 },
  { id: 'transit', name: 'ระหว่างขนส่ง', type: 'transit', active: true, createdAt: 1 },
]

describe('low stock and the transit location', () => {
  test('a real site below its minimum is short; transit never is', () => {
    const out = shortages({ products: [p], locations: sites, qtyAt: () => 0, minFor: () => 10, tracksProduct: () => true })
    expect(out.map((s) => s.location.id)).toEqual(['main'])
  })
})
