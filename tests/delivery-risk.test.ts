// Late-delivery risk (S3) and stock-out early warning (S4): every point a reason, levels at
// the configured boundaries, shortages from the shelf + usage + what is really coming.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { deliveryOutcome } from '../src/lib/deliveryMetrics'
import { assessAll, assessDeliveryRisk, levelFor, RISK_ENGINE_VERSION, type DeliveryRisk } from '../src/lib/deliveryRisk'
import { incomingLots, project, shortageRisks, type ShortageInput } from '../src/lib/inventoryRisk'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import type { UsageIndex } from '../src/lib/inventoryRules/usage'
import type { Product, PurchaseOrder, StockLocation, Transfer } from '../src/types'

const NOW = bkkAtTime(bkkDayStart(Date.UTC(2026, 9, 6, 3)), '09:00')
const D = bkkDayStart(NOW)
const day = (n: number) => D + n * DAY_MS

let seq = 0
function open(over: Partial<PurchaseOrder> = {}): PurchaseOrder {
  const id = `open${++seq}`
  return {
    id,
    docNo: `PO-${seq}`,
    supplierId: 'pan',
    supplierName: 'PANFOOD',
    status: 'ordered',
    locationId: 'onnut',
    orderedAt: day(-2),
    expectedAt: day(2),
    lines: [{ productId: 'fries', productName: 'French Fries 3/8', unit: 'ctn', orderedQty: 10 }],
    createdBy: 'u',
    createdByName: 'u',
    createdAt: day(-2),
    updatedAt: day(-2),
    ...over,
  }
}
/** A finished delivery `late` days after its due date, `age` days ago. */
function done(late: number, age = 10, product = 'fries'): PurchaseOrder {
  const due = day(-age)
  const id = `done${++seq}`
  return {
    ...open({ id, expectedAt: due, orderedAt: due - 3 * DAY_MS }),
    status: 'received',
    lines: [{ productId: product, productName: product, unit: 'ctn', orderedQty: 10, receivedQty: 10 }],
    receipts: [{ docNo: `R${id}`, date: due + late * DAY_MS + 3_600_000, invoiceNo: 'i', byId: 'u', byName: 'u', lines: [{ productId: product, qty: 10 }] }],
  }
}
const ctx = (history: PurchaseOrder[]) => ({ now: NOW, history: history.map(deliveryOutcome) })
const codes = (r: DeliveryRisk | null) => r!.reasons.map((x) => x.code)

