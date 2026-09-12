// Regression tests for the stock-engine findings in AUDIT_FOR_CLAUDE.md
// (F14, F17, F18, F19, F20, F21, F22).
//
//   npm test
//
// These call the services directly rather than driving the UI, because that is the gap the
// audit is about: LineBuilder happens to merge duplicate rows and the forms happen to
// reject blank quantities, but neither is where the invariant should live.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw, failWritesWhere } = await import('./helpers/memory-backend')
const {
  receiveStock,
  issueStock,
  consumeStock,
  adjustStock,
  setStockCount,
  voidMovement,
  findLevelDrift,
} = await import('../src/services/stock')
const { setActiveBrand } = await import('../src/brand/brand')

const ACTOR = { id: 'uid-staff', name: 'Staff' }
const MAIN = 'loc-main'
const BRANCH = 'loc-branch'

function line(productId: string, qty: number, name = 'Mozzarella') {
  return { productId, productName: name, unit: 'Kilogram', qty }
}

function seedMasterData() {
  seed('products', [
    { id: 'p1', sku: 'A-1', name: 'Mozzarella', category: 'Cheese', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'p2', sku: 'A-2', name: 'Feta', category: 'Cheese', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'p-gone', sku: 'A-3', name: 'Retired', category: 'Cheese', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: false, createdAt: 1, updatedAt: 1 },
  ])
  seed('locations', [
    { id: MAIN, name: 'Main Warehouse', type: 'warehouse', active: true, createdAt: 1 },
    { id: BRANCH, name: 'Sarasin Branch', type: 'branch', active: true, createdAt: 1 },
  ])
}

/** Balance of a product at a location, straight out of the store. */
function balance(locationId: string, productId: string, physical = 'stockLevels'): number {
  const doc = raw(physical).find((d) => d.id === `${locationId}__${productId}`)
  return (doc?.qty as number) ?? 0
}

/** What the ledger adds up to, which is the number that has to be believed. */
function ledgerTotal(locationId: string, productId: string, physical = 'stockMovements'): number {
  let sum = 0
  for (const m of raw(physical) as Record<string, unknown>[]) {
    if (m.voided) continue
    if (m.productId !== productId) continue
    if (m.fromLocationId === locationId) sum -= m.qty as number
    if (m.toLocationId === locationId) sum += m.qty as number
  }
  return Math.round(sum * 1000) / 1000
}

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  seedMasterData()
})

describe('F17 — the same product twice in one document', () => {
  test('receiving 2 then 3 of the same product adds 5, not 3', async () => {
    await receiveStock({
      lines: [line('p1', 2), line('p1', 3)],
      toLocationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
    })
    expect(balance(MAIN, 'p1')).toBe(5)
    expect(ledgerTotal(MAIN, 'p1')).toBe(5)
  })

  test('issuing 7 and 7 out of a balance of 10 is refused', async () => {
    await receiveStock({ lines: [line('p1', 10)], toLocationId: MAIN, date: Date.now(), actor: ACTOR })
    await expect(
      issueStock({
        lines: [line('p1', 7), line('p1', 7)],
        fromLocationId: MAIN,
        toLocationId: BRANCH,
        date: Date.now(),
        actor: ACTOR,
      }),
    ).rejects.toThrow()
    expect(balance(MAIN, 'p1')).toBe(10)
  })

  test('consuming more than the balance across duplicate lines is refused', async () => {
    await receiveStock({ lines: [line('p1', 10)], toLocationId: MAIN, date: Date.now(), actor: ACTOR })
    await expect(
      consumeStock({
        lines: [line('p1', 6), line('p1', 6)],
        fromLocationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
      }),
    ).rejects.toThrow()
    expect(balance(MAIN, 'p1')).toBe(10)
  })
})

describe('F18 — voiding something already used up', () => {
  test('a receipt whose goods were consumed cannot be voided away', async () => {
    const docNo = await receiveStock({
      lines: [line('p1', 10)],
      toLocationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
    })
    expect(docNo).toBeTruthy()
    await consumeStock({
      lines: [line('p1', 8)],
      fromLocationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
    })
    expect(balance(MAIN, 'p1')).toBe(2)

    const receipt = (raw('stockMovements') as Record<string, unknown>[]).find(
      (m) => m.type === 'receive',
    )!
    await expect(voidMovement(receipt.id as string, ACTOR)).rejects.toThrow()

    // Nothing moved, and the cache still agrees with the ledger.
    expect(balance(MAIN, 'p1')).toBe(2)
    expect(ledgerTotal(MAIN, 'p1')).toBe(2)
    expect(await findLevelDrift()).toEqual([])
  })

  test('voiding a receipt whose goods are untouched still works', async () => {
    await receiveStock({ lines: [line('p1', 10)], toLocationId: MAIN, date: Date.now(), actor: ACTOR })
    const receipt = (raw('stockMovements') as Record<string, unknown>[])[0]
    await voidMovement(receipt.id as string, ACTOR)
    expect(balance(MAIN, 'p1')).toBe(0)
    expect(await findLevelDrift()).toEqual([])
  })
})

