// Ordering from a supplier, and checking the delivery in against the order.
//
//   npm test
//
// The rules the owner set for receiving, which are the reason this file exists:
//
//   "ทุกช่องต้องมีช่องเช็คลิสต์ว่าปริมาณถูกต้องไหม ถ้าปริมาณที่ส่งมาไม่ถูกต้องต้องมีจุดให้แก้ไข
//    ... ต้องมีช่องเขียนหมายเหตุว่าเพราะอะไรทำไมถึงของมาไม่ครบ และก่อนจะกดโหลดเข้าคลัง
//    หลังบ้านจะต้องให้ระบุเลข voice ของบิลนั้น เหมือนกับการที่เราคีย์รับเข้าวันนี้"
//
// They are enforced in the service rather than only in the form, because the form is client
// code and this is the moment stock becomes real.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw, memoryBackend } = await import('./helpers/memory-backend')
const {
  CHASE_AFTER_DAYS,
  amendPurchaseOrder,
  approvePurchaseOrder,
  createPurchaseOrder,
  setShareStatus,
  daysWaiting,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  listOrdersInRange,
  needsResend,
  overdueOrders,
  receivePurchaseOrder,
  repairReceivedDates,
  summariseBySupplier,
} = await import('../src/services/purchaseOrders')
const { setActiveBrand } = await import('../src/brand/brand')
import type { Product, PurchaseOrder } from '../src/types'

const ACTOR = { id: 'uid-staff', name: 'Staff' }
const MAIN = 'loc-main'
const SUPPLIER = { id: 'sup-1', name: 'OLIVA' }

const products: Product[] = [
  { id: 'p1', sku: 'A-1', name: 'ANCHOVIES (OLIVA)', category: 'C', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1, unitConversions: [{ label: 'Pack', size: 2 }] },
  { id: 'p2', sku: 'A-2', name: 'OLIVES (OLIVA)', category: 'C', unit: 'Each', unitType: 'EA', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
  { id: 'p3', sku: 'A-3', name: 'CAPERS (OLIVA)', category: 'C', unit: 'Each', unitType: 'EA', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
]

function seedWorld() {
  seed('products', products as unknown as Record<string, unknown>[])
  seed('locations', [
    { id: MAIN, name: 'คลังหลัก', type: 'warehouse', active: true, createdAt: 1 },
  ])
}

const orders = () => raw('purchaseOrders') as unknown as PurchaseOrder[]
const movements = () => raw('stockMovements') as Record<string, unknown>[]
const balance = (productId: string) =>
  ((raw('stockLevels').find((d) => d.id === `${MAIN}__${productId}`)?.qty as number) ?? 0)

async function placeOrder(
  lines: { productId: string; qty: number; entryUnit?: string }[] = [
    { productId: 'p1', qty: 10 },
    { productId: 'p2', qty: 5 },
  ],
) {
  return createPurchaseOrder({
    supplier: SUPPLIER,
    locationId: MAIN,
    lines,
    products,
    actor: ACTOR,
  })
}

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  seedWorld()
})

