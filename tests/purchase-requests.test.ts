// Purchase requests: from a draft on the floor to placed orders, with the หัวหน้า in between.
//
//   npm test
//
// The acceptance scenario from the brief runs top to bottom in the last describe. The rule
// the whole module is built around, tested first: the requester's number and the manager's
// number are two numbers, and neither overwrites the other.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Product, PurchaseOrder, PurchaseRequest, StockLocation, Supplier } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw, seed, memoryBackend } = await import('./helpers/memory-backend')
const S = await import('../src/services/purchaseRequests')
const { canTransition, canEditItems, isReadyForOrder, liveItems } = await import('../src/lib/purchaseRequestStatus')
const { setActiveBrand } = await import('../src/brand/brand')
const { repairPlan } = await import('../src/lib/requestConversion')

const STAFF = { id: 'u-staff', name: 'AA', role: 'staff' as const }
const OTHER_STAFF = { id: 'u-other', name: 'BB', role: 'staff' as const }
const MANAGER = { id: 'u-mgr', name: 'Manager A', role: 'manager' as const }
const ADMIN = { id: 'u-admin', name: 'Admin', role: 'admin' as const }
const MAIN = 'loc-main'

function product(id: string, name: string, sku: string, over: Partial<Product> = {}): Product {
  return { id, sku, name, category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0, ...over }
}
function supplier(id: string, name: string, over: Partial<Supplier> = {}): Supplier {
  return { id, name, contactNumber: '', email: '', type: 'takingReturn', active: true, createdAt: 0, updatedAt: 0, ...over }
}
const ACK = supplier('s-ack', 'ACK')
const THAI = supplier('s-thai', 'THAINAMTHIP')
const OTHER = supplier('s-other', 'SOMEONE ELSE')
const suppliers = [ACK, THAI, OTHER]
const products = [
  product('p-redoak', 'RED OAK SALAD', 'VGT-01-09-001', { supplierId: 's-ack' }),
  product('p-rocket', 'ROCKET SALAD', 'VGT-01-09-002', { supplierId: 's-ack', alternateSupplierIds: ['s-other'] }),
  product('p-coke', 'COKE CAN 325 ML 1X24', 'BEV-01', { supplierId: 's-thai', unitType: 'Pack', unit: 'Pack' }),
  product('p-zero', 'COKE ZERO CAN 325 ML 1X24', 'BEV-02', { supplierId: 's-thai', unitType: 'Pack', unit: 'Pack' }),
  product('p-orphan', 'YEAST', 'BAK-01'),
]
const locations: StockLocation[] = [{ id: MAIN, name: 'คลังหลัก', type: 'warehouse', active: true, createdAt: 0 }]
const ctx = { products, suppliers, locations }

const requests = () => raw('purchaseRequests') as unknown as PurchaseRequest[]
const orders = () => raw('purchaseOrders') as unknown as PurchaseOrder[]

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
  seed('products', products as unknown as Record<string, unknown>[])
  seed('locations', locations as unknown as Record<string, unknown>[])
})

async function draftWith(lines: { productId: string; supplierId: string; qty: number }[], actor = STAFF) {
  let pr = await S.createRequest({ locationId: MAIN, actor })
  for (const line of lines) pr = await S.addItem({ id: pr.id, line, products, suppliers, actor })
  return pr
}

describe('the status machine', () => {
  test('only the drawn arrows exist', () => {
    expect(canTransition('draft', 'pendingApproval')).toBe(true)
    expect(canTransition('draft', 'approved')).toBe(false)
    expect(canTransition('pendingApproval', 'approved')).toBe(true)
    expect(canTransition('pendingApproval', 'returned')).toBe(true)
    expect(canTransition('returned', 'pendingApproval')).toBe(true)
    expect(canTransition('approved', 'poCreated')).toBe(true)
    expect(canTransition('poCreated', 'approved')).toBe(false)
    expect(canTransition('rejected', 'approved')).toBe(false)
  })

  test('who may touch the lines, by status', () => {
    const own = { status: 'draft' as const, requestedBy: STAFF.id }
    expect(canEditItems(own, STAFF)).toBe(true)
    expect(canEditItems(own, OTHER_STAFF)).toBe(false)
    expect(canEditItems({ ...own, status: 'pendingApproval' }, STAFF)).toBe(false)
    expect(canEditItems({ ...own, status: 'pendingApproval' }, MANAGER)).toBe(true)
    expect(canEditItems({ ...own, status: 'returned' }, STAFF)).toBe(true)
    expect(canEditItems({ ...own, status: 'approved' }, MANAGER)).toBe(false)
    expect(canEditItems({ ...own, status: 'approved' }, ADMIN)).toBe(false)
  })
})

