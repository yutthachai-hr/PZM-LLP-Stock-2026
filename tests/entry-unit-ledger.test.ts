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
const {
  receiveStock,
  issueStock,
  adjustStock,
  changeProductUnit,
  editMovement,
  voidMovement,
  parseLevelId,
  findLevelDrift,
} = await import('../src/services/stock')
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

describe('correcting a row instead of cancelling it', () => {
  test('changing the unit moves the number to the other balance', async () => {
    // What people were doing instead: void the row, key the whole delivery again.
    await receive(10, 'Pack')
    const [m] = movements()
    await editMovement({
      movementId: m.id as string,
      patch: { entryUnit: 'Carton' },
      actor: ACTOR,
    })
    expect(qtyFor(MAIN, 'Pack')).toBe(0)
    expect(qtyFor(MAIN, 'Carton')).toBe(10)
    expect(movements()[0].entryUnit).toBe('Carton')
  })

  test("clearing the unit puts it back on the product's own balance", async () => {
    await receive(4, 'Pack')
    await editMovement({
      movementId: movements()[0].id as string,
      patch: { entryUnit: '' },
      actor: ACTOR,
    })
    expect(qtyFor(MAIN, 'Pack')).toBe(0)
    expect(qtyFor(MAIN)).toBe(4)
    expect(movements()[0].entryUnit).toBeUndefined()
  })

  test('moving a receipt to another branch takes the stock with it', async () => {
    await receive(6)
    await editMovement({
      movementId: movements()[0].id as string,
      patch: { toLocationId: BRANCH },
      actor: ACTOR,
    })
    expect(qtyFor(MAIN)).toBe(0)
    expect(qtyFor(BRANCH)).toBe(6)
  })

  test('the unit and the branch can move at once, with the quantity', async () => {
    await receive(10, 'Pack')
    await editMovement({
      movementId: movements()[0].id as string,
      patch: { entryUnit: 'Carton', toLocationId: BRANCH, qty: 3 },
      actor: ACTOR,
    })
    expect(qtyFor(MAIN, 'Pack')).toBe(0)
    expect(qtyFor(BRANCH, 'Carton')).toBe(3)
  })

  test('a correction that would take a balance below zero is refused', async () => {
    await receive(5)
    await issueStock({
      fromLocationId: MAIN,
      toLocationId: BRANCH,
      lines: [line(5)],
      actor: ACTOR,
      date: Date.now(),
    })
    // The goods have already gone on to the branch, so the receipt cannot shrink to 1.
    const receipt = movements().find((m) => m.type === 'receive')!
    await expect(
      editMovement({ movementId: receipt.id as string, patch: { qty: 1 }, actor: ACTOR }),
    ).rejects.toThrow()
    expect(qtyFor(MAIN)).toBe(0)
  })

  test('an edit leaves the cached balances agreeing with the ledger', async () => {
    await receive(10, 'Pack')
    await editMovement({
      movementId: movements()[0].id as string,
      patch: { entryUnit: 'Carton', toLocationId: BRANCH },
      actor: ACTOR,
    })
    expect(await findLevelDrift()).toEqual([])
  })

  test('a receipt cannot be turned into a transfer under the same document number', async () => {
    await receive(3)
    await expect(
      editMovement({
        movementId: movements()[0].id as string,
        patch: { fromLocationId: BRANCH },
        actor: ACTOR,
      }),
    ).rejects.toThrow()
  })
})

describe('who edited a row, all of them', () => {
  const OTHER = { id: 'uid-other', name: 'Somchai' }

  test('the first edit records who made it and what they changed', async () => {
    await receive(5)
    await editMovement({
      movementId: movements()[0].id as string,
      patch: { qty: 6 },
      actor: ACTOR,
    })
    const edits = movements()[0].edits as { by: string; byName: string; changed: string[] }[]
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({ by: ACTOR.id, byName: ACTOR.name, changed: ['จำนวน'] })
  })

  test('a second person appends — the first name is not overwritten', async () => {
    // updatedBy only ever holds the last editor, which is what a second edit would hide.
    await receive(5)
    const id = movements()[0].id as string
    await editMovement({ movementId: id, patch: { qty: 6 }, actor: ACTOR })
    await editMovement({ movementId: id, patch: { qty: 7 }, actor: OTHER })
    const m = movements()[0]
    const edits = m.edits as { byName: string }[]
    expect(edits.map((e) => e.byName)).toEqual([ACTOR.name, OTHER.name])
    expect(m.updatedByName).toBe(OTHER.name)
  })

  test('each entry names the fields that edit touched', async () => {
    await receive(5)
    const id = movements()[0].id as string
    await editMovement({
      movementId: id,
      patch: { entryUnit: 'Pack', toLocationId: BRANCH },
      actor: ACTOR,
    })
    const edits = movements()[0].edits as { changed: string[] }[]
    expect(edits[0].changed).toEqual(['หน่วย', 'คลังปลายทาง'])
  })

  test('a save that changes nothing leaves no entry', async () => {
    // Otherwise opening and closing the dialog would pad the history and hide real edits.
    await receive(5)
    const id = movements()[0].id as string
    await editMovement({ movementId: id, patch: { qty: 5 }, actor: ACTOR })
    expect(movements()[0].edits).toBeUndefined()
  })

  test('a voided row cannot be edited at all', async () => {
    await receive(5)
    const id = movements()[0].id as string
    await voidMovement(id, ACTOR)
    await expect(
      editMovement({ movementId: id, patch: { qty: 9 }, actor: ACTOR }),
    ).rejects.toThrow()
  })
})