describe('placing an order', () => {
  test('it is numbered, and names the supplier it went to', async () => {
    await placeOrder()
    const [o] = orders()
    expect(o.docNo).toBe('PO-00001')
    expect(o.supplierName).toBe('OLIVA')
    expect(o.status).toBe('ordered')
    expect(o.lines).toHaveLength(2)
  })

  test('the numbers run on, so two orders are never the same document', async () => {
    await placeOrder()
    await placeOrder()
    expect(orders().map((o) => o.docNo).sort()).toEqual(['PO-00001', 'PO-00002'])
  })

  // The owner's rule: the numbers belong to the supplier. HOMEMADE CHEESE's first order is
  // PO-00001 whatever anyone else has ordered, and its second is PO-00002. One shared
  // counter gave the eighth order of the day PO-00008 for a supplier ordered from once.
  test('each supplier counts its own orders from one', async () => {
    await placeOrder()
    await placeOrder()
    await createPurchaseOrder({
      supplier: { id: 'sup-2', name: 'HOMEMADE CHEESE' },
      locationId: MAIN,
      lines: [{ productId: 'p3', qty: 1 }],
      products,
      actor: ACTOR,
    })
    const by = (name: string) => orders().filter((o) => o.supplierName === name).map((o) => o.docNo).sort()
    expect(by('OLIVA')).toEqual(['PO-00001', 'PO-00002'])
    expect(by('HOMEMADE CHEESE')).toEqual(['PO-00001'])
  })

  test('until the old numbers are put right, a new order never repeats one', async () => {
    // Orders from the old shared counter carry numbers like PO-00008 for a supplier
    // ordered from once. Without renumbering, the next order continues past them — the
    // same number twice would be a filing error. This is exactly what the owner saw as
    // BETAGRO PO-00005 → PO-00006 on 15 Sep, and why renumbering exists (next test).
    seed('purchaseOrders', [
      {
        id: 'old-1', docNo: 'PO-00008', supplierId: SUPPLIER.id, supplierName: SUPPLIER.name,
        status: 'ordered', locationId: MAIN, orderedAt: 1, lines: [], createdBy: 'x',
        createdByName: 'x', createdAt: 1, updatedAt: 1,
      },
    ])
    await placeOrder()
    expect(orders().map((o) => o.docNo).sort()).toEqual(['PO-00008', 'PO-00009'])
  })

  test('renumbering gives every supplier 1, 2, 3 in the order they ordered, and resets the counters', async () => {
    const legacy = (id: string, docNo: string, supplierId: string, supplierName: string, orderedAt: number) => ({
      id, docNo, supplierId, supplierName, status: 'ordered', locationId: MAIN, orderedAt, lines: [],
      createdBy: 'x', createdByName: 'x', createdAt: orderedAt, updatedAt: orderedAt,
    })
    seed('purchaseOrders', [
      legacy('b5', 'PO-00005', 'sup-b', 'BETAGRO', 100),
      legacy('t4', 'PO-00004', 'sup-t', 'TGM', 90),
      legacy('t6', 'PO-00006', 'sup-t', 'TGM', 95),
      legacy('b6', 'PO-00006', 'sup-b', 'BETAGRO', 200),
      legacy('n1', 'PO-00001', 'sup-n', 'NEXTECH', 50),
    ])
    seed('counters', [{ id: 'purchaseOrder__sup-b', value: 6 }, { id: 'purchaseOrder__sup-t', value: 6 }])

    const { renumberPlan, renumberOrdersPerSupplier } = await import('../src/services/purchaseOrders')
    const plan = renumberPlan(orders())
    expect(plan.changes.map((c) => `${c.supplierName} ${c.from}→${c.to}`).sort()).toEqual([
      'BETAGRO PO-00005→PO-00001',
      'BETAGRO PO-00006→PO-00002',
      'TGM PO-00004→PO-00001',
      'TGM PO-00006→PO-00002',
    ])
    expect(plan.counters.get('purchaseOrder__sup-n')).toBe(1)

    const { changed, failed } = await renumberOrdersPerSupplier()
    expect(changed).toHaveLength(4)
    expect(failed).toEqual([])
    const by = (name: string) =>
      orders().filter((o) => o.supplierName === name).sort((a, b) => a.orderedAt - b.orderedAt).map((o) => o.docNo)
    expect(by('BETAGRO')).toEqual(['PO-00001', 'PO-00002'])
    expect(by('TGM')).toEqual(['PO-00001', 'PO-00002'])
    expect(by('NEXTECH')).toEqual(['PO-00001'])
    const counter = (id: string) => (raw('counters').find((c) => c.id === id) as { value: number } | undefined)?.value
    expect(counter('purchaseOrder__sup-b')).toBe(2)
    expect(counter('purchaseOrder__sup-t')).toBe(2)
    expect(counter('purchaseOrder__sup-n')).toBe(1)

    // And the next BETAGRO order is its third, not its seventh.
    await createPurchaseOrder({
      supplier: { id: 'sup-b', name: 'BETAGRO' }, locationId: MAIN,
      lines: [{ productId: 'p1', qty: 1 }], products, actor: ACTOR,
    })
    expect(by('BETAGRO')).toEqual(['PO-00001', 'PO-00002', 'PO-00003'])
    // Running it again changes nothing.
    expect(await renumberOrdersPerSupplier()).toEqual({ changed: [], failed: [] })
  })

  test('each line records the product name and unit as they were', async () => {
    // Denormalised for the same reason a movement is: the order has to read correctly after
    // the catalogue has moved on.
    await placeOrder()
    expect(orders()[0].lines[0]).toMatchObject({
      productId: 'p1',
      productName: 'ANCHOVIES (OLIVA)',
      unit: 'KG',
      orderedQty: 10,
    })
  })

  test('a line with no quantity is not an order for it', async () => {
    await placeOrder([{ productId: 'p1', qty: 4 }, { productId: 'p2', qty: 0 }])
    expect(orders()[0].lines).toHaveLength(1)
  })

  test('an order with nothing on it is refused', async () => {
    await expect(placeOrder([{ productId: 'p1', qty: 0 }])).rejects.toThrow()
  })

  test('nothing has moved in the warehouse yet', async () => {
    // An order is a promise. The ledger stays a record of fact.
    await placeOrder()
    expect(movements()).toHaveLength(0)
    expect(balance('p1')).toBe(0)
  })
})

