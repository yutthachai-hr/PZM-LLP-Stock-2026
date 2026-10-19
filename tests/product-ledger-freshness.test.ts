import { beforeEach, expect, test, vi } from 'vitest'
vi.mock('../src/backend', async () => ({ backend: (await import('./helpers/memory-backend')).memoryBackend, BACKEND_MODE: 'local' }))
const { resetMemory, seed, memoryBackend } = await import('./helpers/memory-backend')
const { readProductLedger } = await import('../src/services/stock')
const { setActiveBrand } = await import('../src/brand/brand')

beforeEach(() => { vi.restoreAllMocks(); resetMemory(); setActiveBrand('pizza') })

test('returning to the same product refreshes old receipts/edits/voids instead of a session Map', async () => {
  seed('stockMovements', [{ id: 'old', productId: 'ham-cache', qty: 10, date: 1 }])
  expect(await readProductLedger('ham-cache')).toMatchObject([{ qty: 10 }])
  await memoryBackend.forBrand('pizza').update('stockMovements', 'old', { qty: 12, voided: true, updatedAt: 2 })
  seed('stockMovements', [{ id: 'backdated', productId: 'ham-cache', qty: 3, date: 0 }])
  const rows = await readProductLedger('ham-cache')
  expect(rows).toHaveLength(2)
  expect(rows.find(r => r.id === 'old')).toMatchObject({ qty: 12, voided: true })
})

test('concurrent product reads cost one equality query, require server coverage and never read the whole collection', async () => {
  const db = memoryBackend.forBrand('pizza')
  vi.spyOn(memoryBackend, 'forBrand').mockReturnValue(db)
  const read = vi.spyOn(db, 'getBy')
  const all = vi.spyOn(db, 'getAll')
  await Promise.all([readProductLedger('ham-budget'), readProductLedger('ham-budget')])
  expect(read).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledWith('stockMovements', 'productId', 'ham-budget', { server: true, label: 'movements.product.complete' })
  expect(all).not.toHaveBeenCalled()
})

test('a rejected product read is not cached as empty and the next attempt retries', async () => {
  const db = memoryBackend.forBrand('pizza')
  vi.spyOn(memoryBackend, 'forBrand').mockReturnValue(db)
  const read = vi.spyOn(db, 'getBy').mockRejectedValueOnce(new Error('unavailable'))
  await expect(readProductLedger('ham-retry')).rejects.toThrow('unavailable')
  expect(await readProductLedger('ham-retry')).toEqual([])
  expect(read).toHaveBeenCalledTimes(2)
})

test('brand and product identity remain isolated', async () => {
  seed('stockMovements', [{ id: 'pizza', productId: 'ham-brand', qty: 1 }])
  await memoryBackend.forBrand('lelapin').set('stockMovements', 'll', { productId: 'ham-brand', qty: 2 })
  const pizza = readProductLedger('ham-brand')
  setActiveBrand('lelapin')
  const ll = readProductLedger('ham-brand')
  expect((await pizza).map(r => r.id)).toEqual(['pizza'])
  expect((await ll).map(r => r.id)).toEqual(['ll'])
})