describe('hiding a product instead of deleting it', () => {
  // "ป้องกันการลบ แล้วต้องกลับมาใส่อีก" — a deleted product takes its history with it.
  const hidden = { ...{ id: 'p2', sku: 'A-2', name: 'Retired', category: 'Seafood', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, createdAt: 1, updatedAt: 1 }, active: false }
  const visible = { ...hidden, id: 'p3', sku: 'A-3', name: 'Current', active: true }
  const legacy = { ...hidden, id: 'p4', sku: 'A-4', name: 'Legacy' } as Record<string, unknown>
  delete legacy.active

  const offered = (list: { active?: boolean }[]) => list.filter((p) => p.active !== false)

  test('a hidden product is kept out of the pickers', () => {
    expect(offered([hidden, visible]).map((p) => (p as { id: string }).id)).toEqual(['p3'])
  })

  test('a product with no flag at all is treated as visible', () => {
    // Every product recorded before this feature has no `active` field.
    expect(offered([legacy as { active?: boolean }])).toHaveLength(1)
  })

  test('hiding keeps the balance and the history exactly where they were', async () => {
    await receive(8)
    const before = qtyFor(MAIN)
    seed('products', [
      { id: 'p1', sku: 'A-1', name: 'Prawn', category: 'Seafood', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: false, createdAt: 1, updatedAt: 1 },
    ])
    expect(qtyFor(MAIN)).toBe(before)
    expect(movements()).toHaveLength(1)
  })
})

describe('correcting a product whose unit was set up wrong', () => {  const products = () => raw('products') as Record<string, unknown>[]

  test('the unit can be changed even with stock and history on the product', async () => {
    // This used to be refused outright: "ปรับยอดเป็น 0 ก่อน หรือสร้างสินค้าใหม่".
    await receive(12)
    const touched = await changeProductUnit({
      productId: 'p1',
      unitType: 'EA',
      unit: 'Each',
      actor: ACTOR,
    })
    expect(touched).toBe(1)
    expect(products()[0]).toMatchObject({ unitType: 'EA', unit: 'Each' })
  })

  test('the quantity is untouched — only the label was wrong', async () => {
    await receive(12)
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    expect(qtyFor(MAIN)).toBe(12)
  })

  test('every past row is restamped, so the stock card reads in one unit', async () => {
    await receive(4)
    await receive(3)
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    expect(movements().map((m) => m.unit)).toEqual(['EA', 'EA'])
  })

  test('each restamped row says who changed it', async () => {
    // The owner asked for this by name: no change to a row without an account against it.
    await receive(4)
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    const edits = movements()[0].edits as { by: string; changed: string[] }[]
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({ by: ACTOR.id, changed: ['หน่วย'] })
  })

  test('a row keyed in the unit the product is becoming stops being a separate balance', async () => {
    // 10 "EA" of a KG product was its own balance. Once the product IS EA, it is just 10.
    await receive(10, 'EA')
    await receive(2)
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    expect(qtyFor(MAIN, 'EA')).toBe(0)
    expect(qtyFor(MAIN)).toBe(12)
    expect(movements().every((m) => m.entryUnit === undefined)).toBe(true)
  })

  test('a row keyed in some other unit stays its own balance', async () => {
    await receive(10, 'Pack')
    await receive(2)
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    expect(qtyFor(MAIN, 'Pack')).toBe(10)
    expect(qtyFor(MAIN)).toBe(2)
  })

  test('the books still agree with the ledger afterwards', async () => {
    await receive(10, 'EA')
    await receive(5, 'Pack')
    await receive(2)
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    expect(await findLevelDrift()).toEqual([])
  })

  test('running it twice changes nothing the second time', async () => {
    // A run that stops halfway has to be safe to repeat.
    await receive(4)
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    const again = await changeProductUnit({
      productId: 'p1',
      unitType: 'EA',
      unit: 'Each',
      actor: ACTOR,
    })
    expect(again).toBe(0)
    expect((movements()[0].edits as unknown[]).length).toBe(1)
    expect(qtyFor(MAIN)).toBe(4)
  })

  test('a product with no history at all still changes unit', async () => {
    const touched = await changeProductUnit({
      productId: 'p1',
      unitType: 'EA',
      unit: 'Each',
      actor: ACTOR,
    })
    expect(touched).toBe(0)
    expect(products()[0]).toMatchObject({ unitType: 'EA' })
  })

  test('an empty unit is refused rather than filed', async () => {
    await expect(
      changeProductUnit({ productId: 'p1', unitType: '  ', unit: '', actor: ACTOR }),
    ).rejects.toThrow()
  })
})