// The order is keyed in whatever unit the supplier sells by — the same list the receiving
// screen offers — and the supplier's sheet says that unit. Since 20 Sep 2026 the line also
// carries the quantity in the product's own unit at the rate the product had when the
// order was placed, and the receipt converts at that same rate, so the goods land on the
// one balance and a rate corrected later cannot skew a delivery already promised.
describe("ordering in a unit other than the product's own", () => {
  test('the unit chosen is kept on the line with its base equivalent, and only when it differs', async () => {
    await placeOrder([
      { productId: 'p1', qty: 3, entryUnit: 'Pack' },
      { productId: 'p2', qty: 5, entryUnit: 'EA' }, // p2's own unit, spelled the same
      { productId: 'p3', qty: 2, entryUnit: 'ea' }, // p3's own unit, spelled differently
    ])
    const [l1, l2, l3] = orders()[0].lines
    expect(l1).toMatchObject({ unit: 'KG', entryUnit: 'Pack', orderedQty: 3, baseQty: 6 })
    expect(l2).toMatchObject({ unit: 'EA', orderedQty: 5 })
    expect('entryUnit' in l2).toBe(false)
    expect('baseQty' in l2).toBe(false)
    expect('entryUnit' in l3).toBe(false)
  })

  test('a unit the product has no rate for cannot be ordered', async () => {
    await expect(placeOrder([{ productId: 'p2', qty: 3, entryUnit: 'Carton' }])).rejects.toThrow(/Carton/)
  })

  test('receiving converts at the rate the order was placed at, not today\'s', async () => {
    const id = await placeOrder([{ productId: 'p1', qty: 3, entryUnit: 'Pack' }]) // 3 Pack = 6 KG then
    // The owner corrects the product afterwards: a Pack is 5 KG now. The order said 2.
    await memoryBackend.update('products', 'p1', { unitConversions: [{ label: 'Pack', size: 5 }] })
    await receivePurchaseOrder({
      orderId: id,
      invoiceNo: 'IV-9100',
      lines: [{ productId: 'p1', receivedQty: 2, checked: false, note: 'one short' }],
      actor: ACTOR,
    })
    expect(movements()[0]).toMatchObject({ unit: 'KG', entryUnit: 'Pack', entryQty: 2, qty: 4 })
    const levels = raw('stockLevels')
    expect(levels.find((d) => d.id === `${MAIN}__p1`)?.qty).toBe(4)
    expect(levels.find((d) => d.id === `${MAIN}__p1#Pack`)).toBeUndefined()
  })

  test('an order line from before the rate existed is received at the product\'s rate, or refused', async () => {
    seed('purchaseOrders', [{
      id: 'old', docNo: 'PO-00009', supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, status: 'ordered', locationId: MAIN, orderedAt: 1,
      lines: [{ productId: 'p2', productName: 'OLIVES (OLIVA)', unit: 'EA', entryUnit: 'Carton', orderedQty: 2 }],
      createdBy: 'x', createdByName: 'x', createdAt: 1, updatedAt: 1,
    }])
    const receive = () => receivePurchaseOrder({ orderId: 'old', invoiceNo: 'IV-1', lines: [{ productId: 'p2', receivedQty: 0, checked: true }], actor: ACTOR })
    await expect(receive()).rejects.toThrow(/Carton/)
    await memoryBackend.update('products', 'p2', { unitConversions: [{ label: 'Carton', size: 24 }] })
    await receive()
    expect(movements()[0]).toMatchObject({ entryUnit: 'Carton', entryQty: 2, qty: 48 })
  })
})

