// Delivery ground truth per purchase order (Supplier Intelligence S1): on time against the
// CONFIRMED date, partial deliveries kept as several facts, old orders measured the same.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { deliveryOutcome, deliveryOutcomes, requestedDateOf } from '../src/lib/deliveryMetrics'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import type { PoReceipt, PurchaseOrder } from '../src/types'

// Monday 6 Oct 2026, start of the Bangkok day.
const D = bkkDayStart(Date.UTC(2026, 9, 6, 3))
const day = (n: number, hhmm = '10:00') => bkkAtTime(D + n * DAY_MS, hhmm)

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po1',
  docNo: 'PO-00001',
  supplierId: 's1',
  supplierName: 'PANFOOD',
  status: 'received',
  locationId: 'onnut',
  orderedAt: day(-3),
  expectedAt: D,
  lines: [{ productId: 'fries', productName: 'French Fries 3/8', unit: 'ctn', orderedQty: 10, receivedQty: 10 }],
  createdBy: 'u',
  createdByName: 'U',
  createdAt: day(-3),
  updatedAt: day(-3),
  ...over,
})
const receipt = (docNo: string, at: number, qty: number, productId = 'fries'): PoReceipt => ({
  docNo,
  date: at,
  invoiceNo: 'IV',
  byId: 'u',
  byName: 'U',
  lines: [{ productId, qty }],
})

describe('one delivery', () => {
  test('on the due day is on time, whatever the hour', () => {
    const o = deliveryOutcome(po({ receipts: [receipt('R1', day(0, '23:30'), 10)] }))
    expect(o).toMatchObject({ deliveryStatus: 'on_time', delayDays: 0, firstDeliveryOnTime: true, fillRate: 1, dueDateFillRate: 1, completed: true })
  })
  test('early', () => {
    expect(deliveryOutcome(po({ receipts: [receipt('R1', day(-1), 10)] }))).toMatchObject({ deliveryStatus: 'early', delayDays: -1 })
  })
  test('one day late; just past midnight Bangkok is the next day', () => {
    const o = deliveryOutcome(po({ receipts: [receipt('R1', day(1, '00:05'), 10)] }))
    expect(o).toMatchObject({ deliveryStatus: 'late', delayDays: 1, firstDeliveryOnTime: false, dueDateFillRate: 0 })
  })
  test('severe delay', () => {
    expect(deliveryOutcome(po({ receipts: [receipt('R1', day(9), 10)] }))).toMatchObject({ deliveryStatus: 'late', delayDays: 9 })
  })
})

describe('the confirmed date is what the supplier is held to', () => {
  test('asked the 6th, supplier proposed the 8th, accepted, delivered the 8th: on time, ask not accepted', () => {
    const o = deliveryOutcome(
      po({
        expectedAt: day(2),
        requestedDeliveryDate: D,
        confirmedDeliveryDate: bkkDayStart(day(2)),
        supplierConfirmationStatus: 'changed',
        deliveryDateHistory: [
          { id: 'h0', at: day(-3), source: 'purchasing', action: 'requested', to: D, byName: 'U' },
          { id: 'h1', at: day(-2), source: 'supplier', action: 'proposed', from: D, to: bkkDayStart(day(2)), byName: 'S' },
          { id: 'h2', at: day(-2), source: 'purchasing', action: 'approved', from: D, to: bkkDayStart(day(2)), byName: 'M' },
        ],
        receipts: [receipt('R1', day(2), 10)],
      }),
    )
    expect(o).toMatchObject({ deliveryStatus: 'on_time', requestedDeliveryDate: D, confirmedDeliveryDate: D + 2 * DAY_MS, requestedAccepted: false, supplierDateChangeCount: 1 })
  })

  test('a refused proposal leaves the asked date standing, and late against it is late', () => {
    const o = deliveryOutcome(
      po({
        requestedDeliveryDate: D,
        supplierConfirmationStatus: 'waiting',
        deliveryDateHistory: [
          { id: 'h1', at: day(-2), source: 'supplier', action: 'proposed', from: D, to: D + 4 * DAY_MS, byName: 'S' },
          { id: 'h2', at: day(-1), source: 'purchasing', action: 'rejected', from: D, to: D + 4 * DAY_MS, byName: 'M', note: 'no' },
        ],
        receipts: [receipt('R1', day(1), 10)],
      }),
    )
    expect(o).toMatchObject({ confirmedDeliveryDate: D, deliveryStatus: 'late', delayDays: 1, requestedAccepted: true })
  })

  test('the first ask survives a purchasing change after the link went out', () => {
    const o = po({
      expectedAt: D + 3 * DAY_MS,
      requestedDeliveryDate: D + 3 * DAY_MS,
      deliveryDateHistory: [
        { id: 'a', at: day(-3), source: 'purchasing', action: 'requested', to: D, byName: 'U' },
        { id: 'b', at: day(-2), source: 'purchasing', action: 'requested', from: D, to: D + 3 * DAY_MS, byName: 'U' },
      ],
    })
    expect(requestedDateOf(o)).toBe(D)
  })
})

