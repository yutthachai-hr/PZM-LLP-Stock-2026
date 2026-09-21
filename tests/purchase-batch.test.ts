// An imported order list: rows, questions, groups, and the batch that holds them.
//
//   npm test
//
// The acceptance case from the brief runs through here: COKE CAN and COKE ZERO from
// THAINAMTHIP, FRENCH FRIES from another supplier, one workbook → two groups. And the rule
// that outranks it: a row the app is not sure about is in no group at all.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { OrderBlock } from '../src/lib/orderSheet'
import type { BatchRow, Product, PurchaseOrder, Supplier, SupplierItem } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw } = await import('./helpers/memory-backend')
const {
  approveBatch,
  assessRows,
  buildBatchRows,
  ensureDraftOrders,
  settleSendStatus,
  canonicalUnit,
  cancelBatch,
  createBatch,
  derivedStatus,
  findBatchesByHash,
  groupRows,
  groupState,
  hashFile,
  listBatchesInRange,
  makeBatchNo,
  resolveUnit,
  rowState,
  saveRows,
} = await import('../src/services/purchaseBatch')
const { setActiveBrand } = await import('../src/brand/brand')

const ACTOR = { id: 'u1', name: 'AA' }

function product(id: string, name: string, over: Partial<Product> = {}): Product {
  return {
    id,
    sku: `SKU-${id}`,
    name,
    category: 'c',
    unit: 'Each',
    unitType: 'EA',
    minStock: 0,
    hasImage: false,
    active: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}
function supplier(id: string, name: string, over: Partial<Supplier> = {}): Supplier {
  return { id, name, contactNumber: '', email: '', type: 'takingReturn', active: true, createdAt: 0, updatedAt: 0, ...over }
}

const THAI = supplier('s-thai', 'THAINAMTHIP')
const GLOBAL = supplier('s-global', 'GLOBAL FOOD')
const SUPPLIERS = [THAI, GLOBAL]
const PRODUCTS = [
  product('p-coke', 'COKE CAN 325 ML 1X24 (THAINAMTHIP)', { supplierId: 's-thai', unitType: 'Pack', unit: 'Pack' }),
  product('p-zero', 'COKE ZERO CAN 325 ML 1X24 (THAINAMTHIP)', { supplierId: 's-thai', unitType: 'Pack', unit: 'Pack' }),
  product('p-fries', 'FRENCH FRIES  3/8 (GLOBAL FOOD)', { supplierId: 's-global', unitType: 'Pack', unit: 'Pack' }),
  product('p-blue-a', 'BLUE CHEESE 3 KG (TOPFOOD)', { supplierId: 's-thai', unitType: 'KG', unit: 'Kilogram' }),
  product('p-blue-b', 'BLUE CHEESE 3 KG (FOOD PROJECT)', { supplierId: 's-global', unitType: 'KG', unit: 'Kilogram' }),
  product('p-orphan', 'YEAST', { unitType: 'EA' }),
  product('p-mozz', 'MOZZARELLA (X)', { supplierId: 's-global', unitType: 'KG', unit: 'Kilogram', unitConversions: [{ label: 'Pack', size: 2 }] }),
]

function block(rows: [string, string, string | number][]): OrderBlock {
  return {
    sheet: 's',
    label: 'รายการสั่งของ 14/9/2026',
    date: new Date(2026, 8, 14).getTime(),
    headerRow: 2,
    cols: { name: 0, unit: 2, qty: 7, note: 8, cycle: 1 },
    rows: rows.map(([name, unit, q], i) => {
      const rawQty = String(q)
      const n = typeof q === 'number' ? q : Number(q)
      const qtyState = rawQty === '-' || rawQty === '' ? 'none' : Number.isFinite(n) ? (n > 0 ? 'order' : 'none') : 'unclear'
      return { excelRow: i + 4, name, unit, rawQty, qtyState, qty: qtyState === 'order' ? n : null, note: '', cycle: '' }
    }),
  }
}

const ctx = (over: Partial<Parameters<typeof assessRows>[1]> = {}) => ({
  products: PRODUCTS,
  suppliers: SUPPLIERS,
  supplierItems: [] as SupplierItem[],
  recentOrders: [] as PurchaseOrder[],
  plainUnits: ['Lot', 'Pack', 'EA'],
  now: new Date(2026, 8, 14, 10).getTime(),
  ...over,
})

function assessed(rows: [string, string, string | number][], over = {}) {
  return assessRows(buildBatchRows(block(rows), PRODUCTS, []), ctx(over))
}

describe('the acceptance case', () => {
  test('one workbook becomes two supplier groups, each with only its own products', () => {
    const rows = assessed([
      ['COKE CAN 325 ML 1X24', 'Pack', 5],
      ['COKE ZERO CAN 325 ML 1X24', 'Pack', 5],
      ['FRENCH FRIES 3/8', 'Pack', 6],
    ])
    expect(rows.map(rowState)).toEqual(['ready', 'ready', 'ready'])
    const groups = groupRows(rows)
    expect(groups.map((g) => [g.supplierName, g.rowIdx])).toEqual([
      ['THAINAMTHIP', [0, 1]],
      ['GLOBAL FOOD', [2]],
    ])
    expect(groups.map((g) => groupState(g, rows))).toEqual(['ready', 'ready'])
    expect(derivedStatus({ rows, groups, status: 'draft' })).toBe('ready')
  })

  test('rows the workbook marks with a dash are not rows', () => {
    const rows = buildBatchRows(block([['COKE CAN 325 ML 1X24', 'Pack', '-'], ['FRENCH FRIES 3/8', 'Pack', 6]]), PRODUCTS, [])
    expect(rows.map((r) => r.rawName)).toEqual(['FRENCH FRIES 3/8'])
    expect(rows[0].idx).toBe(0)
  })
})

describe('what needs a person', () => {
  test('an unknown name is a review, is in no group, and holds the batch at needsReview', () => {
    const rows = assessed([['COKE CAN 325 ML 1X24', 'Pack', 5], ['SOMETHING NEW', 'EA', 3]])
    expect(rows[1].issues).toEqual([{ code: 'unknownProduct', severity: 'review' }])
    expect(rowState(rows[1])).toBe('review')
    const groups = groupRows(rows)
    expect(groups).toHaveLength(1)
    expect(derivedStatus({ rows, groups, status: 'draft' })).toBe('needsReview')
  })

  test('the same cheese from two suppliers is ambiguous, never picked', () => {
    const [row] = assessed([['BLUE CHEESE 3 KG', 'KG', 6]])
    expect(row.matchKind).toBe('ambiguous')
    expect(row.productId).toBeUndefined()
    expect(row.issues[0].code).toBe('ambiguousProduct')
  })

  test('a product with no supplier asks for one', () => {
    const [row] = assessed([['YEAST', 'EA', 5]])
    expect(row.productId).toBe('p-orphan')
    expect(row.issues.map((i) => i.code)).toEqual(['noSupplier'])
  })

  test('"ตาม" in the quantity column is a question about the quantity', () => {
    const [row] = assessed([['COKE CAN 325 ML 1X24', 'Pack', 'ตาม']])
    expect(row.qty).toBeUndefined()
    expect(row.issues).toEqual([{ code: 'qtyUnclear', severity: 'review', detail: 'ตาม' }])
  })

  test('a hidden supplier or product blocks the row', () => {
    const rows = assessRows(
      buildBatchRows(block([['COKE CAN 325 ML 1X24', 'Pack', 5], ['FRENCH FRIES 3/8', 'Pack', 6]]), PRODUCTS, []),
      ctx({
        suppliers: [supplier('s-thai', 'THAINAMTHIP', { active: false }), GLOBAL],
        products: PRODUCTS.map((p) => (p.id === 'p-fries' ? { ...p, active: false } : p)),
      }),
    )
    expect(rows[0].issues).toEqual([{ code: 'supplierInactive', severity: 'block', detail: 'THAINAMTHIP' }])
    expect(rows[1].issues).toEqual([{ code: 'productInactive', severity: 'block' }])
    expect(rows.map(rowState)).toEqual(['blocked', 'blocked'])
    expect(groupState(groupRows(rows)[0], rows)).toBe('blocked')
  })

  test('the same product twice in one list is flagged on the second', () => {
    const rows = assessed([['COKE CAN 325 ML 1X24', 'Pack', 5], ['COKE CAN 325 ML 1X24', 'Pack', 3]])
    expect(rows[0].issues).toEqual([])
    expect(rows[1].issues).toEqual([{ code: 'duplicateProduct', severity: 'review', detail: '4' }])
  })
})

describe('units', () => {
  test('workbook spellings the app knows are read as the app spells them', () => {
    expect(canonicalUnit('กก.')).toBe('KG')
    expect(canonicalUnit('แพ็ค')).toBe('Pack')
    expect(canonicalUnit('PCS')).toBe('EA')
    expect(canonicalUnit('ลัง')).toBe('ลัง')
    expect(canonicalUnit('')).toBe('')
  })

  test('the product\'s own unit, however spelled, is no entryUnit at all', () => {
    const kg = PRODUCTS.find((p) => p.id === 'p-mozz')!
    expect(resolveUnit('กก.', kg, ['Pack'])).toEqual({})
    expect(resolveUnit('', kg, ['Pack'])).toEqual({})
  })

  test('another unit the product may be keyed in becomes the entryUnit', () => {
    const kg = PRODUCTS.find((p) => p.id === 'p-mozz')!
    expect(resolveUnit('แพ็ค', kg, ['Lot', 'Pack', 'EA'])).toEqual({ entryUnit: 'Pack' })
    const [row] = assessed([['MOZZARELLA', 'แพ็ค', 2]])
    expect(row.entryUnit).toBe('Pack')
    expect(row.issues).toEqual([])
  })

  test('a unit the product has no rate for is a question; a rated one, and grams, are fine', () => {
    const kg = PRODUCTS.find((p) => p.id === 'p-mozz')!
    expect(resolveUnit('ขา', kg, ['Pack'])).toBeNull()
    // Grams have a rate for every KG product (lib/uom.ts): the line is kept as written
    // and converted when the order is placed.
    expect(resolveUnit('กรัม (g)', kg, ['Pack'])).toEqual({ entryUnit: 'g' })
    // A unit on the owner's list that this product has no rate for is still a question.
    expect(resolveUnit('Lot', kg, ['Lot', 'Pack'])).toBeNull()
    const [row] = assessed([['MOZZARELLA', 'ขา', 2]])
    expect(row.issues).toEqual([{ code: 'unitMismatch', severity: 'review', detail: 'ขา' }])
  })

  test('a person\'s own choice of unit on a manual row is left alone', () => {
    const [built] = buildBatchRows(block([['MOZZARELLA', 'ขา', 2]]), PRODUCTS, [])
    const manual: BatchRow = { ...built, matchKind: 'manual', entryUnit: 'Lot' }
    const [row] = assessRows([manual], ctx())
    expect(row.entryUnit).toBe('Lot')
    expect(row.issues).toEqual([])
  })
})

describe('warnings that want a tick', () => {
  const order = (over: Partial<PurchaseOrder>, lines: PurchaseOrder['lines']): PurchaseOrder => ({
    id: 'o',
    docNo: 'PO-00001',
    supplierId: 's-thai',
    supplierName: 'THAINAMTHIP',
    status: 'ordered',
    locationId: 'loc',
    orderedAt: new Date(2026, 8, 1).getTime(),
    lines,
    createdBy: 'u',
    createdByName: 'U',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  })
  const cokeLine = (qty: number) => ({ productId: 'p-coke', productName: 'COKE', unit: 'Pack', orderedQty: qty })

  test('a quantity far above anything recent is a warning, and a tick makes the row ready', () => {
    const recentOrders = [5, 10, 20].map((q, i) => order({ id: `o${i}`, docNo: `PO-0000${i}` }, [cokeLine(q)]))
    const [row] = assessed([['COKE CAN 325 ML 1X24', 'Pack', 200]], { recentOrders })
    expect(row.issues).toEqual([{ code: 'suspiciousQty', severity: 'warn', detail: '5–20' }])
    expect(rowState(row)).toBe('review')
    expect(rowState({ ...row, confirmed: true })).toBe('ready')
  })

  test('two past orders are not a pattern', () => {
    const recentOrders = [5, 10].map((q, i) => order({ id: `o${i}` }, [cokeLine(q)]))
    const [row] = assessed([['COKE CAN 325 ML 1X24', 'Pack', 200]], { recentOrders })
    expect(row.issues).toEqual([])
  })

  test('below the supplier\'s minimum is a warning that quotes the minimum', () => {
    const supplierItems: SupplierItem[] = [
      { id: 'i', supplierId: 's-thai', productId: 'p-coke', minOrderQty: 10, active: true, createdAt: 0, updatedAt: 0 },
    ]
    const [row] = assessed([['COKE CAN 325 ML 1X24', 'Pack', 5]], { supplierItems })
    expect(row.issues).toEqual([{ code: 'belowMoq', severity: 'warn', detail: '10' }])
  })

  test('an order already placed today for the same thing is named', () => {
    const recentOrders = [order({ orderedAt: new Date(2026, 8, 14, 8).getTime() }, [cokeLine(5)])]
    const [row] = assessed([['COKE CAN 325 ML 1X24', 'Pack', 5]], { recentOrders })
    expect(row.issues.map((i) => [i.code, i.detail])).toEqual([['possibleDuplicateOrder', 'PO-00001']])
  })

  test('a draft placed today is not a duplicate — it may be this very batch', () => {
    const recentOrders = [order({ status: 'draft', orderedAt: new Date(2026, 8, 14, 8).getTime() }, [cokeLine(5)])]
    const [row] = assessed([['COKE CAN 325 ML 1X24', 'Pack', 5]], { recentOrders })
    expect(row.issues).toEqual([])
  })

  test('a skipped row raises nothing and joins no group', () => {
    const rows = assessed([['SOMETHING NEW', 'EA', 3]])
    const skipped = assessRows([{ ...rows[0], skipped: true }], ctx())
    expect(skipped[0].issues).toEqual([])
    expect(rowState(skipped[0])).toBe('skipped')
    expect(groupRows(skipped)).toEqual([])
    expect(derivedStatus({ rows: skipped, groups: [], status: 'draft' })).toBe('draft')
  })
})

describe('the batch document', () => {
  beforeEach(() => {
    resetMemory()
    setActiveBrand('pizza')
  })

  const build = () => assessed([['COKE CAN 325 ML 1X24', 'Pack', 5], ['FRENCH FRIES 3/8', 'Pack', 6]])

  test('is numbered per day and remembers where it came from', async () => {
    const rows = build()
    const a = await createBatch({ locationId: 'loc', sourceFileName: 'order.xlsx', fileHash: 'h1', sheetName: 's', blockLabel: 'รายการสั่งของ 14/9/2026', rows, actor: ACTOR })
    const b = await createBatch({ locationId: 'loc', sourceFileName: 'order.xlsx', fileHash: 'h2', sheetName: 's', blockLabel: 'x', rows, actor: ACTOR })
    expect(a.batchNo).toMatch(/^PB-\d{8}-001$/)
    expect(b.batchNo).toMatch(/^PB-\d{8}-002$/)
    expect(a.status).toBe('ready')
    expect(a.groups).toHaveLength(2)
    expect(a.history).toEqual([expect.objectContaining({ action: 'imported', by: 'u1', detail: 'order.xlsx' })])
    expect(makeBatchNo(new Date(2026, 8, 14).getTime(), 3)).toBe('PB-20260914-003')
  })

  test('the same file is found again by its hash', async () => {
    const rows = build()
    await createBatch({ locationId: 'loc', sourceFileName: 'order.xlsx', fileHash: 'same', sheetName: 's', blockLabel: 'x', rows, actor: ACTOR })
    expect(await findBatchesByHash('same')).toHaveLength(1)
    expect(await findBatchesByHash('other')).toHaveLength(0)
  })

  test('hashFile is stable and hex', async () => {
    const buf = new TextEncoder().encode('hello').buffer as ArrayBuffer
    const h = await hashFile(buf)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashFile(buf)).toBe(h)
  })

  test('saving settled rows re-assesses, re-groups, and logs who did it', async () => {
    const rows = assessed([['SOMETHING NEW', 'EA', 3]])
    const batch = await createBatch({ locationId: 'loc', sourceFileName: 'f', fileHash: 'h', sheetName: 's', blockLabel: 'x', rows, actor: ACTOR })
    expect(batch.status).toBe('needsReview')
    expect(batch.groups).toEqual([])

    const settled: BatchRow = { ...batch.rows[0], matchKind: 'manual', productId: 'p-coke', supplierId: 's-thai' }
    const next = await saveRows({ batchId: batch.id, rows: [settled], ctx: ctx(), actor: { id: 'u2', name: 'BB' }, action: 'productMapped', detail: 'SOMETHING NEW → COKE' })
    expect(next.status).toBe('ready')
    expect(next.rows[0]).toMatchObject({ productName: 'COKE CAN 325 ML 1X24 (THAINAMTHIP)', supplierName: 'THAINAMTHIP', issues: [] })
    expect(next.groups.map((g) => g.supplierName)).toEqual(['THAINAMTHIP'])
    expect(next.history.map((h) => [h.action, h.byName])).toEqual([['imported', 'AA'], ['productMapped', 'BB']])
    expect((raw('purchaseBatches')[0] as { history: unknown[] }).history).toHaveLength(2)
  })

  test('an approved batch refuses row edits; a completed one refuses cancelling', async () => {
    const batch = await createBatch({ locationId: 'loc', sourceFileName: 'f', fileHash: 'h', sheetName: 's', blockLabel: 'x', rows: build(), actor: ACTOR })
    const { appendHistory } = await import('../src/services/purchaseBatch')
    await appendHistory(batch.id, ACTOR, 'approved', undefined, { status: 'approved' })
    await expect(saveRows({ batchId: batch.id, rows: batch.rows, ctx: ctx(), actor: ACTOR, action: 'x' })).rejects.toThrow()
    await appendHistory(batch.id, ACTOR, 'completed', undefined, { status: 'completed' })
    await expect(cancelBatch(batch.id, ACTOR)).rejects.toThrow()
  })

  test('recent batches come back newest first', async () => {
    const t0 = Date.now()
    await createBatch({ locationId: 'loc', sourceFileName: 'a', fileHash: 'ha', sheetName: 's', blockLabel: 'x', rows: build(), actor: ACTOR })
    await new Promise((r) => setTimeout(r, 2))
    await createBatch({ locationId: 'loc', sourceFileName: 'b', fileHash: 'hb', sheetName: 's', blockLabel: 'x', rows: build(), actor: ACTOR })
    const list = await listBatchesInRange(t0 - 1000, Date.now() + 1000)
    expect(list.map((b) => b.sourceFileName)).toEqual(['b', 'a'])
  })
})