describe('levels and the result shape', () => {
  test('boundaries 30 / 60 / 80', () => {
    expect([0, 29, 30, 59, 60, 79, 80, 100].map(levelFor)).toEqual(['LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'CRITICAL', 'CRITICAL'])
  })
  test('only open orders have a risk; every result carries its engine version', () => {
    expect(assessDeliveryRisk(done(0), ctx([]))).toBeNull()
    expect(assessDeliveryRisk(open(), ctx([]))!.version).toBe(RISK_ENGINE_VERSION)
  })
})

describe('reasons', () => {
  test('no history for the supplier: said so, scores nothing for it', () => {
    const r = assessDeliveryRisk(open(), ctx([]))!
    expect(r).toMatchObject({ score: 0, level: 'LOW' })
    expect(codes(r)).toEqual(['noHistory'])
  })

  test('a supplier late on most recent deliveries, two of the last three late', () => {
    const r = assessDeliveryRisk(open(), ctx([done(2, 5), done(1, 8), done(0, 12), done(3, 20), done(0, 30)]))!
    expect(codes(r)).toContain('otdBelow80')
    expect(codes(r)).toContain('twoOfLastThreeLate')
    expect(r.score).toBe(45 + 15) // + the SKU reason: fries late 3 of 5
    expect(r.level).toBe('HIGH')
    expect(r.reasons.find((x) => x.code === 'skuLateRate')!.params).toMatchObject({ product: 'French Fries 3/8', pct: 60, avg: 2 })
  })

  test('a reliable supplier, but this SKU is usually late', () => {
    const history = [...Array.from({ length: 8 }, (_, i) => done(0, 5 + i, 'nuggets')), done(2, 20), done(1, 25), done(0, 28)]
    const r = assessDeliveryRisk(open(), ctx(history))!
    expect(codes(r)).toEqual(['skuLateRate', 'otdBelow90'])
  })

  test('the supplier already moved the date, and one waits for approval', () => {
    const o = open({
      supplierConfirmationStatus: 'pending_date_approval',
      deliveryDateHistory: [{ id: 'h', at: day(-1), source: 'supplier', action: 'proposed', from: day(2), to: day(6), byName: 'S' }],
    })
    expect(codes(assessDeliveryRisk(o, ctx([])))).toEqual(expect.arrayContaining(['supplierChangedDate', 'pendingApproval']))
  })

  test('overdue: the strongest reason, growing per day', () => {
    const r1 = assessDeliveryRisk(open({ expectedAt: day(-1) }), ctx([]))!
    const r3 = assessDeliveryRisk(open({ expectedAt: day(-3) }), ctx([]))!
    expect(r1.reasons[0]).toMatchObject({ code: 'overdue', points: 30, params: { days: 1 } })
    expect(r3.reasons[0]).toMatchObject({ code: 'overdue', points: 50 })
    expect(r3.level).toBe('MEDIUM')
  })

  test('overdue alone adds at most 70 — the score is out of 100', () => {
    const r = assessDeliveryRisk(open({ expectedAt: day(-14) }), ctx([]))!
    expect(r.reasons[0]).toMatchObject({ code: 'overdue', points: 70, params: { days: 14 } })
  })

  test('due today is not overdue until the day is over', () => {
    expect(codes(assessDeliveryRisk(open({ expectedAt: D }), ctx([])))).not.toContain('overdue')
  })

  test('less lead time than the supplier normally needs', () => {
    const r = assessDeliveryRisk(open({ orderedAt: day(0), expectedAt: day(1) }), { now: NOW, history: [], supplier: { leadTimeDays: 3 } })!
    expect(r.reasons.find((x) => x.code === 'shortLeadTime')!.params).toEqual({ lead: 1, normal: 3 })
  })

  test('link sent a day ago and no answer: slow confirmation', () => {
    const o = open({ supplierConfirmationStatus: 'waiting', supplierActivity: [{ id: 'a', at: NOW - 30 * 3_600_000, kind: 'linkIssued', byName: 'u' }] })
    expect(assessDeliveryRisk(o, ctx([]))!.reasons.find((x) => x.code === 'slowConfirmation')!.params).toEqual({ hours: 30 })
  })

  test('a date changed after the last calculation changes the next one', () => {
    const o = open({ expectedAt: day(-1) })
    expect(assessDeliveryRisk(o, ctx([]))!.level).toBe('MEDIUM')
    const moved = { ...o, expectedAt: day(4), confirmedDeliveryDate: day(4) }
    expect(assessDeliveryRisk(moved, ctx([]))!.level).toBe('LOW')
  })

  test('the score never passes 100', () => {
    const o = open({
      expectedAt: day(-6),
      supplierConfirmationStatus: 'pending_date_approval',
      deliveryDateHistory: [{ id: 'h', at: day(-1), source: 'supplier', action: 'proposed', byName: 'S' }],
    })
    const r = assessDeliveryRisk(o, ctx([done(2, 5), done(2, 8), done(2, 12)]))!
    expect(r).toMatchObject({ score: 100, level: 'CRITICAL' })
  })

  test('assessAll: open orders only, history from the rest', () => {
    const m = assessAll([open({ id: 'x1' }), done(2, 5), done(2, 6), done(0, 7), { ...open({ id: 'c' }), status: 'cancelled' }], NOW)
    expect([...m.keys()]).toEqual(['x1'])
  })
})

// ---------------------------------------------------------------- S4 -----------------

const fries: Product = { id: 'fries', name: 'French Fries 3/8', unit: 'ctn' } as Product
const loc = (id: string, name: string, type: StockLocation['type'] = 'branch'): StockLocation => ({ id, name, type, active: true }) as StockLocation
const LOCS = [loc('wh', 'คลังหลัก', 'warehouse'), loc('onnut', 'อ่อนนุช'), loc('sukhumvit', 'สุขุมวิท'), loc('transit', 'transit', 'transit')]

function input(over: Partial<ShortageInput> & { stock?: Record<string, number>; daily?: Record<string, number>; min?: number } = {}): ShortageInput {
  const stock = over.stock ?? { onnut: 8 }
  const daily = over.daily ?? { onnut: 3 }
  const usage: UsageIndex = new Map(Object.entries(daily).map(([l, avg]) => [`${l}__fries`, { used: 0, lost: 0, moves: 9, days: 30, avgDaily: avg }]))
  return {
    products: [fries],
    locations: LOCS,
    qtyAt: (l) => stock[l] ?? 0,
    minFor: () => over.min ?? 2,
    tracksProduct: (l) => l in stock || l in daily,
    usage,
    orders: [],
    transfers: [],
    risks: new Map(),
    now: NOW,
    ...over,
  }
}

describe('stock-out before the delivery', () => {
  test('8 on hand, 3 a day, confirmed delivery in 2 days... arrives in time', () => {
    const r = shortageRisks(input({ orders: [open({ expectedAt: day(2), confirmedDeliveryDate: day(2) })] }))
    expect(r).toEqual([])
  })

  test('the brief: 8 on hand, 3/day, PANFOOD confirmed the 8th, empty on the 7th: one-day gap', () => {
    // 8 → 5 (today) → 2 (tomorrow) → −1 (day 2 = Oct 8)… delivery day 3.
    const r = shortageRisks(input({ orders: [open({ docNo: 'PO-000183', expectedAt: day(3), confirmedDeliveryDate: day(3) })] }))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ available: 8, avgDaily: 3, stockoutDate: day(2), gapDays: 1, shortageQty: 3, level: 'HIGH' })
    expect(r[0].daysOfCover).toBeCloseTo(8 / 3)
    expect(r[0].nextIncoming!.docNo).toBe('PO-000183')
  })

  test('zero stock with a delivery tomorrow: critical, stock-out today', () => {
    const r = shortageRisks(input({ stock: { onnut: 0 }, orders: [open({ expectedAt: day(1) })] }))
    expect(r[0]).toMatchObject({ level: 'CRITICAL', stockoutDate: D, gapDays: 1 })
    expect(r[0].reasons.map((x) => x.code)).toContain('zeroStock')
  })

  test('incoming that only partly solves it: a later stock-out after the first lot', () => {
    const lots = incomingLots([open({ expectedAt: day(1), lines: [{ productId: 'fries', productName: 'f', unit: 'ctn', orderedQty: 2 }] })], 'fries', 'onnut', new Map())
    const p = project(4, 3, lots, D, 14)
    // 4 → 1 → (+2) 0 → −3 on day 2; nothing after.
    expect(p).toMatchObject({ stockoutDay: day(2), next: null, gapDays: 14 })
  })

  test('the order lands in time but is too small: still warned, as insufficient incoming', () => {
    const small = open({ expectedAt: day(1), lines: [{ productId: 'fries', productName: 'f', unit: 'ctn', orderedQty: 2 }] })
    const r = shortageRisks(input({ stock: { onnut: 4 }, orders: [small] }))
    expect(r).toHaveLength(1)
    expect(r[0].reasons.map((x) => x.code)).toEqual(['insufficientIncoming'])
    expect(r[0]).toMatchObject({ stockoutDate: day(2), level: 'HIGH' })
  })

  test('running out a week after a big enough delivery is a reorder question, not this warning', () => {
    expect(shortageRisks(input({ orders: [open({ expectedAt: day(2), confirmedDeliveryDate: day(2) })] }))).toEqual([])
  })

  test('what already arrived on a part-delivered order is not counted again', () => {
    const o = open({ lines: [{ productId: 'fries', productName: 'f', unit: 'ctn', orderedQty: 10, receivedQty: 6 }] })
    expect(incomingLots([o], 'fries', 'onnut', new Map())[0].qty).toBe(4)
  })

  test('cancelled, received and draft orders bring nothing', () => {
    const lots = incomingLots(
      [{ ...open(), status: 'cancelled' }, { ...open(), status: 'received' }, { ...open(), status: 'draft' }, open({ locationId: 'wh' })],
      'fries',
      'onnut',
      new Map(),
    )
    expect(lots).toEqual([])
  })

  test('stock promised to a transfer not yet sent is not available', () => {
    const t = { fromLocationId: 'onnut', toLocationId: 'wh', status: 'pendingApproval', items: [{ productId: 'fries', dispatchQty: 5, requestedQty: 5 }] } as unknown as Transfer
    const r = shortageRisks(input({ transfers: [t], orders: [open({ expectedAt: day(2) })] }))
    expect(r[0]).toMatchObject({ reserved: 5, available: 3 })
  })

  test('no usage history, or nothing used: no warning invented', () => {
    expect(shortageRisks(input({ daily: {}, stock: { onnut: 0 } }))).toEqual([])
    expect(shortageRisks(input({ daily: { onnut: 0 }, stock: { onnut: 0 } }))).toEqual([])
  })

  test('arrives in time, but that delivery is high risk and the margin is under a day', () => {
    const o = open({ id: 'risky', expectedAt: day(2) })
    const risk = { level: 'HIGH', score: 72, poId: 'risky' } as DeliveryRisk
    const r = shortageRisks(input({ stock: { onnut: 7 }, orders: [o], risks: new Map([['risky', risk]]) }))
    expect(r[0]).toMatchObject({ level: 'MEDIUM', gapDays: 0 })
    expect(r[0].reasons[0]).toMatchObject({ code: 'lateRiskWouldGap', params: { score: 72 } })
  })

  test('nothing on order at all: flagged, but below a delivery gap', () => {
    const r = shortageRisks(input({ stock: { onnut: 2 } }))
    expect(r[0].reasons.map((x) => x.code)).toEqual(['noIncoming'])
    expect(r[0].level).toBe('HIGH')
  })

  test('timezone: a delivery stamped late at night still lands on its Bangkok day', () => {
    const o = open({ expectedAt: bkkAtTime(day(3), '23:59') })
    expect(incomingLots([o], 'fries', 'onnut', new Map())[0].date).toBe(day(3))
  })
})