describe('F19 — quantities that are not quantities', () => {
  const bad = [Number.POSITIVE_INFINITY, Number.NaN, -1, 0]

  test.each(bad)('receiving %p is refused', async (qty) => {
    await expect(
      receiveStock({ lines: [line('p1', qty)], toLocationId: MAIN, date: Date.now(), actor: ACTOR }),
    ).rejects.toThrow()
    expect(raw('stockMovements')).toHaveLength(0)
  })

  test('a stock count of NaN is refused', async () => {
    await expect(
      setStockCount({
        productId: 'p1',
        productName: 'Mozzarella',
        unit: 'Kilogram',
        locationId: MAIN,
        targetQty: Number.NaN,
        actor: ACTOR,
      }),
    ).rejects.toThrow()
    expect(raw('stockMovements')).toHaveLength(0)
  })

  test('a stock count of Infinity is refused', async () => {
    await expect(
      setStockCount({
        productId: 'p1',
        productName: 'Mozzarella',
        unit: 'Kilogram',
        locationId: MAIN,
        targetQty: Number.POSITIVE_INFINITY,
        actor: ACTOR,
      }),
    ).rejects.toThrow()
  })

  test('an adjustment in a direction that does not exist is refused', async () => {
    await expect(
      adjustStock({
        productId: 'p1',
        productName: 'Mozzarella',
        unit: 'Kilogram',
        locationId: MAIN,
        direction: 'sideways' as 'in',
        qty: 1,
        reason: 'lost',
        date: Date.now(),
        actor: ACTOR,
      }),
    ).rejects.toThrow()
  })

  test('a business date that is not a date is refused', async () => {
    await expect(
      receiveStock({ lines: [line('p1', 1)], toLocationId: MAIN, date: Number.NaN, actor: ACTOR }),
    ).rejects.toThrow()
  })
})

describe('F20 — the ledger and the balance round the same way', () => {
  test('a quantity below the stored precision is refused, not silently dropped', async () => {
    // The ledger used to keep 0.0004 while the balance rounded it to nothing, so receiving
    // it twice added 0.0008 of history and 0 of stock. One precision for both, and anything
    // the system cannot represent is refused where the person can still see the message.
    await expect(
      receiveStock({ lines: [line('p1', 0.0004)], toLocationId: MAIN, date: Date.now(), actor: ACTOR }),
    ).rejects.toThrow()
    expect(raw('stockMovements')).toHaveLength(0)
    expect(await findLevelDrift()).toEqual([])
  })

  test('three decimals survive a round trip', async () => {
    await receiveStock({ lines: [line('p1', 1.234)], toLocationId: MAIN, date: Date.now(), actor: ACTOR })
    expect(balance(MAIN, 'p1')).toBe(1.234)
    expect(await findLevelDrift()).toEqual([])
  })
})

describe('F21 — stock for things that exist', () => {
  test('receiving into a location that was deleted is refused', async () => {
    await expect(
      receiveStock({
        lines: [line('p1', 1)],
        toLocationId: 'loc-deleted',
        date: Date.now(),
        actor: ACTOR,
      }),
    ).rejects.toThrow()
    expect(raw('stockMovements')).toHaveLength(0)
  })

  test('receiving a product that was deleted is refused', async () => {
    await expect(
      receiveStock({ lines: [line('p-deleted', 1)], toLocationId: MAIN, date: Date.now(), actor: ACTOR }),
    ).rejects.toThrow()
  })

  test('receiving a product that was retired is refused', async () => {
    await expect(
      receiveStock({ lines: [line('p-gone', 1)], toLocationId: MAIN, date: Date.now(), actor: ACTOR }),
    ).rejects.toThrow()
  })
})

describe('F22 — a proof photo that fails to save', () => {
  test('the stock is not consumed when the photo cannot be written', async () => {
    await receiveStock({ lines: [line('p1', 10)], toLocationId: MAIN, date: Date.now(), actor: ACTOR })
    failWritesWhere((c) => c === 'movementImages')

    await expect(
      consumeStock({
        lines: [line('p1', 8)],
        fromLocationId: MAIN,
        date: Date.now(),
        actor: ACTOR,
        photoDataUrl: 'data:image/jpeg;base64,AAAA',
      }),
    ).rejects.toThrow()

    // The screen said it failed, so the warehouse must agree: pressing save again should
    // not be able to take the stock a second time.
    expect(balance(MAIN, 'p1')).toBe(10)
    expect(ledgerTotal(MAIN, 'p1')).toBe(10)
    expect(raw('stockMovements').filter((m) => m.type === 'consume')).toHaveLength(0)
  })
})