describe('building a request', () => {
  test('is numbered PR-00001, PR-00002 …, in the requester\'s name, at one warehouse', async () => {
    const a = await S.createRequest({ locationId: MAIN, actor: STAFF })
    const b = await S.createRequest({ locationId: MAIN, note: '  urgent ', actor: STAFF })
    expect([a.docNo, b.docNo]).toEqual(['PR-00001', 'PR-00002'])
    expect(a).toMatchObject({ status: 'draft', revision: 1, requestedBy: STAFF.id, items: [] })
    expect(b.note).toBe('urgent')
    expect(a.history.map((h) => h.action)).toEqual(['created'])
    await expect(S.createRequest({ locationId: '', actor: STAFF })).rejects.toThrow()
  })

  test('a line carries the product as it is now, and says how its supplier was chosen', async () => {
    const pr = await draftWith([
      { productId: 'p-redoak', supplierId: 's-ack', qty: 5 },
      { productId: 'p-rocket', supplierId: 's-other', qty: 3 },
      { productId: 'p-orphan', supplierId: 's-thai', qty: 1 },
    ])
    expect(pr.items.map((i) => [i.productName, i.sku, i.unit, i.supplierName, i.supplierChoice, i.requestedQty])).toEqual([
      ['RED OAK SALAD', 'VGT-01-09-001', 'KG', 'ACK', 'primary', 5],
      ['ROCKET SALAD', 'VGT-01-09-002', 'KG', 'SOMEONE ELSE', 'alternate', 3],
      ['YEAST', 'BAK-01', 'KG', 'THAINAMTHIP', 'custom', 1],
    ])
    expect(pr.items.every((i) => i.approvedQty === undefined)).toBe(true)
  })

  test('quantities must be positive and the product and supplier must exist', async () => {
    const pr = await S.createRequest({ locationId: MAIN, actor: STAFF })
    await expect(S.addItem({ id: pr.id, line: { productId: 'p-redoak', supplierId: 's-ack', qty: 0 }, products, suppliers, actor: STAFF })).rejects.toThrow()
    await expect(S.addItem({ id: pr.id, line: { productId: 'nope', supplierId: 's-ack', qty: 1 }, products, suppliers, actor: STAFF })).rejects.toThrow()
    await expect(S.addItem({ id: pr.id, line: { productId: 'p-redoak', supplierId: 'nope', qty: 1 }, products, suppliers, actor: STAFF })).rejects.toThrow()
  })

  // Owner, 2 Oct 2026: the order workbook read straight into a request.
  test('lines from the workbook go in at once, merging with lines already there', async () => {
    const pr = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 2 }])
    const next = await S.addItems({
      id: pr.id,
      lines: [
        { productId: 'p-redoak', supplierId: 's-ack', qty: 3 },
        { productId: 'p-coke', supplierId: 's-thai', qty: 6, note: 'ส่ง 3/10' },
        { productId: 'p-coke', supplierId: 's-thai', qty: 1 },
      ],
      products,
      suppliers,
      actor: STAFF,
      source: 'order.xlsx · 3/10',
    })
    expect(liveItems(next.items).map((i) => [i.productName, i.requestedQty, i.note])).toEqual([
      ['RED OAK SALAD', 5, undefined],
      ['COKE CAN 325 ML 1X24', 7, 'ส่ง 3/10'],
    ])
    expect(next.history.at(-1)).toMatchObject({ action: 'itemsImported', by: STAFF.id, detail: 'order.xlsx · 3/10 · 3' })
  })

  test('without a file name, several lines read in the history as if keyed one by one', async () => {
    const pr = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 2 }])
    const next = await S.addItems({
      id: pr.id,
      lines: [
        { productId: 'p-redoak', supplierId: 's-ack', qty: 1 },
        { productId: 'p-zero', supplierId: 's-thai', qty: 4 },
      ],
      products,
      suppliers,
      actor: STAFF,
    })
    expect(next.history.slice(-2).map((h) => h.action)).toEqual(['qtyChanged', 'itemAdded'])
    expect(liveItems(next.items).map((i) => i.requestedQty)).toEqual([3, 4])
  })

  test('one bad line stops the whole import, and only an editable request takes one', async () => {
    const pr = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 2 }])
    const bad = [
      { productId: 'p-coke', supplierId: 's-thai', qty: 6 },
      { productId: 'nope', supplierId: 's-thai', qty: 1 },
    ]
    await expect(S.addItems({ id: pr.id, lines: bad, products, suppliers, actor: STAFF, source: 'x' })).rejects.toThrow()
    expect(liveItems(requests()[0].items)).toHaveLength(1)
    const good = [{ productId: 'p-coke', supplierId: 's-thai', qty: 6 }]
    await expect(S.addItems({ id: pr.id, lines: good, products, suppliers, actor: OTHER_STAFF, source: 'x' })).rejects.toThrow()
    await expect(S.addItems({ id: pr.id, lines: [], products, suppliers, actor: STAFF, source: 'x' })).rejects.toThrow()
  })

  // "PARIS HAM 10 KG / PARIS HAM 20 KG" on one sheet, 21 Sep 2026: the product was keyed
  // twice in the picker and each press made a line.
  test('the same product from the same supplier keyed twice is one line with the sum', async () => {
    const pr = await draftWith([
      { productId: 'p-redoak', supplierId: 's-ack', qty: 10 },
      { productId: 'p-rocket', supplierId: 's-ack', qty: 3 },
      { productId: 'p-redoak', supplierId: 's-ack', qty: 20 },
    ])
    expect(pr.items.map((i) => [i.productName, i.requestedQty])).toEqual([['RED OAK SALAD', 30], ['ROCKET SALAD', 3]])
    expect(pr.history.at(-1)).toMatchObject({ action: 'qtyChanged', itemIdx: 0, oldValue: 'RED OAK SALAD 10 KG', newValue: 'RED OAK SALAD 30 KG' })
    // A different unit, or a different supplier, is its own line.
    const more = await S.addItem({ id: pr.id, line: { productId: 'p-rocket', supplierId: 's-other', qty: 1 }, products, suppliers, actor: STAFF })
    expect(more.items).toHaveLength(3)
  })

  test('another staff member cannot edit my draft; a manager can', async () => {
    const pr = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 5 }])
    await expect(S.setRequestedQty({ id: pr.id, idx: 0, qty: 6, actor: OTHER_STAFF })).rejects.toThrow()
    const next = await S.setRequestedQty({ id: pr.id, idx: 0, qty: 6, actor: MANAGER })
    expect(next.items[0].requestedQty).toBe(6)
    expect(next.history.at(-1)).toMatchObject({ action: 'qtyChanged', by: MANAGER.id, oldValue: 'RED OAK SALAD 5 KG', newValue: 'RED OAK SALAD 6 KG' })
  })

  test('removing a draft line drops it, and a new line never reuses its number', async () => {
    const pr = await draftWith([
      { productId: 'p-redoak', supplierId: 's-ack', qty: 5 },
      { productId: 'p-rocket', supplierId: 's-ack', qty: 3 },
    ])
    const after = await S.removeItem({ id: pr.id, idx: 0, actor: STAFF })
    expect(after.items.map((i) => i.idx)).toEqual([1])
    const more = await S.addItem({ id: pr.id, line: { productId: 'p-coke', supplierId: 's-thai', qty: 5 }, products, suppliers, actor: STAFF })
    expect(more.items.map((i) => i.idx)).toEqual([1, 2])
  })

  test('the warehouse and note can change while it is a draft, on the record', async () => {
    seed('locations', [...locations, { id: 'loc-b', name: 'สาขา', type: 'branch', active: true, createdAt: 0 }])
    const pr = await S.createRequest({ locationId: MAIN, actor: STAFF })
    const next = await S.setRequestHeader({ id: pr.id, locationId: 'loc-b', note: 'for Friday', actor: STAFF })
    expect(next).toMatchObject({ locationId: 'loc-b', note: 'for Friday' })
    expect(next.history.map((h) => h.action)).toEqual(['created', 'warehouseChanged', 'noteChanged'])
  })
})