describe('checking the delivery in', () => {
  test('a delivery that matches is ticked through and lands in stock', async () => {
    const id = await placeOrder()
    const result = await receivePurchaseOrder({
      orderId: id,
      invoiceNo: 'IV-9001',
      lines: [
        { productId: 'p1', receivedQty: 0, checked: true },
        { productId: 'p2', receivedQty: 0, checked: true },
      ],
      actor: ACTOR,
    })
    expect(result.receivedLines).toBe(2)
    expect(balance('p1')).toBe(10)
    expect(balance('p2')).toBe(5)
    // Ticked means "what was ordered", without anybody retyping it.
    expect(orders()[0].lines.map((l) => l.receivedQty)).toEqual([10, 5])
  })

  test('the invoice number is required before anything reaches the books', async () => {
    const id = await placeOrder()
    await expect(
      receivePurchaseOrder({
        orderId: id,
        invoiceNo: '   ',
        lines: [
          { productId: 'p1', receivedQty: 0, checked: true },
          { productId: 'p2', receivedQty: 0, checked: true },
        ],
        actor: ACTOR,
      }),
    ).rejects.toThrow()
    expect(movements()).toHaveLength(0)
    expect(orders()[0].status).toBe('ordered')
  })

  test('the invoice number is what the stock receipt is filed under', async () => {
    const id = await placeOrder()
    const { docNo } = await receivePurchaseOrder({
      orderId: id,
      invoiceNo: 'IV-9001',
      lines: [
        { productId: 'p1', receivedQty: 0, checked: true },
        { productId: 'p2', receivedQty: 0, checked: true },
      ],
      actor: ACTOR,
    })
    expect(movements()[0].note).toBe('IV-9001')
    expect(orders()[0].movementDocNo).toBe(docNo)
    expect(orders()[0].invoiceNo).toBe('IV-9001')
  })

  test('a short delivery needs a reason, or it is refused', async () => {
    const id = await placeOrder()
    const short = [
      { productId: 'p1', receivedQty: 7, checked: false },
      { productId: 'p2', receivedQty: 0, checked: true },
    ]
    await expect(
      receivePurchaseOrder({ orderId: id, invoiceNo: 'IV-1', lines: short, actor: ACTOR }),
    ).rejects.toThrow()

    const withReason = [
      { productId: 'p1', receivedQty: 7, checked: false, note: 'ของขาด 3 ลัง' },
      { productId: 'p2', receivedQty: 0, checked: true },
    ]
    await receivePurchaseOrder({ orderId: id, invoiceNo: 'IV-1', lines: withReason, actor: ACTOR })
    expect(balance('p1')).toBe(7)
    expect(orders()[0].lines[0].note).toBe('ของขาด 3 ลัง')
  })

  test('the stock that moves is what arrived, not what was ordered', async () => {
    const id = await placeOrder()
    await receivePurchaseOrder({
      orderId: id,
      invoiceNo: 'IV-1',
      lines: [
        { productId: 'p1', receivedQty: 7, checked: false, note: 'ขาด' },
        { productId: 'p2', receivedQty: 0, checked: false, note: 'ไม่ได้ส่งมา' },
      ],
      actor: ACTOR,
    })
    expect(balance('p1')).toBe(7)
    // Nothing arrived for p2, so no movement claims it did.
    expect(balance('p2')).toBe(0)
    expect(movements()).toHaveLength(1)
  })

  test('a line nobody looked at stops the whole check', async () => {
    const id = await placeOrder()
    await expect(
      receivePurchaseOrder({
        orderId: id,
        invoiceNo: 'IV-1',
        lines: [{ productId: 'p1', receivedQty: 0, checked: true }],
        actor: ACTOR,
      }),
    ).rejects.toThrow()
    expect(movements()).toHaveLength(0)
  })

  test('a delivery where nothing turned up is not a receipt', async () => {
    const id = await placeOrder()
    await expect(
      receivePurchaseOrder({
        orderId: id,
        invoiceNo: 'IV-1',
        lines: [
          { productId: 'p1', receivedQty: 0, checked: false, note: 'ไม่มาเลย' },
          { productId: 'p2', receivedQty: 0, checked: false, note: 'ไม่มาเลย' },
        ],
        actor: ACTOR,
      }),
    ).rejects.toThrow()
    expect(orders()[0].status).toBe('ordered')
  })

  test('it cannot be received twice', async () => {
    const id = await placeOrder()
    const lines = [
      { productId: 'p1', receivedQty: 0, checked: true },
      { productId: 'p2', receivedQty: 0, checked: true },
    ]
    await receivePurchaseOrder({ orderId: id, invoiceNo: 'IV-1', lines, actor: ACTOR })
    await expect(
      receivePurchaseOrder({ orderId: id, invoiceNo: 'IV-2', lines, actor: ACTOR }),
    ).rejects.toThrow()
    expect(balance('p1')).toBe(10)
  })

  test('whoever checked it in is on the record', async () => {
    const id = await placeOrder()
    await receivePurchaseOrder({
      orderId: id,
      invoiceNo: 'IV-1',
      lines: [
        { productId: 'p1', receivedQty: 0, checked: true },
        { productId: 'p2', receivedQty: 0, checked: true },
      ],
      actor: { id: 'uid-nuiy', name: 'Nuiy' },
    })
    expect(orders()[0]).toMatchObject({ receivedBy: 'uid-nuiy', receivedByName: 'Nuiy' })
  })

  test('the order is stamped with the delivery date, the same one the stock receipt is filed under', async () => {
    // Until 17 Sep 2026 the order took Date.now() while the movement took the chosen date,
    // so every receipt sheet said "received today" whatever the delivery note said.
    const id = await placeOrder()
    const delivered = new Date(2026, 8, 12, 0, 0).getTime()
    await receivePurchaseOrder({
      orderId: id,
      invoiceNo: 'IV-1',
      date: delivered,
      lines: [
        { productId: 'p1', receivedQty: 0, checked: true },
        { productId: 'p2', receivedQty: 0, checked: true },
      ],
      actor: ACTOR,
    })
    expect(orders()[0].receivedAt).toBe(delivered)
    expect(movements()[0].date).toBe(delivered)
  })

  test('orders stamped with the keying day are repaired from their stock receipt', async () => {
    const id = await placeOrder()
    const delivered = new Date(2026, 8, 12, 0, 0).getTime()
    await receivePurchaseOrder({
      orderId: id,
      invoiceNo: 'IV-1',
      date: delivered,
      lines: [
        { productId: 'p1', receivedQty: 0, checked: true },
        { productId: 'p2', receivedQty: 0, checked: true },
      ],
      actor: ACTOR,
    })
    // Corrupt it the way the old code did.
    await memoryBackend.update('purchaseOrders', id, { receivedAt: Date.now() })
    expect(await repairReceivedDates()).toEqual({ checked: 1, fixed: 1 })
    expect(orders()[0].receivedAt).toBe(delivered)
    expect(await repairReceivedDates()).toEqual({ checked: 1, fixed: 0 })
  })
})