describe('from a batch to draft orders', () => {
  beforeEach(() => {
    resetMemory()
    setActiveBrand('pizza')
  })
  const orders = () => raw('purchaseOrders') as unknown as PurchaseOrder[]
  const make = (rows: [string, string, string | number][]) =>
    createBatch({ locationId: 'loc', sourceFileName: 'f', fileHash: 'h', sheetName: 's', blockLabel: 'x', rows: assessed(rows), actor: ACTOR })

  test('every ready group gets one draft, numbered per supplier, and the batch remembers it', async () => {
    const batch = await make([
      ['COKE CAN 325 ML 1X24', 'Pack', 5],
      ['COKE ZERO CAN 325 ML 1X24', 'Pack', 5],
      ['FRENCH FRIES 3/8', 'Pack', 6],
    ])
    const next = await ensureDraftOrders({ batchId: batch.id, products: PRODUCTS, actor: ACTOR })
    expect(next.groups.map((g) => [g.supplierName, g.docNo])).toEqual([
      ['THAINAMTHIP', 'PO-00001'],
      ['GLOBAL FOOD', 'PO-00001'],
    ])
    const all = orders()
    expect(all).toHaveLength(2)
    expect(all.every((o) => o.status === 'draft' && o.batchId === batch.id)).toBe(true)
    const thai = all.find((o) => o.supplierName === 'THAINAMTHIP')!
    expect(thai.lines.map((l) => [l.productName, l.orderedQty])).toEqual([
      ['COKE CAN 325 ML 1X24 (THAINAMTHIP)', 5],
      ['COKE ZERO CAN 325 ML 1X24 (THAINAMTHIP)', 5],
    ])
    expect(next.history.at(-1)!.action).toBe('poGenerated')
  })

  test('a group with a row still in question gets no draft; the other supplier does', async () => {
    const batch = await make([['COKE CAN 325 ML 1X24', 'Pack', 'ตาม'], ['FRENCH FRIES 3/8', 'Pack', 6]])
    const next = await ensureDraftOrders({ batchId: batch.id, products: PRODUCTS, actor: ACTOR })
    expect(next.groups.find((g) => g.supplierName === 'THAINAMTHIP')!.poId).toBeUndefined()
    expect(next.groups.find((g) => g.supplierName === 'GLOBAL FOOD')!.docNo).toBe('PO-00001')
    expect(orders()).toHaveLength(1)
  })

  test('changing a quantity replaces the draft; an approved order is left alone', async () => {
    const batch = await make([['COKE CAN 325 ML 1X24', 'Pack', 5], ['FRENCH FRIES 3/8', 'Pack', 6]])
    let cur = await ensureDraftOrders({ batchId: batch.id, products: PRODUCTS, actor: ACTOR })
    cur = await approveBatch({ batchId: batch.id, products: PRODUCTS, actor: ACTOR, supplierId: 's-global' })
    const rows = cur.rows.map((r) => (r.rawName.startsWith('COKE') ? { ...r, qty: 7 } : { ...r, qty: 99 }))
    // Row edits after approval of one group are still allowed for the others.
    cur = await saveRows({ batchId: batch.id, rows, ctx: ctx(), actor: ACTOR, action: 'qtyChanged' })
    cur = await ensureDraftOrders({ batchId: batch.id, products: PRODUCTS, actor: ACTOR })
    const all = orders()
    const thai = all.filter((o) => o.supplierName === 'THAINAMTHIP')
    expect(thai).toHaveLength(1)
    expect(thai[0]).toMatchObject({ status: 'draft', docNo: 'PO-00002' })
    expect(thai[0].lines[0].orderedQty).toBe(7)
    const global = all.find((o) => o.supplierName === 'GLOBAL FOOD')!
    expect(global.status).toBe('ordered')
    expect(global.lines[0].orderedQty).toBe(6)
  })

  test('approve all places every ready group and marks the batch approved', async () => {
    const batch = await make([['COKE CAN 325 ML 1X24', 'Pack', 5], ['FRENCH FRIES 3/8', 'Pack', 6]])
    const next = await approveBatch({ batchId: batch.id, products: PRODUCTS, actor: { id: 'u9', name: 'Boss' } })
    expect(next.status).toBe('approved')
    expect(orders().every((o) => o.status === 'ordered' && o.approvedBy === 'u9')).toBe(true)
    expect(next.history.map((h) => h.action)).toEqual(['imported', 'poGenerated', 'approved'])
    await expect(saveRows({ batchId: batch.id, rows: next.rows, ctx: ctx(), actor: ACTOR, action: 'x' })).rejects.toThrow()
  })

  test('approve all with an unresolved row places the others and keeps the batch open', async () => {
    const batch = await make([['SOMETHING NEW', 'EA', 1], ['FRENCH FRIES 3/8', 'Pack', 6]])
    const next = await approveBatch({ batchId: batch.id, products: PRODUCTS, actor: ACTOR })
    expect(next.status).toBe('needsReview')
    expect(orders().map((o) => o.status)).toEqual(['ordered'])
  })

  test('the batch completes once every placed order is sent or skipped', async () => {
    const batch = await make([['COKE CAN 325 ML 1X24', 'Pack', 5], ['FRENCH FRIES 3/8', 'Pack', 6]])
    await approveBatch({ batchId: batch.id, products: PRODUCTS, actor: ACTOR })
    const { setShareStatus } = await import('../src/services/purchaseOrders')
    const [a, b] = orders()
    await setShareStatus(a.id, 'sent', ACTOR, 1)
    expect((await settleSendStatus(batch.id, ACTOR)).status).toBe('sending')
    await setShareStatus(b.id, 'skipped', ACTOR)
    expect((await settleSendStatus(batch.id, ACTOR)).status).toBe('completed')
    await expect(cancelBatch(batch.id, ACTOR)).rejects.toThrow()
  })
})