describe('submitting', () => {
  test('needs at least one line with a positive quantity, live product, live supplier, live warehouse', async () => {
    const empty = await S.createRequest({ locationId: MAIN, actor: STAFF })
    await expect(S.submitRequest({ id: empty.id, ctx, actor: STAFF })).rejects.toThrow(/ยังไม่มีรายการ/)

    const hidden = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 5 }])
    const ctxHidden = { ...ctx, products: products.map((p) => (p.id === 'p-redoak' ? { ...p, active: false } : p)) }
    await expect(S.submitRequest({ id: hidden.id, ctx: ctxHidden, actor: STAFF })).rejects.toThrow(/สินค้าไม่พร้อม/)

    const badLoc = { ...ctx, locations: [] as StockLocation[] }
    await expect(S.submitRequest({ id: hidden.id, ctx: badLoc, actor: STAFF })).rejects.toThrow(/คลัง/)
  })

  test('copies each requested quantity into the approved one and locks the requester out', async () => {
    const pr = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 5 }])
    const sent = await S.submitRequest({ id: pr.id, ctx, actor: STAFF })
    expect(sent.status).toBe('pendingApproval')
    expect(sent.submittedAt).toBeGreaterThan(0)
    expect(sent.items[0]).toMatchObject({ requestedQty: 5, approvedQty: 5 })
    await expect(S.setRequestedQty({ id: pr.id, idx: 0, qty: 9, actor: STAFF })).rejects.toThrow()
    await expect(S.addItem({ id: pr.id, line: { productId: 'p-coke', supplierId: 's-thai', qty: 1 }, products, suppliers, actor: STAFF })).rejects.toThrow()
    // Only the requester (or a manager) may submit.
    const other = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 5 }])
    await expect(S.submitRequest({ id: other.id, ctx, actor: OTHER_STAFF })).rejects.toThrow()
  })

  test('freezes what was on the shelf that day, here and everywhere, for the manager to weigh the ask against', async () => {
    // The owner's rule: the review compares against the balance of the month the request
    // was opened in, never a figure borrowed from later. So it is written at submit time.
    const pr = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 5 }])
    const balances: Record<string, number> = { [`${MAIN}__p-redoak`]: 3, 'loc-branch__p-redoak': 4 }
    const qtyAt = (loc: string, pid: string) => balances[`${loc}__${pid}`] ?? 0
    const withBranch = { ...ctx, locations: [...locations, { id: 'loc-branch', name: 'B', type: 'branch' as const, active: true, createdAt: 1 }], qtyAt }
    const sent = await S.submitRequest({ id: pr.id, ctx: withBranch, actor: STAFF })
    expect(sent.items[0]).toMatchObject({ stockAtSubmit: 3, stockTotalAtSubmit: 7 })
    // Later movements do not touch it.
    balances[`${MAIN}__p-redoak`] = 0
    expect((await S.getRequest(pr.id))!.items[0].stockAtSubmit).toBe(3)
    // Without balances to hand (older callers), nothing is written.
    const bare = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 5 }])
    const sentBare = await S.submitRequest({ id: bare.id, ctx, actor: STAFF })
    expect(sentBare.items[0].stockAtSubmit).toBeUndefined()
  })
})