describe('chasing an order that has not turned up', () => {
  const day = 86_400_000
  const at = (o: Partial<PurchaseOrder>) => ({ status: 'ordered', orderedAt: 0, ...o }) as PurchaseOrder

  test('three days is the line the owner drew', () => {
    expect(CHASE_AFTER_DAYS).toBe(3)
  })

  test('an order still within three days is not chased', () => {
    const now = 10 * day
    expect(overdueOrders([at({ orderedAt: now - 2 * day })], now)).toHaveLength(0)
  })

  test('past three days it is', () => {
    const now = 10 * day
    expect(overdueOrders([at({ orderedAt: now - 4 * day })], now)).toHaveLength(1)
  })

  test('an order already received is never chased, however old', () => {
    const now = 100 * day
    expect(overdueOrders([at({ orderedAt: 0, status: 'received' })], now)).toHaveLength(0)
  })

  test('the screen can say how long it has been waiting', () => {
    const now = 10 * day
    expect(daysWaiting(at({ orderedAt: now - 5 * day }), now)).toBe(5)
  })
})

describe('reading orders back', () => {
  test('a window returns what was ordered in it, newest first', async () => {
    await placeOrder([{ productId: 'p1', qty: 1 }])
    await placeOrder([{ productId: 'p2', qty: 2 }])
    const found = await listOrdersInRange(0, Date.now() + 1000)
    expect(found).toHaveLength(2)
    expect(found[0].orderedAt).toBeGreaterThanOrEqual(found[1].orderedAt)
  })

  test('a backwards window is refused rather than silently empty', async () => {
    await expect(listOrdersInRange(Date.now(), 0)).rejects.toThrow()
  })

  test('the summary answers "who did we order from, and how much"', async () => {
    await placeOrder([{ productId: 'p1', qty: 10 }, { productId: 'p2', qty: 5 }])
    await placeOrder([{ productId: 'p3', qty: 2 }])
    const rows = summariseBySupplier(orders())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ supplierName: 'OLIVA', orders: 2, lines: 3, items: 17 })
  })
})