describe('partial deliveries are several facts, not one', () => {
  test('10 ordered: 2 on the due day, 8 two days later', () => {
    const o = deliveryOutcome(po({ receipts: [receipt('R1', day(0), 2), receipt('R2', day(2), 8)] }))
    expect(o).toMatchObject({
      firstDeliveryOnTime: true,
      dueDateFillRate: 0.2,
      delayDays: 2,
      deliveryStatus: 'late',
      deliveries: 2,
      fillRate: 1,
      actualFirstReceivedAt: day(0),
      actualFullyReceivedAt: day(2),
    })
  })

  test('closed short is partial; the shortfall is counted', () => {
    const o = deliveryOutcome(
      po({
        lines: [{ productId: 'fries', productName: 'F', unit: 'ctn', orderedQty: 10, receivedQty: 6 }],
        receipts: [receipt('R1', day(0), 6)],
        closedShortAt: day(3),
        closedShortReason: 'out of stock',
      }),
    )
    expect(o).toMatchObject({ deliveryStatus: 'partial', shortQuantity: 4, fillRate: 0.6, delayDays: 0, completed: true })
  })

  test('still owed: open, not finished, no delay yet', () => {
    const o = deliveryOutcome(
      po({
        status: 'ordered',
        lines: [{ productId: 'fries', productName: 'F', unit: 'ctn', orderedQty: 10, receivedQty: 3 }],
        receipts: [receipt('R1', day(0), 3)],
      }),
    )
    expect(o).toMatchObject({ deliveryStatus: 'open', completed: false, delayDays: null, firstDeliveryOnTime: true })
  })

  test('the same receipt recorded twice counts once', () => {
    const o = deliveryOutcome(
      po({
        lines: [{ productId: 'fries', productName: 'F', unit: 'ctn', orderedQty: 10 }],
        receipts: [receipt('R1', day(0), 5), receipt('R1', day(0), 5), receipt('R2', day(1), 5)],
      }),
    )
    expect(o).toMatchObject({ deliveries: 2, deliveryStatus: 'late', delayDays: 1 })
  })

  test('two lines: the order is complete when the last line is', () => {
    const o = deliveryOutcome(
      po({
        lines: [
          { productId: 'fries', productName: 'F', unit: 'ctn', orderedQty: 10 },
          { productId: 'nuggets', productName: 'N', unit: 'ctn', orderedQty: 4 },
        ],
        receipts: [receipt('R1', day(0), 10, 'fries'), receipt('R2', day(3), 4, 'nuggets')],
      }),
    )
    expect(o.lines.map((l) => l.delayDays)).toEqual([0, 3])
    expect(o).toMatchObject({ delayDays: 3, deliveryStatus: 'late', dueDateFillRate: 10 / 14 })
  })
})

