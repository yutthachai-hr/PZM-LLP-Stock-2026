// What happens to the books when someone keys a unit other than the product's own.
//
//   npm test
//
// History of the rule, because the tests below only make sense against it:
//
//  13 Sep 2026 — "ระบบต้องรับรู้แค่หน่วยที่ชั้นใส่เข้าไปเท่านั้น ห้ามแปลงค่าเองโดยเด็ดขาด": a row keyed
//  as 10 Pack was filed as 10 Pack on its own Pack balance, never added to the KG one.
//
//  20 Sep 2026 — reversed. With 1,000 EA on hand and "1 Carton = 500 EA" set on the product,
//  issuing 1 Carton said "สต๊อกไม่พอ" and issuing 500 EA after receiving 1 Carton left two
//  numbers nobody could reconcile. The owner's rule now: ONE balance per product per site,
//  in the product's own unit; whatever is keyed is converted at the product's rate, and the
//  row keeps both numbers (entryQty as keyed, qty in the base unit). A unit with no rate is
//  refused, not guessed. Rows filed under the old rule ("legacy": entryUnit, no entryQty)
//  stay on their #Unit balance until the migration tool converts them.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw, memoryBackend } = await import('./helpers/memory-backend')
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
const { entryFor } = await import('../src/lib/uom')

const ACTOR = { id: 'uid-staff', name: 'Staff' }
const MAIN = 'loc-main'
const BRANCH = 'loc-branch'

function seedMasterData() {
  seed('products', [
    { id: 'p1', sku: 'A-1', name: 'Prawn', category: 'Seafood', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1,
      // The rates the owner stated for this product. Carton is 10 KG, Pack is 2 KG.
      unitConversions: [{ label: 'Carton', size: 10 }, { label: 'Pack', size: 2 }] },
  ])
  seed('locations', [
    { id: MAIN, name: 'Main Warehouse', type: 'warehouse', active: true, createdAt: 1 },
    { id: BRANCH, name: 'Sarasin Branch', type: 'branch', active: true, createdAt: 1 },
  ])
}

const PRODUCT = { name: 'Prawn', unitType: 'KG', unitConversions: [{ label: 'Carton', size: 10 }, { label: 'Pack', size: 2 }] }
/** A line as the screens build it: converted with the product's rate before it reaches the engine. */
const line = (entryQty: number, entryUnit?: string) => {
  const e = entryFor(PRODUCT, entryQty, entryUnit)
  return { productId: 'p1', productName: 'Prawn', unit: 'KG', ...(e.entryUnit ? { entryUnit: e.entryUnit, entryQty: e.entryQty } : {}), qty: e.qty }
}
/** A row exactly as the old rule filed it: keyed in Pack, never converted, on its own balance. */
function seedLegacy(qty: number, entryUnit: string, locationId = MAIN) {
  seed('stockMovements', [{ id: `legacy-${entryUnit}-${qty}`, docNo: 'RC-00000', type: 'receive', productId: 'p1', productName: 'Prawn', unit: 'KG', entryUnit, qty, toLocationId: locationId, date: 1, byUserId: 'old', byUserName: 'Old', createdAt: 1 }])
  seed('stockLevels', [{ id: `${locationId}__p1#${entryUnit}`, productId: 'p1', locationId, unit: entryUnit, qty, updatedAt: 1, updatedBy: 'old' }])
}

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