describe('revising a placed order', () => {
  test('the number stays, the change is numbered, signed and explained', async () => {
    const id = await placeOrder()
    await expect(
      amendPurchaseOrder({ id, lines: [{ productId: 'p1', qty: 12 }], reason: '', products, actor: ACTOR }),
    ).rejects.toThrow()
    const next = await amendPurchaseOrder({
      id,
      lines: [{ productId: 'p1', qty: 12 }, { productId: 'p3', qty: 1 }],
      expectedAt: new Date(2026, 8, 20).getTime(),
      reason: 'ผู้ขายมีของไม่พอ',
      products,
      actor: ACTOR,
    })
    expect(next.docNo).toBe('PO-00001')
    expect(next.revision).toBe(1)
    expect(next.lines.map((l) => [l.productId, l.orderedQty])).toEqual([['p1', 12], ['p3', 1]])
    const [r] = next.revisions!
    expect(r).toMatchObject({ rev: 1, by: ACTOR.id, reason: 'ผู้ขายมีของไม่พอ' })
    expect(r.changes.map((c) => c.kind).sort()).toEqual(['add', 'expectedAt', 'qty', 'remove'])
    expect(orders()[0].revision).toBe(1)
  })

  test('nothing changed is not a revision', async () => {
    const id = await placeOrder()
    await expect(
      amendPurchaseOrder({ id, lines: [{ productId: 'p1', qty: 10 }, { productId: 'p2', qty: 5 }], reason: 'x', products, actor: ACTOR }),
    ).rejects.toThrow()
    expect(orders()[0].revision).toBeUndefined()
  })

  test('a received order is closed', async () => {
    const id = await placeOrder()
    await receivePurchaseOrder({
      orderId: id,
      invoiceNo: 'IV-1',
      lines: [
        { productId: 'p1', receivedQty: 0, checked: true },
        { productId: 'p2', receivedQty: 0, checked: true },
      ],
      actor: ACTOR,
    })
    await expect(amendPurchaseOrder({ id, lines: [{ productId: 'p1', qty: 1 }], reason: 'x', products, actor: ACTOR })).rejects.toThrow()
  })

  test('a revised order that went out before needs sending again', async () => {
    const id = await placeOrder()
    await setShareStatus(id, 'sent', ACTOR, 1)
    const before = orders()[0]
    expect(needsResend(before)).toBe(false)
    await new Promise((r) => setTimeout(r, 2))
    const next = await amendPurchaseOrder({ id, lines: [{ productId: 'p1', qty: 1 }], reason: 'x', products, actor: ACTOR })
    expect(needsResend(next)).toBe(true)
  })
})

