import { expect, test, vi } from 'vitest'
vi.mock('../src/backend', async () => ({ backend: (await import('./helpers/memory-backend')).memoryBackend, BACKEND_MODE: 'local' }))
const { setActiveBrand } = await import('../src/brand/brand')
const { seed, resetMemory, memoryBackend } = await import('./helpers/memory-backend')
const { readActivitySources } = await import('../src/services/historyActivity')

test('action history includes an old-business-date receipt filed in the requested action window', async () => {
  resetMemory(); setActiveBrand('lelapin')
  seed('lelapin__stockMovements', [{ id: 'old-business', date: 10, createdAt: 500, productId: 'ham' }])
  const rows = await readActivitySources(400, 600, 'lelapin')
  expect(rows.movements.map(m => m.id)).toEqual(['old-business'])
})

test('edits to old documents (even modified again after the window) are not lost to a look-back cap', async () => {
  resetMemory(); setActiveBrand('pizza')
  const start = 100 * 86_400_000
  seed('purchaseOrders', [{ id: 'old-order', createdAt: 1, orderedAt: 1, updatedAt: start + 900, history: [{ at: start + 500 }] }])
  const rows = await readActivitySources(start + 400, start + 600, 'pizza')
  expect(rows.orders.map(o => o.id)).toEqual(['old-order'])
})

test('a source read rejection propagates instead of publishing successful empty activity', async () => {
  const db = memoryBackend.forBrand('pizza')
  vi.spyOn(memoryBackend, 'forBrand').mockReturnValue(db)
  vi.spyOn(db, 'getRange').mockRejectedValueOnce(new Error('permission-denied'))
  await expect(readActivitySources(400, 600, 'pizza')).rejects.toThrow('permission-denied')
  vi.restoreAllMocks()
})