describe('the manager reviews', () => {
  async function pending() {
    const pr = await draftWith([
      { productId: 'p-redoak', supplierId: 's-ack', qty: 5 },
      { productId: 'p-rocket', supplierId: 's-ack', qty: 3 },
    ])
    return S.submitRequest({ id: pr.id, ctx, actor: STAFF })
  }

  test('changing the approved quantity leaves the requested one alone, and records old → new', async () => {
    const pr = await pending()
    const next = await S.setApprovedQty({ id: pr.id, idx: 0, qty: 3, actor: MANAGER })
    expect(next.items[0]).toMatchObject({ requestedQty: 5, approvedQty: 3 })
    expect(next.history.at(-1)).toMatchObject({ action: 'managerQtyChanged', itemIdx: 0, oldValue: '5', newValue: '3', byName: 'Manager A' })
    await expect(S.setApprovedQty({ id: pr.id, idx: 0, qty: 3, actor: STAFF })).rejects.toThrow()
  })

  test('a line the manager adds has no requested quantity and is marked as theirs', async () => {
    const pr = await pending()
    const next = await S.addItem({ id: pr.id, line: { productId: 'p-zero', supplierId: 's-thai', qty: 5 }, products, suppliers, actor: MANAGER })
    const added = next.items.at(-1)!
    expect(added).toMatchObject({ productName: 'COKE ZERO CAN 325 ML 1X24', requestedQty: null, approvedQty: 5, managerAdded: true })
    expect(next.history.at(-1)).toMatchObject({ action: 'managerAddedItem', itemIdx: added.idx })
  })

  test('a line the manager removes stays on the request with who, when and why', async () => {
    const pr = await pending()
    await expect(S.removeItem({ id: pr.id, idx: 1, actor: MANAGER })).rejects.toThrow(/เหตุผล/)
    const next = await S.removeItem({ id: pr.id, idx: 1, reason: 'not this week', actor: MANAGER })
    expect(next.items).toHaveLength(2)
    expect(next.items[1].removed).toMatchObject({ by: MANAGER.id, byName: 'Manager A', reason: 'not this week' })
    expect(liveItems(next.items)).toHaveLength(1)
  })

  test('changing the supplier re-reads how the choice sits against the product', async () => {
    const pr = await pending()
    const alt = await S.changeSupplier({ id: pr.id, idx: 1, supplierId: 's-other', products, suppliers, actor: MANAGER })
    expect(alt.items[1]).toMatchObject({ supplierName: 'SOMEONE ELSE', supplierChoice: 'alternate' })
    const custom = await S.changeSupplier({ id: pr.id, idx: 0, supplierId: 's-thai', products, suppliers, actor: MANAGER })
    expect(custom.items[0]).toMatchObject({ supplierName: 'THAINAMTHIP', supplierChoice: 'custom' })
    expect(custom.history.at(-1)).toMatchObject({ action: 'supplierChanged', oldValue: 'ACK', newValue: 'THAINAMTHIP' })
  })

  test('returning needs a reason, reopens editing for the requester, and resubmitting counts a revision', async () => {
    const pr = await pending()
    await expect(S.returnRequest({ id: pr.id, reason: '  ', actor: MANAGER })).rejects.toThrow()
    await expect(S.returnRequest({ id: pr.id, reason: 'too much', actor: STAFF })).rejects.toThrow()
    const back = await S.returnRequest({ id: pr.id, reason: 'too much', actor: MANAGER })
    expect(back).toMatchObject({ status: 'returned', returnReason: 'too much' })
    const edited = await S.setRequestedQty({ id: pr.id, idx: 0, qty: 4, actor: STAFF })
    expect(edited.items[0].requestedQty).toBe(4)
    const again = await S.submitRequest({ id: pr.id, ctx, actor: STAFF })
    expect(again).toMatchObject({ status: 'pendingApproval', revision: 2 })
    expect(again.returnReason).toBeUndefined()
    expect(again.items[0].approvedQty).toBe(4)
    expect(again.history.at(-1)).toMatchObject({ action: 'resubmitted', newValue: '2' })
  })

  test('rejecting needs a reason and is signed', async () => {
    const pr = await pending()
    await expect(S.rejectRequest({ id: pr.id, reason: '', actor: MANAGER })).rejects.toThrow()
    const no = await S.rejectRequest({ id: pr.id, reason: 'budget', actor: MANAGER })
    expect(no).toMatchObject({ status: 'rejected', rejectReason: 'budget', rejectedBy: MANAGER.id, rejectedByName: 'Manager A' })
    expect(no.rejectedAt).toBeGreaterThan(0)
    await expect(S.approveRequest({ id: pr.id, ctx, actor: MANAGER })).rejects.toThrow()
  })

  test('approving is signed, locks the request, and refuses a line with nothing approved', async () => {
    const pr = await pending()
    await expect(S.approveRequest({ id: pr.id, ctx, actor: STAFF })).rejects.toThrow()
    const ok = await S.approveRequest({ id: pr.id, note: 'go', ctx, actor: MANAGER })
    expect(ok).toMatchObject({ status: 'approved', approvedBy: MANAGER.id, approvedByName: 'Manager A', approvalNote: 'go' })
    expect(ok.approvedAt).toBeGreaterThan(0)
    expect(isReadyForOrder(ok)).toBe(true)
    await expect(S.setApprovedQty({ id: pr.id, idx: 0, qty: 1, actor: MANAGER })).rejects.toThrow()
    await expect(S.addItem({ id: pr.id, line: { productId: 'p-coke', supplierId: 's-thai', qty: 1 }, products, suppliers, actor: ADMIN })).rejects.toThrow()

    // A hidden supplier at approval time is a blocking error, not a silent order to nobody.
    const other = await pending()
    const ctxHidden = { ...ctx, suppliers: suppliers.map((s) => (s.id === 's-ack' ? { ...s, active: false } : s)) }
    await expect(S.approveRequest({ id: other.id, ctx: ctxHidden, actor: MANAGER })).rejects.toThrow(/ผู้ขาย/)
  })

  test('only an admin reopens an approved or rejected request, with a reason, on the record', async () => {
    const pr = await pending()
    await S.approveRequest({ id: pr.id, ctx, actor: MANAGER })
    await expect(S.reopenRequest({ id: pr.id, reason: 'oops', actor: MANAGER })).rejects.toThrow()
    const re = await S.reopenRequest({ id: pr.id, reason: 'oops', actor: ADMIN })
    expect(re.status).toBe('pendingApproval')
    expect(re.approvedBy).toBeUndefined()
    expect(re.history.at(-1)).toMatchObject({ action: 'reopened', oldValue: 'approved', newValue: 'oops' })
  })
})

