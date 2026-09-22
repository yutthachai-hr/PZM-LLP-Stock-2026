// Maintenance tools must not re-read the whole ledger to answer "did anything change".
//
//   npm test
//
// 22 Sep 2026: an audit session that ran "ตรวจความสอดคล้องของยอด" a handful of times and
// "ดาวน์โหลดไฟล์สำรอง" twice used a full day's Firestore read quota by itself — buildBackup
// read the movements collection three times (once explicitly before, once inside its own
// collection loop, once explicitly after) and recomputeLevels read it twice, purely to
// notice whether anything had changed while it worked. Both now ask that question with a
// couple of ranged queries instead of the whole collection — verified in isolation below,
// since simulating a real concurrent write inside a single-threaded await chain cannot be
// done deterministically (and never was: this refusal path had no test before either).

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw, memoryBackend } = await import('./helpers/memory-backend')
const { movementsChangedSince, recomputeLevels } = await import('../src/services/stock')
const { buildBackup } = await import('../src/services/backup')
const { setActiveBrand } = await import('../src/brand/brand')

const ACTOR = { id: 'uid-admin', name: 'Admin' }
const MAIN = 'loc-main'

function mv(id: string, over: Record<string, unknown> = {}) {
  return { id, docNo: 'RC-1', type: 'receive', productId: 'p1', productName: 'P', unit: 'EA', qty: 1, toLocationId: MAIN, date: 1, byUserId: 'x', byUserName: 'x', createdAt: 1, ...over }
}

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  seed('products', [{ id: 'p1', sku: 'S', name: 'P', category: 'c', unit: 'each', unitType: 'EA', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }])
  seed('locations', [{ id: MAIN, name: 'Main', type: 'warehouse', active: true, createdAt: 1 }])
})

describe('movementsChangedSince — the cheap stand-in for a second full read', () => {
  test('nothing filed or edited in the window reads as unchanged', async () => {
    seed('stockMovements', [mv('m1', { createdAt: 100 })])
    const db = memoryBackend.forBrand('pizza')
    expect(await movementsChangedSince(db, 200)).toBe(false)
  })

  test('a row filed inside the window is caught', async () => {
    seed('stockMovements', [mv('m1', { createdAt: 500 })])
    const db = memoryBackend.forBrand('pizza')
    expect(await movementsChangedSince(db, 200)).toBe(true)
  })

  test('a row only edited (not created) inside the window is caught too', async () => {
    seed('stockMovements', [mv('m1', { createdAt: 100, updatedAt: 500 })])
    const db = memoryBackend.forBrand('pizza')
    expect(await movementsChangedSince(db, 200)).toBe(true)
  })

  test('a row from before the window, untouched since, is not', async () => {
    seed('stockMovements', [mv('m1', { createdAt: 100, updatedAt: 150 })])
    const db = memoryBackend.forBrand('pizza')
    expect(await movementsChangedSince(db, 200)).toBe(false)
  })
})

describe('recomputeLevels — correct without the second full read', () => {
  test('rebuilds a drifted balance from the ledger, as before', async () => {
    seed('stockMovements', [mv('m1', { qty: 5 })])
    seed('stockLevels', [{ id: `${MAIN}__p1`, productId: 'p1', locationId: MAIN, qty: 999, updatedAt: 1, updatedBy: 'x' }])
    await recomputeLevels(ACTOR)
    expect((raw('stockLevels').find((l) => l.id === `${MAIN}__p1`) as { qty: number }).qty).toBe(5)
  })

  test('still refuses a ledger that adds up negative, touching nothing', async () => {
    seed('stockMovements', [mv('m1', { type: 'issue', docNo: 'IS-1', qty: 5, fromLocationId: MAIN, toLocationId: undefined })])
    seed('stockLevels', [{ id: `${MAIN}__p1`, productId: 'p1', locationId: MAIN, qty: 999, updatedAt: 1, updatedBy: 'x' }])
    await expect(recomputeLevels(ACTOR)).rejects.toThrow(/ติดลบ/)
    expect((raw('stockLevels').find((l) => l.id === `${MAIN}__p1`) as { qty: number }).qty).toBe(999)
  })
})

describe('buildBackup — the ledger read once, not three times', () => {
  test('the movements in the file and the drift figure come from the same read', async () => {
    seed('stockMovements', [mv('m1', { qty: 5 })])
    seed('stockLevels', [{ id: `${MAIN}__p1`, productId: 'p1', locationId: MAIN, qty: 5, updatedAt: 1, updatedBy: 'x' }])
    const b = await buildBackup('Owner')
    expect(b.data.stockMovements).toHaveLength(1)
    expect(b.integrity.drift).toBe(0)
    expect(b.integrity.consistent).toBe(true)
  })

  test('a drifted cached balance is still reported', async () => {
    seed('stockMovements', [mv('m1', { qty: 5 })])
    seed('stockLevels', [{ id: `${MAIN}__p1`, productId: 'p1', locationId: MAIN, qty: 999, updatedAt: 1, updatedBy: 'x' }])
    const b = await buildBackup('Owner')
    expect(b.integrity.drift).toBe(1)
  })
})