describe('what is keyed is converted; what is recorded is the product\'s own unit', () => {
  test("a line keyed in the product's own unit is filed exactly as it always was", async () => {
    await receive(2)
    const [m] = movements()
    expect(m.unit).toBe('KG')
    // Nothing new is written, so a row from before this feature and one from after match.
    expect(m.entryUnit).toBeUndefined()
    expect(m.entryQty).toBeUndefined()
    expect(levelFor(MAIN)?.unit).toBeUndefined()
    expect(qtyFor(MAIN)).toBe(2)
  })

  test('a line keyed in Carton keeps both numbers and lands on the one KG balance', async () => {
    await receive(3, 'Carton')
    const [m] = movements()
    expect(m).toMatchObject({ unit: 'KG', entryUnit: 'Carton', entryQty: 3, qty: 30 })
    expect(qtyFor(MAIN)).toBe(30)
    expect(levelFor(MAIN, 'Carton')).toBeUndefined()
  })

  test('the owner\'s case: receive by the Carton, issue by the KG, and back', async () => {
    await receive(1, 'Carton') // = 10 KG
    await issueStock({ fromLocationId: MAIN, toLocationId: BRANCH, lines: [line(4)], actor: ACTOR, date: Date.now() })
    expect(qtyFor(MAIN)).toBe(6)
    expect(qtyFor(BRANCH)).toBe(4)
    await receive(100)
    await issueStock({ fromLocationId: MAIN, toLocationId: BRANCH, lines: [line(2, 'Pack')], actor: ACTOR, date: Date.now() })
    expect(qtyFor(MAIN)).toBe(102)
    expect(qtyFor(BRANCH)).toBe(8)
    expect(levels().filter((d) => d.productId === 'p1')).toHaveLength(2) // one per site, no #Unit rows
  })

  test('grams still convert into kilograms, with the rate on the row', async () => {
    await receive(500, 'g')
    expect(movements()[0]).toMatchObject({ entryUnit: 'g', entryQty: 500, qty: 0.5 })
    expect(qtyFor(MAIN)).toBe(0.5)
  })

  test('a unit with no rate for this product is refused by name, not guessed', async () => {
    expect(() => line(1, 'Lot')).toThrow(/Lot/)
    // And the engine refuses a keyed unit that arrives without the keyed quantity.
    await expect(
      receiveStock({ toLocationId: MAIN, lines: [{ productId: 'p1', productName: 'Prawn', unit: 'KG', entryUnit: 'Carton', qty: 10 }], actor: ACTOR, date: Date.now() }),
    ).rejects.toThrow()
  })

  test('not enough stock is said in the product\'s unit, with what was keyed', async () => {
    await receive(5)
    await expect(
      issueStock({ fromLocationId: MAIN, toLocationId: BRANCH, lines: [line(1, 'Carton')], actor: ACTOR, date: Date.now() }),
    ).rejects.toThrow(/คงเหลือ 5 KG/)
  })

  test('two lines for one product in different units add up in the product\'s unit', async () => {
    await receiveStock({ toLocationId: MAIN, lines: [line(1, 'Carton'), line(3), line(1, 'Pack')], actor: ACTOR, date: Date.now() })
    expect(movements()).toHaveLength(1)
    expect(movements()[0]).toMatchObject({ qty: 15 })
    expect(movements()[0].entryUnit).toBeUndefined()
    await receiveStock({ toLocationId: MAIN, lines: [line(1, 'Carton'), line(2, 'Carton')], actor: ACTOR, date: Date.now() })
    expect(movements()[1]).toMatchObject({ qty: 30, entryUnit: 'Carton', entryQty: 3 })
  })

  test('an adjustment keyed in Pack moves the KG balance', async () => {
    await receive(10)
    await adjustStock({ productId: 'p1', productName: 'Prawn', unit: 'KG', ...line(2, 'Pack'), locationId: MAIN, direction: 'out', reason: 'broken', date: Date.now(), actor: ACTOR })
    expect(qtyFor(MAIN)).toBe(6)
    expect(movements()[1]).toMatchObject({ type: 'adjust', entryUnit: 'Pack', entryQty: 2, qty: 4 })
  })
})

describe('undoing a converted line', () => {
  test('voiding a Carton receipt takes its KG back off the one balance', async () => {
    await receive(1, 'Carton')
    await receive(2)
    await voidMovement(movements()[0].id as string, ACTOR)
    expect(qtyFor(MAIN)).toBe(2)
    expect(await findLevelDrift()).toEqual([])
  })

  test('mixed units in the ledger agree with the cached balances', async () => {
    await receive(3, 'Carton')
    await receive(5, 'Pack')
    await receive(1)
    expect(qtyFor(MAIN)).toBe(41)
    expect(await findLevelDrift()).toEqual([])
  })
})