describe('cancelling', () => {
  test('an order that never arrived is cancelled with a reason and stays on the books', async () => {
    const id = await placeOrder()
    await expect(cancelPurchaseOrder({ id, reason: '  ', actor: ACTOR })).rejects.toThrow()
    const next = await cancelPurchaseOrder({ id, reason: 'ผู้ขายของหมด', actor: ACTOR })
    expect(next).toMatchObject({ status: 'cancelled', cancelReason: 'ผู้ขายของหมด', cancelledBy: ACTOR.id })
    expect(orders()).toHaveLength(1)
    expect(orders()[0].status).toBe('cancelled')
    await expect(cancelPurchaseOrder({ id, reason: 'again', actor: ACTOR })).rejects.toThrow()
    // A cancelled order is not awaited, and is not something ordered from anyone.
    expect(overdueOrders(orders(), Date.now() + 30 * 86_400_000)).toHaveLength(0)
    expect(summariseBySupplier(orders())).toHaveLength(0)
  })

  test('a placed order cannot be deleted, only a draft', async () => {
    const id = await placeOrder()
    await expect(deletePurchaseOrder(id)).rejects.toThrow()
    expect(orders()).toHaveLength(1)
  })

  test('one that reached the books cannot be', async () => {
    // Deleting it would leave a stock receipt with nothing explaining where it came from.
    const id = await placeOrder()
    await receivePurchaseOrder({
      orderId: id,
      invoiceNo: 'IV-1',
      lines: [
        { productId: 'p1', receivedQty: 0, checked: true },
        { productId: 'p2', receivedQty: 0, checked: true },
      ],
      actor: ACTOR,
    })
    await expect(deletePurchaseOrder(id)).rejects.toThrow()
    await expect(cancelPurchaseOrder({ id, reason: 'x', actor: ACTOR })).rejects.toThrow()
    expect(orders()).toHaveLength(1)
  })
})

// ---- drafts: an order from an imported list is a proposal until approved ----------

describe('a draft order', () => {
  const draft = () =>
    createPurchaseOrder({
      supplier: SUPPLIER,
      locationId: MAIN,
      lines: [{ productId: 'p1', qty: 10 }],
      products,
      actor: ACTOR,
      batchId: 'batch-1',
    })

  test('is born a draft only when it comes from a batch, and carries the batch id', async () => {
    const id = await draft()
    const manual = await placeOrder()
    const byId = (x: string) => orders().find((o) => o.id === x)!
    expect(byId(id)).toMatchObject({ status: 'draft', batchId: 'batch-1' })
    expect(byId(manual).status).toBe('ordered')
    expect('batchId' in byId(manual)).toBe(false)
  })

  test('is not waiting for goods, and cannot be received', async () => {
    const id = await draft()
    const o = orders().find((x) => x.id === id)!
    expect(overdueOrders([{ ...o, orderedAt: 0 }], Date.now())).toEqual([])
    await expect(
      receivePurchaseOrder({ orderId: id, invoiceNo: 'INV-1', lines: [{ productId: 'p1', receivedQty: 10, checked: true }], actor: ACTOR }),
    ).rejects.toThrow(/ร่าง/)
  })

  test('approval places it: status, a fresh orderedAt, and who approved', async () => {
    const id = await draft()
    const before = orders().find((x) => x.id === id)!.orderedAt
    await new Promise((r) => setTimeout(r, 2))
    await approvePurchaseOrder(id, { id: 'uid-boss', name: 'Boss' })
    const o = orders().find((x) => x.id === id)!
    expect(o).toMatchObject({ status: 'ordered', approvedBy: 'uid-boss', approvedByName: 'Boss' })
    expect(o.orderedAt).toBeGreaterThan(before)
    expect(o.approvedAt).toBe(o.orderedAt)
    // Approving twice changes nothing — the second person does not replace the first.
    await approvePurchaseOrder(id, { id: 'uid-other', name: 'Other' })
    expect(orders().find((x) => x.id === id)!.approvedBy).toBe('uid-boss')
  })

  test("still takes the supplier's next number, like any order", async () => {
    await draft()
    const second = await placeOrder()
    expect(orders().find((x) => x.id === second)!.docNo).toBe('PO-00002')
  })
})

describe('where the sheet has got to', () => {
  test('opening the share screen and LINE confirming are two different facts', async () => {
    const id = await placeOrder()
    await setShareStatus(id, 'shareOpened', ACTOR)
    let o = orders().find((x) => x.id === id)!
    expect(o.shareStatus).toBe('shareOpened')
    expect(o.shareOpenedAt).toBeGreaterThan(0)
    expect(o.sentAt).toBeUndefined()

    await setShareStatus(id, 'sent', ACTOR, 2)
    o = orders().find((x) => x.id === id)!
    expect(o).toMatchObject({ shareStatus: 'sent', sentBy: 'uid-staff', sentByName: 'Staff', imageVersion: 2 })
    expect(o.sentAt).toBeGreaterThan(0)
  })
})
