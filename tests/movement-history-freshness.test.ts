import { afterEach, expect, test, vi } from 'vitest'
vi.mock('../src/backend', async () => ({ backend: (await import('./helpers/memory-backend')).memoryBackend, BACKEND_MODE: 'local' }))
const { resetMemory, seed } = await import('./helpers/memory-backend')
const { setActiveBrand } = await import('../src/brand/brand')
let clear = () => {}
afterEach(() => { clear(); vi.restoreAllMocks() })

test('a backdated receipt created on another device is found by the next history refresh even without updatedAt', async () => {
  resetMemory(); setActiveBrand('lelapin')
  let now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  // The cache captures its clock at construction. Install the clock before importing it.
  const { movementCache } = await import('../src/data/movementCache')
  clear = () => movementCache.clear()
  movementCache.clear()
  expect(await movementCache.fetchRange(0, 100)).toEqual([])
  now += 61_000
  seed('lelapin__stockMovements', [{ id: 'new-backdated', productId: 'ham', date: 50, qty: 2, createdAt: now }])
  expect((await movementCache.fetchRange(0, 100)).map(r => r.id)).toEqual(['new-backdated'])
})