describe('F14 — switching brand while an operation is in flight', () => {
  test('a receipt lands entirely in the brand it started in', async () => {
    seed('lelapin__products', [
      { id: 'p1', sku: 'B-1', name: 'Baguette', category: 'Bread', unit: 'Each', unitType: 'EA', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
    ])
    seed('lelapin__locations', [
      { id: MAIN, name: 'Sukhumvit Warehouse', type: 'warehouse', active: true, createdAt: 1 },
    ])

    const pending = receiveStock({
      lines: [line('p1', 5)],
      toLocationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
    })
    // The user taps "switch brand" while the save is still going.
    setActiveBrand('lelapin')
    await pending

    // Pizza Mania started it, so Pizza Mania gets all of it — ledger and balance together.
    expect(balance(MAIN, 'p1', 'stockLevels')).toBe(5)
    expect(raw('stockMovements')).toHaveLength(1)
    expect(raw('lelapin__stockMovements')).toHaveLength(0)
    expect(raw('lelapin__stockLevels')).toHaveLength(0)
  })
})

describe('policy — the unit a product is measured in', () => {
  // This used to be refused outright once a product had stock or any history, on the grounds
  // that the old numbers would read wrong. The owner overruled it, and the reasoning did not
  // survive the per-unit balances anyway: a balance is keyed by the unit each movement
  // recorded, so renaming leaves one balance holding the same number. What was actually
  // wrong was the label, and a wrong label was wrong on every row it was printed on.
  const unitOf = (id: string) =>
    (raw('products').find((p) => p.id === id) as Record<string, unknown>).unitType

  test('a unit can be corrected while there is stock on hand', async () => {
    const { changeProductUnit } = await import('../src/services/stock')
    await receiveStock({
      lines: [line('p1', 5)],
      toLocationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
    })
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    expect(unitOf('p1')).toBe('EA')
    // The count was never in doubt; only what it was called.
    expect(balance(MAIN, 'p1')).toBe(5)
  })

  test('a unit can be corrected once the product has history', async () => {
    const { changeProductUnit } = await import('../src/services/stock')
    await receiveStock({ lines: [line('p1', 5)], toLocationId: MAIN, date: Date.now(), actor: ACTOR })
    await consumeStock({ lines: [line('p1', 5)], fromLocationId: MAIN, date: Date.now(), actor: ACTOR })
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    expect(unitOf('p1')).toBe('EA')
    expect(ledgerTotal(MAIN, 'p1')).toBe(0)
    expect(await findLevelDrift()).toEqual([])
  })

  test('a product nobody has used yet can still be corrected', async () => {
    const { updateProduct } = await import('../src/services/products')
    await expect(updateProduct('p2', { unitType: 'EA', unit: 'Each' })).resolves.toBeUndefined()
    expect(unitOf('p2')).toBe('EA')
  })

  test('renaming a product it has stock of is still fine', async () => {
    const { updateProduct } = await import('../src/services/products')
    await receiveStock({ lines: [line('p1', 5)], toLocationId: MAIN, date: Date.now(), actor: ACTOR })
    await expect(updateProduct('p1', { name: 'Mozzarella (new supplier)' })).resolves.toBeUndefined()
  })
})

describe('seeding never touches a warehouse that is already set up', () => {
  test('a brand whose locations were renamed does not get the defaults added back', async () => {
    const { ensureBrandLocations } = await import('../src/services/seed')
    resetMemory()
    // What the live database actually looks like: real locations, named in Thai, nothing
    // matching the English defaults the code ships with.
    seed('locations', [
      { id: 'l1', name: 'คลังหลัก', type: 'warehouse', active: true, createdAt: 1 },
      { id: 'l2', name: 'สาขาสารสิน', type: 'branch', active: true, createdAt: 1 },
      { id: 'l3', name: 'สาขาอ่อนนุช', type: 'branch', active: true, createdAt: 1 },
    ])

    const created = await ensureBrandLocations('pizza')

    expect(created).toBe(0)
    expect(raw('locations')).toHaveLength(3)
    expect(raw('locations').map((l) => l.name)).not.toContain('Main Warehouse')
  })

  test('one renamed location does not bring the other defaults back either', async () => {
    const { ensureBrandLocations } = await import('../src/services/seed')
    resetMemory()
    seed('locations', [
      { id: 'l1', name: 'คลังกลาง', type: 'warehouse', active: true, createdAt: 1 },
    ])
    expect(await ensureBrandLocations('pizza')).toBe(0)
    expect(raw('locations')).toHaveLength(1)
  })

  test('a brand with nothing at all still gets its starting locations', async () => {
    const { ensureBrandLocations } = await import('../src/services/seed')
    resetMemory()
    expect(await ensureBrandLocations('pizza')).toBe(3)
    expect(raw('locations')).toHaveLength(3)
  })
})
