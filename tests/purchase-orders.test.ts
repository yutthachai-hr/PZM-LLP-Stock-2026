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

const { resetMemory, seed, raw } = await import('./helpers/memory-backend')
const {
  CHASE_AFTER_DAYS,
  createPurchaseOrder,
  daysWaiting,
  deletePurchaseOrder,
  listOrdersInRange,
  overdueOrders,
  receivePurchaseOrder,
  summariseBySupplier,
} = await import('../src/services/purchaseOrders')
const { setActiveBrand } = await import('../src/brand/brand')
import type { Product, PurchaseOrder } from '../src/types'

const ACTOR = { id: 'uid-staff', name: 'Staff' }
const MAIN = 'loc-main'
const SUPPLIER = { id: 'sup-1', name: 'OLIVA' }

const products: Product[] = [
  { id: 'p1', sku: 'A-1', name: 'ANCHOVIES (OLIVA)', category: 'C', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
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

  test('a supplier with orders from before the per-supplier count carries on past them', async () => {
    // Eight orders exist in production under the old shared counter. Their numbers are
    // frozen by the rules and are not rewritten. A supplier whose one order says PO-00008
    // continues at PO-00009 — not PO-00002, which would reach a second PO-00008 seven
    // orders later. A gap is a curiosity; the same number twice is a filing error.
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

// The owner's rule for ordering, once the product's own unit became editable: the order
// is keyed in whatever unit the goods will be received in — the same list the receiving
// screen offers — and an order placed in Pack must arrive in the Pack balance, not be
// silently counted as pieces. The unit travels on the line exactly as it does on a
// movement: `unit` is the product's own, `entryUnit` is present only when someone chose
// something else.
describe("ordering in a unit other than the product's own", () => {
  test('the unit chosen is kept on the line, and only when it differs', async () => {
    await placeOrder([
      { productId: 'p1', qty: 3, entryUnit: 'Pack' },
      { productId: 'p2', qty: 5, entryUnit: 'EA' }, // p2's own unit, spelled the same
      { productId: 'p3', qty: 2, entryUnit: 'ea' }, // p3's own unit, spelled differently
    ])
    const [l1, l2, l3] = orders()[0].lines
    expect(l1).toMatchObject({ unit: 'KG', entryUnit: 'Pack', orderedQty: 3 })
    expect(l2).toMatchObject({ unit: 'EA', orderedQty: 5 })
    expect('entryUnit' in l2).toBe(false)
    expect('entryUnit' in l3).toBe(false)
  })

  test('receiving files the goods under the unit they were ordered in', async () => {
    const id = await placeOrder([{ productId: 'p1', qty: 3, entryUnit: 'Pack' }])
    await receivePurchaseOrder({
      orderId: id,
      invoiceNo: 'IV-9100',
      lines: [{ productId: 'p1', receivedQty: 0, checked: true }],
      actor: ACTOR,
    })
    // The Pack balance, not the KG one: 3 Pack of anchovies is not 3 kg of them.
    expect(movements()[0]).toMatchObject({ unit: 'KG', entryUnit: 'Pack', qty: 3 })
    const levels = raw('stockLevels')
    expect(levels.find((d) => d.id === `${MAIN}__p1#Pack`)?.qty).toBe(3)
    expect(levels.find((d) => d.id === `${MAIN}__p1`)).toBeUndefined()
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

describe('cancelling', () => {
  test('an order that never arrived can be thrown away', async () => {
    const id = await placeOrder()
    await deletePurchaseOrder(id)
    expect(orders()).toHaveLength(0)
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
    expect(orders()).toHaveLength(1)
  })
})
