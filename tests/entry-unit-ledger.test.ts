// What happens to the books when someone keys a unit other than the product's own.
//
//   npm test
//
// The owner's rule, stated twice and then in capitals: "ระบบต้องรับรู้แค่หน่วยที่ชั้นใส่เข้าไป
// เท่านั้น ห้ามแปลงค่าเองโดยเด็ดขาด." Before this, the unit box changed nothing that survived the
// save — the movement was always stamped with the product's own unit, so picking EA and
// picking KG produced identical rows.
//
// So a product now has one balance per unit anyone has keyed it in, and those balances are
// never added together. Ten Pack of prawns and two KG of prawns are two numbers sitting side
// by side until a person decides which is right and voids the other.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw } = await import('./helpers/memory-backend')
const { receiveStock, issueStock, adjustStock, voidMovement, parseLevelId, findLevelDrift } =
  await import('../src/services/stock')
const { setActiveBrand } = await import('../src/brand/brand')

const ACTOR = { id: 'uid-staff', name: 'Staff' }
const MAIN = 'loc-main'
const BRANCH = 'loc-branch'

function seedMasterData() {
  seed('products', [
    { id: 'p1', sku: 'A-1', name: 'Prawn', category: 'Seafood', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
  ])
  seed('locations', [
    { id: MAIN, name: 'Main Warehouse', type: 'warehouse', active: true, createdAt: 1 },
    { id: BRANCH, name: 'Sarasin Branch', type: 'branch', active: true, createdAt: 1 },
  ])
}

const line = (qty: number, entryUnit?: string) => ({
  productId: 'p1',
  productName: 'Prawn',
  unit: 'KG',
  ...(entryUnit ? { entryUnit } : {}),
  qty,
})

const levels = () => raw('stockLevels') as Record<string, unknown>[]
const levelFor = (locationId: string, unit?: string) =>
  levels().find((d) => d.id === `${locationId}__p1${unit ? `#${unit}` : ''}`)
const qtyFor = (locationId: string, unit?: string) => (levelFor(locationId, unit)?.qty as number) ?? 0
const movements = () => raw('stockMovements') as Record<string, unknown>[]

async function receive(qty: number, entryUnit?: string) {
  return receiveStock({
    toLocationId: MAIN,
    lines: [line(qty, entryUnit)],
    actor: ACTOR,
    date: Date.now(),
    note: 'IV-1',
  })
}

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  seedMasterData()
})

describe('the unit that was keyed is the unit that is recorded', () => {
  test("a line keyed in the product's own unit is filed exactly as it always was", async () => {
    await receive(2)
    const [m] = movements()
    expect(m.unit).toBe('KG')
    // Nothing new is written, so a row from before this feature and one from after match.
    expect(m.entryUnit).toBeUndefined()
    expect(levelFor(MAIN)?.unit).toBeUndefined()
    expect(qtyFor(MAIN)).toBe(2)
  })

  test('a line keyed in Pack says Pack on the movement', async () => {
    await receive(10, 'Pack')
    const [m] = movements()
    expect(m.entryUnit).toBe('Pack')
    // The product's own unit is still on the row, which is how a void finds its way back.
    expect(m.unit).toBe('KG')
  })

  test('ten Pack is ten, not ten times anything', async () => {
    await receive(10, 'Pack')
    expect(qtyFor(MAIN, 'Pack')).toBe(10)
  })
})

describe('balances are kept apart, never added across units', () => {
  test('the same product in two units is two balances', async () => {
    // The owner's example: one person keys 10 Pack, another keys 2 KG.
    await receive(10, 'Pack')
    await receive(2)
    expect(qtyFor(MAIN, 'Pack')).toBe(10)
    expect(qtyFor(MAIN)).toBe(2)
    expect(levels().filter((d) => d.productId === 'p1')).toHaveLength(2)
  })

  test("the product's own balance is untouched by a line keyed in another unit", async () => {
    await receive(2)
    await receive(10, 'Pack')
    expect(qtyFor(MAIN)).toBe(2)
  })

  test('issuing in a unit draws down that unit, and only that one', async () => {
    await receive(10, 'Pack')
    await receive(2)
    await issueStock({
      fromLocationId: MAIN,
      toLocationId: BRANCH,
      lines: [line(3, 'Pack')],
      actor: ACTOR,
      date: Date.now(),
    })
    expect(qtyFor(MAIN, 'Pack')).toBe(7)
    expect(qtyFor(BRANCH, 'Pack')).toBe(3)
    expect(qtyFor(MAIN)).toBe(2)
    expect(qtyFor(BRANCH)).toBe(0)
  })

  test('a unit with nothing in it cannot be issued from, even when another unit is full', async () => {
    await receive(100)
    await expect(
      issueStock({
        fromLocationId: MAIN,
        toLocationId: BRANCH,
        lines: [line(1, 'Pack')],
        actor: ACTOR,
        date: Date.now(),
      }),
    ).rejects.toThrow()
  })

  test('an adjustment lands on the unit it was keyed in', async () => {
    await receive(10, 'Pack')
    await adjustStock({
      productId: 'p1',
      productName: 'Prawn',
      unit: 'KG',
      entryUnit: 'Pack',
      locationId: MAIN,
      direction: 'out',
      qty: 4,
      reason: 'broken',
      date: Date.now(),
      actor: ACTOR,
    })
    expect(qtyFor(MAIN, 'Pack')).toBe(6)
    expect(qtyFor(MAIN)).toBe(0)
  })
})

describe('undoing a line finds the balance it actually touched', () => {
  test('voiding a Pack receipt takes it off the Pack balance', async () => {
    await receive(10, 'Pack')
    await receive(2)
    const packMovement = movements().find((m) => m.entryUnit === 'Pack')!
    await voidMovement(packMovement.id as string, ACTOR)
    expect(qtyFor(MAIN, 'Pack')).toBe(0)
    // This is the reconciliation the owner described: keep one, void the other.
    expect(qtyFor(MAIN)).toBe(2)
  })

  test('voiding leaves no drift between the ledger and the cached balances', async () => {
    await receive(10, 'Pack')
    await receive(2)
    const packMovement = movements().find((m) => m.entryUnit === 'Pack')!
    await voidMovement(packMovement.id as string, ACTOR)
    expect(await findLevelDrift()).toEqual([])
  })

  test('mixed units in the ledger agree with the cached balances', async () => {
    await receive(3, 'Carton')
    await receive(5, 'Pack')
    await receive(1)
    expect(await findLevelDrift()).toEqual([])
  })
})

describe('reading a balance key back', () => {
  test("the product's own balance keeps the key it has always had", () => {
    expect(parseLevelId('loc-main__p1')).toEqual({ locationId: 'loc-main', productId: 'p1' })
  })

  test('another unit sits behind a separator the product key never uses', () => {
    expect(parseLevelId('loc-main__p1#Pack')).toEqual({
      locationId: 'loc-main',
      productId: 'p1',
      unit: 'Pack',
    })
  })

  test('a product id containing the location separator still splits correctly', () => {
    expect(parseLevelId('loc__a__b#ลัง')).toEqual({
      locationId: 'loc',
      productId: 'a__b',
      unit: 'ลัง',
    })
  })
})