describe('rows filed under the old rule', () => {
  test('stay on their own #Unit balance and still reconcile', async () => {
    seedLegacy(10, 'Pack')
    await receive(2)
    expect(qtyFor(MAIN, 'Pack')).toBe(10)
    expect(qtyFor(MAIN)).toBe(2)
    expect(await findLevelDrift()).toEqual([])
  })

  test('voiding a legacy row finds the #Unit balance it made', async () => {
    seedLegacy(10, 'Pack')
    await voidMovement('legacy-Pack-10', ACTOR)
    expect(qtyFor(MAIN, 'Pack')).toBe(0)
    expect(await findLevelDrift()).toEqual([])
  })

  test('editing a legacy row\'s quantity converts it at the product\'s rate onto the base balance', async () => {
    seedLegacy(10, 'Pack')
    await editMovement({ movementId: 'legacy-Pack-10', patch: { entryQty: 4 }, actor: ACTOR })
    expect(movements()[0]).toMatchObject({ entryUnit: 'Pack', entryQty: 4, qty: 8 })
    expect(qtyFor(MAIN, 'Pack')).toBe(0)
    expect(qtyFor(MAIN)).toBe(8)
    expect(await findLevelDrift()).toEqual([])
  })

  test('a legacy row in a unit with no rate keeps its note corrected, but its quantity cannot move', async () => {
    seedLegacy(10, 'Lot')
    await editMovement({ movementId: 'legacy-Lot-10', patch: { note: 'checked' }, actor: ACTOR })
    expect(movements()[0]).toMatchObject({ note: 'checked', entryUnit: 'Lot', qty: 10 })
    expect(movements()[0].entryQty).toBeUndefined()
    expect(qtyFor(MAIN, 'Lot')).toBe(10)
    await expect(editMovement({ movementId: 'legacy-Lot-10', patch: { entryQty: 3 }, actor: ACTOR })).rejects.toThrow(/Lot/)
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
  test('changing the unit re-converts at the product\'s current rate', async () => {
    // What people were doing instead: void the row, key the whole delivery again.
    await receive(10, 'Pack') // = 20 KG
    await editMovement({ movementId: movements()[0].id as string, patch: { entryUnit: 'Carton' }, actor: ACTOR })
    expect(movements()[0]).toMatchObject({ entryUnit: 'Carton', entryQty: 10, qty: 100 })
    expect(qtyFor(MAIN)).toBe(100)
  })

  test('re-keying the quantity uses the rate the row was filed at, not today\'s', async () => {
    await receive(1, 'Carton') // 10 KG at today's rate
    // The owner later corrects the product: a Carton is 12 KG. This row was 10.
    await memoryBackend.update('products', 'p1', { unitConversions: [{ label: 'Carton', size: 12 }] })
    await editMovement({ movementId: movements()[0].id as string, patch: { entryQty: 2 }, actor: ACTOR })
    expect(movements()[0]).toMatchObject({ entryQty: 2, qty: 20 })
    expect(qtyFor(MAIN)).toBe(20)
  })

  test("putting a row back on the product's own unit drops the keyed pair", async () => {
    await receive(4, 'Pack')
    await editMovement({ movementId: movements()[0].id as string, patch: { entryUnit: '' }, actor: ACTOR })
    expect(movements()[0].entryUnit).toBeUndefined()
    expect(movements()[0].entryQty).toBeUndefined()
    expect(movements()[0].qty).toBe(4)
    expect(qtyFor(MAIN)).toBe(4)
  })

  test('a keyed row is edited through its keyed quantity, not the base one', async () => {
    await receive(4, 'Pack')
    await expect(editMovement({ movementId: movements()[0].id as string, patch: { qty: 9 }, actor: ACTOR })).rejects.toThrow()
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
      patch: { entryUnit: 'Carton', toLocationId: BRANCH, entryQty: 3 },
      actor: ACTOR,
    })
    expect(qtyFor(MAIN)).toBe(0)
    expect(qtyFor(BRANCH)).toBe(30)
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
    expect(edits[0].changed).toEqual(['จำนวน', 'หน่วย', 'คลังปลายทาง'])
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

describe('correcting a product whose unit was set up wrong', () => {
  const products = () => raw('products') as Record<string, unknown>[]
  // The rates are stated in the old unit, so they go first (the service insists).
  beforeEach(async () => {
    await memoryBackend.update('products', 'p1', { unitConversions: [] })
  })

  test('is refused while the product still has rates, or converted history', async () => {
    await memoryBackend.update('products', 'p1', { unitConversions: [{ label: 'Carton', size: 10 }] })
    await expect(changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })).rejects.toThrow(/อัตราแปลง/)
    await receive(1, 'Carton')
    await memoryBackend.update('products', 'p1', { unitConversions: [] })
    await expect(changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })).rejects.toThrow()
  })

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

  test('a legacy row keyed in the unit the product is becoming stops being a separate balance', async () => {
    // 10 "EA" of a KG product was its own balance. Once the product IS EA, it is just 10.
    seedLegacy(10, 'EA')
    await receive(2)
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    expect(qtyFor(MAIN, 'EA')).toBe(0)
    expect(qtyFor(MAIN)).toBe(12)
    expect(movements().every((m) => m.entryUnit === undefined)).toBe(true)
  })

  test('a legacy row keyed in some other unit stays its own balance', async () => {
    seedLegacy(10, 'Pack')
    await receive(2)
    await changeProductUnit({ productId: 'p1', unitType: 'EA', unit: 'Each', actor: ACTOR })
    expect(qtyFor(MAIN, 'Pack')).toBe(10)
    expect(qtyFor(MAIN)).toBe(2)
  })

  test('the books still agree with the ledger afterwards', async () => {
    seedLegacy(10, 'EA')
    seedLegacy(5, 'Pack')
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

describe('what an edit remembers', () => {
  test('each change is kept by field with its old and new value', async () => {
    // The activity log says what the row used to say; the label list alone could not.
    await receive(10, 'Pack')
    const [m] = movements()
    await editMovement({
      movementId: m.id as string,
      patch: { entryQty: 12, entryUnit: 'Carton', note: 'recount' },
      actor: ACTOR,
    })
    const [edit] = movements()[0].edits as { changed: string[]; changes: { field: string; from: string; to: string }[] }[]
    expect(edit.changed).toEqual(['จำนวน', 'หมายเหตุ', 'หน่วย'])
    expect(edit.changes).toEqual([
      { field: 'entryQty', from: '10 Pack (= 20 KG)', to: '12 Carton (= 120 KG)' },
      { field: 'note', from: 'IV-1', to: 'recount' },
      { field: 'unit', from: 'Pack', to: 'Carton' },
    ])
  })
})