describe('the acceptance scenario', () => {
  test('RED OAK 5 → 3, ROCKET 3, COKE CAN 5, manager adds COKE ZERO 5 → two orders, once', async () => {
    // Employee creates
    let pr = await draftWith([
      { productId: 'p-redoak', supplierId: 's-ack', qty: 5 },
      { productId: 'p-rocket', supplierId: 's-ack', qty: 3 },
      { productId: 'p-coke', supplierId: 's-thai', qty: 5 },
    ])
    expect(new Set(pr.items.map((i) => i.supplierName)).size).toBe(2)
    expect(pr.items).toHaveLength(3)
    pr = await S.submitRequest({ id: pr.id, ctx, actor: STAFF })

    // Manager reviews
    pr = await S.setApprovedQty({ id: pr.id, idx: 0, qty: 3, actor: MANAGER })
    pr = await S.addItem({ id: pr.id, line: { productId: 'p-zero', supplierId: 's-thai', qty: 5 }, products, suppliers, actor: MANAGER })
    pr = await S.approveRequest({ id: pr.id, ctx, actor: MANAGER })

    // Final request keeps both numbers on every line
    const summary = pr.items.map((i) => `${i.supplierName} ${i.productName} req=${i.requestedQty} appr=${i.approvedQty}${i.managerAdded ? ' (mgr)' : ''}`)
    expect(summary).toEqual([
      'ACK RED OAK SALAD req=5 appr=3',
      'ACK ROCKET SALAD req=3 appr=3',
      'THAINAMTHIP COKE CAN 325 ML 1X24 req=5 appr=5',
      'THAINAMTHIP COKE ZERO CAN 325 ML 1X24 req=null appr=5 (mgr)',
    ])

    // Export is recorded
    pr = await S.noteExport(pr.id, 'pdf', MANAGER)
    expect(pr.history.at(-1)).toMatchObject({ action: 'exported', detail: 'pdf' })

    // Convert
    pr = await S.convertToOrders({ id: pr.id, products, actor: STAFF })
    expect(pr.status).toBe('poCreated')
    expect(pr.orders!.map((o) => `${o.supplierName} → ${o.docNo}`)).toEqual(['ACK → PO-00001', 'THAINAMTHIP → PO-00001'])
    const all = orders()
    expect(all).toHaveLength(2)
    expect(all.every((o) => o.status === 'ordered' && o.requestId === pr.id && o.locationId === MAIN)).toBe(true)
    const ack = all.find((o) => o.supplierName === 'ACK')!
    expect(ack.lines.map((l) => [l.productName, l.orderedQty])).toEqual([['RED OAK SALAD', 3], ['ROCKET SALAD', 3]])
    const thai = all.find((o) => o.supplierName === 'THAINAMTHIP')!
    expect(thai.lines.map((l) => [l.productName, l.orderedQty, l.unit])).toEqual([['COKE CAN 325 ML 1X24', 5, 'Pack'], ['COKE ZERO CAN 325 ML 1X24', 5, 'Pack']])
    expect(pr.history.at(-1)).toMatchObject({ action: 'convertedToPo' })

    // Once only: a second press hands back the same orders and writes nothing (plan A6)
    const again = await S.convertToOrders({ id: pr.id, products, actor: STAFF })
    expect(again.orders).toEqual(pr.orders)
    expect(again.history).toHaveLength(pr.history.length)
    expect(orders()).toHaveLength(2)
    expect(isReadyForOrder(pr)).toBe(false)
    expect(requests()).toHaveLength(1)
  })

  test('a request cannot be converted before approval, and a removed line is left out', async () => {
    let pr = await draftWith([
      { productId: 'p-redoak', supplierId: 's-ack', qty: 5 },
      { productId: 'p-coke', supplierId: 's-thai', qty: 5 },
    ])
    await expect(S.convertToOrders({ id: pr.id, products, actor: STAFF })).rejects.toThrow()
    pr = await S.submitRequest({ id: pr.id, ctx, actor: STAFF })
    await expect(S.convertToOrders({ id: pr.id, products, actor: STAFF })).rejects.toThrow()
    pr = await S.removeItem({ id: pr.id, idx: 1, reason: 'enough in stock', actor: MANAGER })
    pr = await S.approveRequest({ id: pr.id, ctx, actor: MANAGER })
    pr = await S.convertToOrders({ id: pr.id, products, actor: MANAGER })
    expect(pr.orders!.map((o) => o.supplierName)).toEqual(['ACK'])
    expect(orders()).toHaveLength(1)
  })
})

