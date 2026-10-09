// Plan B3 (6 Oct 2026): a product or location with stock history is switched off, never
// deleted — deleting one took its balances with it and stranded the stock.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const { deleteProduct } = await import('../src/services/products')
const { deleteLocation } = await import('../src/services/locations')
const { receiveStock } = await import('../src/services/stock')
const { setActiveBrand } = await import('../src/brand/brand')

const product = (id: string) => ({ id, sku: id, name: id.toUpperCase(), category: 'c', unit: 'KG', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 })

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
  seed('products', [product('used'), product('fresh')])
  seed('locations', [
    { id: 'wh', name: 'Main', type: 'warehouse', active: true, createdAt: 1 },
    { id: 'empty', name: 'Empty', type: 'branch', active: true, createdAt: 1 },
  ])
})

describe('deleting master data', () => {
  test('a product that has moved is refused, its balance untouched; one that never moved goes', async () => {
    await receiveStock({ lines: [{ productId: 'used', productName: 'USED', unit: 'KG', qty: 20 }], toLocationId: 'wh', date: Date.now(), actor: { id: 'u', name: 'U' } })
    await expect(deleteProduct('used')).rejects.toThrow(/ปิดใช้งานแทน/)
    expect(raw('products').map((p) => p.id).sort()).toEqual(['fresh', 'used'])
    expect(raw('stockLevels').find((l) => l.id === 'wh__used')?.qty).toBe(20)
    await deleteProduct('fresh')
    expect(raw('products').map((p) => p.id)).toEqual(['used'])
  })

  test('a location with history is refused; an unused one goes', async () => {
    await receiveStock({ lines: [{ productId: 'used', productName: 'USED', unit: 'KG', qty: 5 }], toLocationId: 'wh', date: Date.now(), actor: { id: 'u', name: 'U' } })
    await expect(deleteLocation('wh')).rejects.toThrow(/ปิดใช้งานแทน/)
    await deleteLocation('empty')
    expect(raw('locations').map((l) => l.id)).toEqual(['wh'])
  })
})