describe('transfer suggestions never create a shortage at the source', () => {
  const late = [open({ expectedAt: day(3) })]

  test('Sukhumvit has plenty: suggest the gap, Sukhumvit keeps its own cover', () => {
    const r = shortageRisks(input({ stock: { onnut: 8, sukhumvit: 40 }, daily: { onnut: 3, sukhumvit: 2 }, orders: late }))
    expect(r[0].transfer).toMatchObject({ fromLocationId: 'sukhumvit', qty: 3 })
    expect(r[0].transfer!.sourceAfter).toBeGreaterThanOrEqual(r[0].transfer!.sourceKeeps)
  })

  test('the only other site would fall below its own cover: no suggestion', () => {
    // Sukhumvit uses 3/day: it keeps max(min 2, 3 × (1 + 3)) = 12; it has 12.
    const r = shortageRisks(input({ stock: { onnut: 8, sukhumvit: 12 }, daily: { onnut: 3, sukhumvit: 3 }, orders: late }))
    expect(r[0].transfer).toBeNull()
  })

  test('never more than the gap needs, and never from the transit location', () => {
    const r = shortageRisks(input({ stock: { onnut: 8, wh: 500, transit: 900 }, daily: { onnut: 3 }, orders: late }))
    expect(r[0].transfer).toMatchObject({ fromLocationId: 'wh', qty: 3 })
  })
})