describe('idempotent conversion (plan A6, 6 Oct 2026)', () => {
  async function approved(lines = [
    { productId: 'p-redoak', supplierId: 's-ack', qty: 5 },
    { productId: 'p-coke', supplierId: 's-thai', qty: 5 },
  ]) {
    const pr = await draftWith(lines)
    await S.submitRequest({ id: pr.id, ctx, actor: STAFF })
    return S.approveRequest({ id: pr.id, ctx, actor: MANAGER })
  }

  test('each supplier\'s order is filed under the request and the supplier, signed by the run', async () => {
    const pr = await S.convertToOrders({ id: (await approved()).id, products, actor: STAFF })
    expect(pr.orders!.map((o) => o.poId).sort()).toEqual([`po_${pr.id}_s-ack`, `po_${pr.id}_s-thai`])
    expect(orders().map((o) => o.id).sort()).toEqual([`po_${pr.id}_s-ack`, `po_${pr.id}_s-thai`])
    const last = pr.history.at(-1)!
    expect(last).toMatchObject({ action: 'convertedToPo', by: STAFF.id })
    expect(last.runId).toMatch(/\w+/)
  })

  test('the numbers continue each supplier\'s own counter', async () => {
    seed('counters', [{ id: 'purchaseOrder__s-ack', value: 7 }])
    const pr = await S.convertToOrders({ id: (await approved()).id, products, actor: STAFF })
    expect(Object.fromEntries(pr.orders!.map((o) => [o.supplierId, o.docNo]))).toEqual({ 's-ack': 'PO-00008', 's-thai': 'PO-00001' })
    expect((raw('counters') as { id: string; value: number }[]).find((c) => c.id === 'purchaseOrder__s-ack')?.value).toBe(8)
  })

  test('a line that cannot be ordered stops the whole conversion: no order, request still approved', async () => {
    const pr = await approved()
    // THAINAMTHIP's product has gone — from the screen's list and from the database.
    await memoryBackend.forBrand('pizza').remove('products', 'p-coke')
    await expect(S.convertToOrders({ id: pr.id, products: products.filter((p) => p.id !== 'p-coke'), actor: STAFF })).rejects.toThrow()
    expect(orders()).toHaveLength(0)
    expect(requests()[0].status).toBe('approved')
    expect(raw('counters').filter((c) => String(c.id).startsWith('purchaseOrder__'))).toHaveLength(0)
    // …and it converts cleanly once the product is back.
    seed('products', products.filter((p) => p.id === 'p-coke') as unknown as Record<string, unknown>[])
    const done = await S.convertToOrders({ id: pr.id, products, actor: STAFF })
    expect(done.orders).toHaveLength(2)
  })

  test('an order left by an old half-finished conversion stops it, naming the order', async () => {
    const pr = await approved()
    seed('purchaseOrders', [{ id: 'legacy-1', docNo: 'PO-00003', supplierId: 's-ack', supplierName: 'ACK', status: 'ordered', requestId: pr.id, locationId: MAIN, lines: [], orderedAt: 1, createdAt: 1, updatedAt: 1 }])
    await expect(S.convertToOrders({ id: pr.id, products, actor: MANAGER })).rejects.toThrow(/PO-00003/)
    expect(orders()).toHaveLength(1)
    // A cancelled leftover does not count.
    seed('purchaseOrders', [{ id: 'legacy-1', docNo: 'PO-00003', supplierId: 's-ack', supplierName: 'ACK', status: 'cancelled', requestId: pr.id, locationId: MAIN, lines: [], orderedAt: 1, createdAt: 1, updatedAt: 1 }])
    expect((await S.convertToOrders({ id: pr.id, products, actor: MANAGER })).status).toBe('poCreated')
  })

  test('the admin\'s repair takes over the leftover and creates only what is missing', async () => {
    const pr = await approved()
    seed('purchaseOrders', [{ id: 'legacy-1', docNo: 'PO-00003', supplierId: 's-ack', supplierName: 'ACK', status: 'ordered', requestId: pr.id, locationId: MAIN, lines: [], orderedAt: 1, createdAt: 1, updatedAt: 1 }])
    const [stuck] = await S.listStuckConversions()
    expect(stuck.request.id).toBe(pr.id)
    const plan = repairPlan(stuck)
    expect(plan).toMatchObject({ adopt: { 's-ack': 'legacy-1' }, blockers: [] })
    expect(plan.missing.map((g) => g.supplierId)).toEqual(['s-thai'])

    await expect(S.convertToOrders({ id: pr.id, products, actor: MANAGER, adopt: plan.adopt })).rejects.toThrow()
    const done = await S.convertToOrders({ id: pr.id, products, actor: ADMIN, adopt: plan.adopt })
    expect(done.orders!.map((o) => [o.supplierId, o.poId, o.docNo])).toEqual([
      ['s-ack', 'legacy-1', 'PO-00003'],
      ['s-thai', `po_${pr.id}_s-thai`, 'PO-00001'],
    ])
    expect(orders()).toHaveLength(2)
    expect(done.history.at(-1)!.detail).toContain('(ใบเดิม)')
    expect(await S.listStuckConversions()).toEqual([])
  })

  test('two leftovers for one supplier, or one for a supplier no longer on the request, must be cancelled first', () => {
    const base = { status: 'ordered', requestId: 'r1', locationId: MAIN, lines: [], orderedAt: 1, createdAt: 1, updatedAt: 1 }
    const request = { id: 'r1', status: 'approved', items: [{ idx: 0, productId: 'p-redoak', supplierId: 's-ack', supplierName: 'ACK', approvedQty: 3 }] } as unknown as PurchaseRequest
    const plan = repairPlan({
      request,
      orders: [
        { ...base, id: 'a', docNo: 'PO-00001', supplierId: 's-ack', supplierName: 'ACK' },
        { ...base, id: 'b', docNo: 'PO-00002', supplierId: 's-ack', supplierName: 'ACK' },
        { ...base, id: 'c', docNo: 'PO-00009', supplierId: 's-thai', supplierName: 'THAINAMTHIP' },
      ] as unknown as PurchaseOrder[],
    })
    expect(plan.blockers).toEqual([
      { kind: 'duplicate', supplierName: 'ACK', docNos: ['PO-00001', 'PO-00002'] },
      { kind: 'notInRequest', supplierName: 'THAINAMTHIP', docNo: 'PO-00009' },
    ])
  })
})

