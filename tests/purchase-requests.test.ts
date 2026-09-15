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
const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const S = await import('../src/services/purchaseRequests')
const { canTransition, canEditItems, isReadyForOrder, liveItems } = await import('../src/lib/purchaseRequestStatus')
const { setActiveBrand } = await import('../src/brand/brand')

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

    // Once only
    await expect(S.convertToOrders({ id: pr.id, products, actor: STAFF })).rejects.toThrow()
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