describe('orders that predate all of this', () => {
  test('received in one go before receipts were kept', () => {
    const o = deliveryOutcome(po({ receivedAt: day(1), movementDocNo: 'RC-1' }))
    expect(o).toMatchObject({ deliveries: 1, deliveryStatus: 'late', delayDays: 1 })
  })
  test('an older short receipt closed the order: partial', () => {
    const o = deliveryOutcome(
      po({ receivedAt: day(0), lines: [{ productId: 'fries', productName: 'F', unit: 'ctn', orderedQty: 10, receivedQty: 7 }] }),
    )
    expect(o).toMatchObject({ deliveryStatus: 'partial', fillRate: 0.7 })
  })
  test('an amended due date: asked the first, held to the last', () => {
    const o = deliveryOutcome(
      po({
        expectedAt: D + 2 * DAY_MS,
        revision: 1,
        revisions: [{ rev: 1, at: day(-1), by: 'u', byName: 'U', reason: 'supplier asked', changes: [{ kind: 'expectedAt', from: D, to: D + 2 * DAY_MS }] }],
        receipts: [receipt('R1', day(2), 10)],
      }),
    )
    expect(o).toMatchObject({ requestedDeliveryDate: D, confirmedDeliveryDate: D + 2 * DAY_MS, requestedAccepted: false, deliveryStatus: 'on_time' })
  })
  test('never had a due date: undated, kept out of on-time judgements', () => {
    const o = deliveryOutcome(po({ expectedAt: undefined, receipts: [receipt('R1', day(2), 10)] }))
    expect(o).toMatchObject({ dueKnown: false, deliveryStatus: 'undated', delayDays: null, firstDeliveryOnTime: null, dueDateFillRate: null, completed: true })
  })
  test('a line keyed in another unit with no base equivalent is left out of quantities', () => {
    const o = deliveryOutcome(
      po({
        lines: [
          { productId: 'fries', productName: 'F', unit: 'kg', orderedQty: 10, receivedQty: 10 },
          { productId: 'cheese', productName: 'C', unit: 'kg', entryUnit: 'Bag', orderedQty: 3, receivedQty: 3 },
          { productId: 'ham', productName: 'H', unit: 'kg', entryUnit: 'Pack', orderedQty: 2, baseQty: 4, receivedQty: 1 },
        ],
        receipts: [receipt('R1', day(0), 10)],
      }),
    )
    expect(o.orderedQuantity).toBe(14) // 10 + 4, the Bag line left out
    expect(o.receivedQuantity).toBe(12) // 10 + 1×2
  })
})

describe('cancelled, drafts and the supplier response', () => {
  test('cancelled is its own status, with no deliveries', () => {
    expect(deliveryOutcome(po({ status: 'cancelled', receipts: undefined, receivedAt: undefined }))).toMatchObject({ deliveryStatus: 'cancelled', completed: true, deliveries: 0 })
  })
  test('drafts are not deliveries', () => {
    expect(deliveryOutcomes([po({ status: 'draft' }), po({ id: 'po2' })]).map((o) => o.poId)).toEqual(['po2'])
  })
  test('response time runs from the link to the first answer, whatever it was', () => {
    const o = deliveryOutcome(
      po({
        supplierActivity: [
          { id: 'a', at: day(-3, '09:00'), kind: 'linkIssued', byName: 'U' },
          { id: 'b', at: day(-3, '09:20'), kind: 'opened', byName: '' },
          { id: 'c', at: day(-3, '10:30'), kind: 'pendingApproval', byName: 'S', date: D },
          { id: 'd', at: day(-2, '10:30'), kind: 'linkIssued', byName: 'U' },
        ],
      }),
    )
    expect(o.supplierResponseMinutes).toBe(90)
  })
  test('never answered: no response time', () => {
    expect(deliveryOutcome(po({ supplierActivity: [{ id: 'a', at: day(-3), kind: 'linkIssued', byName: 'U' }] })).supplierResponseMinutes).toBeNull()
  })
})