describe('urgency (owner, 22 Sep 2026)', () => {
  test('starts normal, the requester sets it while drafting, and every change is in the history', async () => {
    const pr = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 5 }])
    expect(pr.items[0].urgency).toBeUndefined()
    const next = await S.setItemUrgency({ id: pr.id, idx: pr.items[0].idx, urgency: 'urgent', actor: STAFF })
    expect(next.items[0].urgency).toBe('urgent')
    expect(next.history.at(-1)).toMatchObject({ action: 'urgencyChanged', oldValue: 'normal', newValue: 'urgent', by: STAFF.id })
    // Back to normal is stored as nothing, like a request from before this existed.
    const back = await S.setItemUrgency({ id: pr.id, idx: pr.items[0].idx, urgency: 'normal', actor: STAFF })
    expect('urgency' in back.items[0]).toBe(false)
  })

  test('a manager sets it during review; the requester cannot once it is submitted; nonsense is refused', async () => {
    const pr = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 5 }])
    const sent = await S.submitRequest({ id: pr.id, ctx, actor: STAFF })
    await expect(S.setItemUrgency({ id: sent.id, idx: sent.items[0].idx, urgency: 'critical', actor: STAFF })).rejects.toThrow()
    const byManager = await S.setItemUrgency({ id: sent.id, idx: sent.items[0].idx, urgency: 'critical', actor: MANAGER })
    expect(byManager.items[0].urgency).toBe('critical')
    await expect(S.setItemUrgency({ id: sent.id, idx: sent.items[0].idx, urgency: 'soon' as never, actor: MANAGER })).rejects.toThrow()
  })
})

describe('setting a request aside (owner, 25 Sep 2026)', () => {
  test('a draft nobody will finish is skipped with a reason, signed, and final', async () => {
    const pr = await S.createRequest({ locationId: MAIN, actor: STAFF })
    await expect(S.skipRequest({ id: pr.id, reason: '  ', actor: STAFF })).rejects.toThrow()
    const skipped = await S.skipRequest({ id: pr.id, reason: 'ระบบค้างตอนโควตาเต็ม — ทำใบใหม่แทน', actor: STAFF })
    expect(skipped).toMatchObject({ status: 'skipped', skipReason: 'ระบบค้างตอนโควตาเต็ม — ทำใบใหม่แทน', skippedBy: STAFF.id, skippedByName: 'AA' })
    expect(skipped.history.at(-1)).toMatchObject({ action: 'skipped', oldValue: 'draft', by: STAFF.id })
    // Final: not skipped twice, not submitted, not edited.
    await expect(S.skipRequest({ id: pr.id, reason: 'again', actor: STAFF })).rejects.toThrow()
    await expect(S.submitRequest({ id: pr.id, ctx: { ...ctx, qtyAt: () => 0 }, actor: STAFF })).rejects.toThrow()
    await expect(S.setRequestHeader({ id: pr.id, note: 'x', actor: STAFF })).rejects.toThrow()
    expect(requests()).toHaveLength(1) // still on the books
  })

  test('only the requester or a หัวหน้า/admin may skip, and only before review', async () => {
    const pr = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 2 }])
    await expect(S.skipRequest({ id: pr.id, reason: 'x', actor: OTHER_STAFF })).rejects.toThrow()
    await S.submitRequest({ id: pr.id, ctx: { ...ctx, qtyAt: () => 0 }, actor: STAFF })
    // Under review it is the manager's to return or reject, not to skip.
    await expect(S.skipRequest({ id: pr.id, reason: 'x', actor: MANAGER })).rejects.toThrow()
    await S.returnRequest({ id: pr.id, reason: 'fix', actor: MANAGER })
    const skipped = await S.skipRequest({ id: pr.id, reason: 'no longer needed', actor: MANAGER })
    expect(skipped).toMatchObject({ status: 'skipped', skippedBy: MANAGER.id })
  })

  test('the new-request warning lists only this person\'s drafts and returned requests, newest first', () => {
    const base = { requestedBy: STAFF.id, createdAt: 1 } as PurchaseRequest
    const rows = [
      { ...base, id: 'a', status: 'draft', createdAt: 1 },
      { ...base, id: 'b', status: 'returned', createdAt: 3 },
      { ...base, id: 'c', status: 'pendingApproval', createdAt: 4 },
      { ...base, id: 'd', status: 'skipped', createdAt: 5 },
      { ...base, id: 'e', status: 'draft', requestedBy: OTHER_STAFF.id, createdAt: 6 },
    ] as PurchaseRequest[]
    expect(S.ownOpenDrafts(rows, STAFF.id).map((r) => r.id)).toEqual(['b', 'a'])
  })

  test('the status machine: skipped only from draft or returned, and nowhere from there', () => {
    expect(canTransition('draft', 'skipped')).toBe(true)
    expect(canTransition('returned', 'skipped')).toBe(true)
    expect(canTransition('pendingApproval', 'skipped')).toBe(false)
    expect(canTransition('approved', 'skipped')).toBe(false)
    expect(canTransition('skipped', 'draft')).toBe(false)
    expect(canTransition('skipped', 'pendingApproval')).toBe(false)
    expect(canEditItems({ status: 'skipped', requestedBy: STAFF.id }, STAFF)).toBe(false)
    expect(canEditItems({ status: 'skipped', requestedBy: STAFF.id }, ADMIN)).toBe(false)
  })
})

describe('converting before the catalogue has loaded (6 Oct 2026)', () => {
  test('a product missing from the screen\'s list is read inside the conversion', async () => {
    let pr = await draftWith([{ productId: 'p-redoak', supplierId: 's-ack', qty: 2 }])
    pr = await S.submitRequest({ id: pr.id, ctx, actor: STAFF })
    pr = await S.approveRequest({ id: pr.id, ctx, actor: MANAGER })
    const done = await S.convertToOrders({ id: pr.id, products: [], actor: STAFF })
    expect(done.status).toBe('poCreated')
    expect(orders()[0].lines.map((l) => [l.productName, l.orderedQty])).toEqual([['RED OAK SALAD', 2]])
  })
})

describe('D4′: one workflow, several intake channels', () => {
  const line = (productId: string, supplierId: string, qty = 2) => ({ productId, supplierId, qty })

  test('each channel is recorded once, in first-use order; older requests without it read as manual', async () => {
    let pr = await S.createRequest({ locationId: MAIN, actor: STAFF })
    expect(pr.intake).toBeUndefined()
    pr = await S.addItems({ id: pr.id, lines: [line('p-redoak', 's-ack')], products, suppliers, actor: STAFF, source: 'order.xlsx · Sheet1' })
    expect(pr.intake).toEqual(['excel'])
    pr = await S.addItems({ id: pr.id, lines: [line('p-coke', 's-thai')], products, suppliers, actor: STAFF, source: 'bill.jpg · ACK', intake: 'ocr' })
    pr = await S.addItem({ id: pr.id, line: line('p-zero', 's-thai'), products, suppliers, actor: STAFF })
    pr = await S.addItems({ id: pr.id, lines: [line('p-redoak', 's-ack', 1)], products, suppliers, actor: STAFF, source: 'order2.xlsx · Sheet1' })
    expect(pr.intake).toEqual(['excel', 'ocr', 'manual'])
    expect(requests()[0].intake).toEqual(['excel', 'ocr', 'manual'])
    expect(pr.history.filter((h) => h.action === 'itemsImported').map((h) => h.detail)).toEqual(['order.xlsx · Sheet1 · 1', 'bill.jpg · ACK · 1', 'order2.xlsx · Sheet1 · 1'])
  })

  test('a system suggestion is a channel, not an approval: the request is still a draft for a person to send', async () => {
    let pr = await S.createRequest({ locationId: MAIN, actor: STAFF, intake: 'suggestion' })
    pr = await S.addItems({ id: pr.id, lines: [line('p-redoak', 's-ack')], products, suppliers, actor: STAFF, intake: 'suggestion' })
    expect(pr.intake).toEqual(['suggestion'])
    expect(pr.status).toBe('draft')
    expect(raw('purchaseOrders')).toHaveLength(0)
  })

  test('an Excel request goes through the same approval and orders as any other', async () => {
    let pr = await S.createRequest({ locationId: MAIN, actor: STAFF })
    pr = await S.addItems({ id: pr.id, lines: [line('p-redoak', 's-ack'), line('p-coke', 's-thai')], products, suppliers, actor: STAFF, source: 'order.xlsx · R1' })
    await expect(S.approveRequest({ id: pr.id, ctx, actor: MANAGER })).rejects.toThrow()
    await S.submitRequest({ id: pr.id, ctx, actor: STAFF })
    await expect(S.approveRequest({ id: pr.id, ctx, actor: STAFF })).rejects.toThrow()
    const done = await S.approveRequest({ id: pr.id, ctx, actor: MANAGER })
    expect(done.intake).toEqual(['excel'])
    expect(done.status === 'approved' || done.status === 'poCreated').toBe(true)
  })
})
