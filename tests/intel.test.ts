// Phase G — the intelligence engines (G1–G7): grounded, explained, honest about thin data,
// and safe (a transfer never knowingly leaves its source short).
import { describe, expect, test } from 'vitest'
import { INTEL_VERSIONS, scoreLabel } from '../src/intel/meta'
import { supplierIntel, deliveryRiskIntel } from '../src/intel/supplier'
import { simulate, stockoutFor, stockoutIntel, type StockoutInput } from '../src/intel/stockout'
import { sourceWouldShort, transferCandidates, type TransferInput } from '../src/intel/transfer'
import { purchaseRecommendation } from '../src/intel/purchase'
import { alternateSuppliers } from '../src/intel/alternate'
import { detectAnomalies } from '../src/intel/anomaly'
import { WHY_TEXT, explain } from '../src/intel/copy'
import { RISK_REASON_TEXT } from '../src/lib/riskCopy'
import { deliveryOutcome } from '../src/lib/deliveryMetrics'
import { bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import type { UsageIndex } from '../src/lib/inventoryRules/usage'
import type { Product, PurchaseOrder, StockLocation, StockMovement, Supplier, Transfer } from '../src/types'

const NOW = Date.UTC(2026, 9, 6, 3)
const TODAY = bkkDayStart(NOW)
const day = (n: number) => TODAY + n * DAY_MS
const loc = (id: string, type: StockLocation['type'] = 'branch'): StockLocation => ({ id, name: id.toUpperCase(), type, active: true, createdAt: 0 })
const WH = loc('wh', 'warehouse')
const BR = loc('br')
const BR2 = loc('br2')
const product = (id: string, over: Partial<Product> = {}): Product =>
  ({ id, sku: id, name: id.toUpperCase(), category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 0, updatedAt: 0, ...over }) as Product
const FLOUR = product('flour', { supplierId: 's1', alternateSupplierIds: ['s2'] })
const usage = (rows: [string, string, number | null][]): UsageIndex =>
  new Map(rows.map(([l, p, avg]) => [`${l}__${p}`, { used: 0, lost: 0, moves: avg === null ? 1 : 10, days: 30, avgDaily: avg }]))
const po = (over: Partial<PurchaseOrder>): PurchaseOrder =>
  ({
    id: 'po1', docNo: 'PO-1', supplierId: 's1', supplierName: 'S1', status: 'ordered', locationId: 'br', orderedAt: day(-2), expectedAt: day(5),
    lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 20 }], createdBy: 'u', createdByName: 'U', createdAt: 0, updatedAt: 0, ...over,
  }) as PurchaseOrder
const tr = (over: Partial<Transfer>): Transfer =>
  ({ id: 't1', docNo: 'TR-1', status: 'inTransit', revision: 1, fromLocationId: 'wh', toLocationId: 'br', dispatchDate: day(0), requestedBy: 'u', requestedByName: 'U', items: [{ idx: 0, productId: 'flour', productName: 'FLOUR', sku: 'f', unit: 'KG', requestedQty: 6, dispatchQty: 6 }], history: [], createdAt: 0, updatedAt: 0, ...over }) as Transfer

function world(over: Partial<TransferInput> & { stock?: Record<string, number> } = {}): TransferInput {
  const stock = { 'br:flour': 10, 'wh:flour': 100, 'br2:flour': 3, ...(over.stock ?? {}) }
  return {
    products: [FLOUR],
    locations: [WH, BR, BR2],
    qtyAt: (l, p) => stock[`${l}:${p}`] ?? 0,
    tracksProduct: () => true,
    usage: usage([['br', 'flour', 2], ['wh', 'flour', 5], ['br2', 'flour', 1]]),
    orders: [],
    transfers: [],
    risks: new Map(),
    minFor: () => 4,
    now: NOW,
    ...over,
  }
}

describe('versioning and labels', () => {
  test('every result carries engine, version, when, as of when, and confidence', () => {
    const r = stockoutFor(world(), FLOUR, BR)
    expect(r.meta).toMatchObject({ engine: 'stockout', engineVersion: INTEL_VERSIONS.stockout, calculatedAt: NOW, inputsAsOf: NOW })
    expect(['high', 'medium', 'low', 'insufficient']).toContain(r.meta.dataConfidence)
  })
  test('a heuristic score is a score, never a probability', () => {
    expect(scoreLabel('HIGH', 72.4)).toBe('HIGH · 72/100')
    expect(scoreLabel('HIGH', 72)).not.toMatch(/%/)
  })
})

describe('G2 stockout', () => {
  test('the walk: 10 on hand at 2 a day, nothing coming → out on day 5, 2 units a day after', () => {
    const r = simulate(10, 2, [], TODAY, 14)
    expect(r.estimatedStockoutDate).toBe(day(5))
    expect(r.gapDays).toBe(10)
    expect(r.estimatedShortageQty).toBe(20)
  })

  test('partial receipts count only what is still owed; cancelled and closed orders owe nothing', () => {
    const partial = po({ id: 'p', lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 20, receivedQty: 15 }] })
    const cancelled = po({ id: 'c', status: 'cancelled' })
    const closed = po({ id: 'x', status: 'received', closedShortAt: 1, lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 20, receivedQty: 5 }] })
    const draft = po({ id: 'd', status: 'draft' })
    const r = stockoutFor(world({ orders: [partial, cancelled, closed, draft] }), FLOUR, BR)
    expect(r.incoming.map((f) => [f.id, f.qty])).toEqual([['p', 5]])
  })

  test('goods in transit to the location count as incoming; requests waiting do not reserve', () => {
    const r = stockoutFor(world({ transfers: [tr({}), tr({ id: 't2', status: 'pendingApproval', fromLocationId: 'br', toLocationId: 'wh' })] }), FLOUR, BR)
    expect(r.incoming).toEqual([expect.objectContaining({ kind: 'transfer', id: 't1', qty: 6 })])
    expect(r.reserved).toBe(0)
  })

  test('a late-prone delivery is also run late: arrives in time nominally, would gap if late', () => {
    const risky = po({ id: 'r', expectedAt: day(4), lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 30 }] })
    const risks = new Map([['r', { level: 'HIGH', score: 70 } as never]])
    const r = stockoutFor(world({ orders: [risky], risks, p90DelayOf: () => 3 }), FLOUR, BR)
    expect(r.prediction?.estimatedStockoutDate).toBeNull()
    expect(r.prediction?.riskAdjusted.estimatedStockoutDate).not.toBeNull()
    expect(r.prediction?.riskLevel).toBe('MEDIUM')
    expect(r.reasons.map((x) => x.code)).toContain('stockout.lateDeliveryWouldGap')
  })

  test('no usage history: no prediction, said why', () => {
    const r = stockoutFor(world({ usage: usage([]) }), FLOUR, BR)
    expect(r.prediction).toBeNull()
    expect(r.meta.dataConfidence).toBe('insufficient')
    expect(r.meta.dataNotes).toContain('noUsageHistory')
  })

  test('a unit with no rate is flagged, and the rest still counted', () => {
    const odd = po({ id: 'o', lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', entryUnit: 'Sack', orderedQty: 2 }] })
    const r = stockoutFor(world({ orders: [odd] }), FLOUR, BR)
    expect(r.meta.dataNotes).toContain('unknownUnit')
    expect(r.meta.dataConfidence).toBe('low')
  })
})

describe('G3 transfer', () => {
  test('recommends from the location that can spare it, never below what the source keeps', () => {
    const w = world()
    const short = stockoutFor(w, FLOUR, BR)
    const recs = transferCandidates(w, short)
    expect(recs[0].source.locationId).toBe('wh')
    expect(recs[0].source.after).toBeGreaterThanOrEqual(recs[0].source.required)
    expect(recs[0].destination.shortageAfter).toBeLessThan(recs[0].destination.shortageBefore)
    expect(recs.some((r) => r.source.locationId === 'br2')).toBe(false) // 3 on hand, keeps 4
    expect(recs[0].reasons.map((r) => r.code)).toEqual(['transfer.destNeed', 'transfer.sourceSpare', 'transfer.effect'])
  })

  test('pending transfer requests out of the source are taken off first', () => {
    const w = world({ stock: { 'wh:flour': 30 }, transfers: [tr({ id: 'p', status: 'pendingApproval', toLocationId: 'br2', items: [{ idx: 0, productId: 'flour', productName: 'F', sku: 'f', unit: 'KG', requestedQty: 8, dispatchQty: 8 }] })] })
    const rec = transferCandidates(w, stockoutFor(w, FLOUR, BR))[0]
    expect(rec.source.pendingOut).toBe(8)
    expect(rec.qty).toBeLessThanOrEqual(30 - 8 - rec.source.required)
  })

  test('property: over random worlds, no recommendation creates a stock-out at its source', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 300; i++) {
      const stock = { 'br:flour': Math.floor(rnd() * 20), 'wh:flour': Math.floor(rnd() * 60), 'br2:flour': Math.floor(rnd() * 30) }
      const u = usage([['br', 'flour', 1 + rnd() * 5], ['wh', 'flour', rnd() * 6], ['br2', 'flour', rnd() < 0.3 ? null : rnd() * 4]])
      const orders = rnd() < 0.5 ? [po({ id: 'w', locationId: 'wh', expectedAt: day(Math.floor(rnd() * 10)), lines: [{ productId: 'flour', productName: 'F', unit: 'KG', orderedQty: Math.floor(rnd() * 40) }] })] : []
      const min = Math.floor(rnd() * 6) // drawn once: the minimum must not change between the two checks
      const w = world({ stock, usage: u, orders, minFor: () => min })
      const short = stockoutFor(w, FLOUR, BR)
      for (const r of transferCandidates(w, short)) {
        const src = [WH, BR2].find((l) => l.id === r.source.locationId)!
        expect(sourceWouldShort(w, FLOUR, src, r.qty), JSON.stringify({ i, stock, r: r.source, qty: r.qty, avg: [...u.values()].map((x) => x.avgDaily), orders: orders.map((o) => [o.expectedAt, o.lines[0].orderedQty]) })).toBe(false)
        expect(r.source.after).toBeGreaterThanOrEqual(r.source.required - 1e-9)
      }
    }
  })
})

describe('G4 purchase', () => {
  test('the arithmetic is all there and adds up', () => {
    const w = world({ orders: [po({ id: 'ok', expectedAt: day(1), lines: [{ productId: 'flour', productName: 'F', unit: 'KG', orderedQty: 4 }] })] })
    const r = purchaseRecommendation(stockoutFor(w, FLOUR, BR), { leadTimeDays: 2, coverDays: 7, min: 4, now: NOW, pack: { label: 'Sack', size: 5 } })
    // demand 2 × 9 = 18, safety 4, − available 10, − reliable 4 = 8 → 2 sacks = 10
    const v = Object.fromEntries(r.steps.map((s) => [s.code, s.value]))
    expect(v).toMatchObject({ forecast: 18, safety: 4, available: -10, reliableIncoming: -4, need: 8, pack: 10, recommended: 10 })
    expect(r.packs).toEqual({ label: 'Sack', size: 5, count: 2 })
  })

  test('a risky delivery is not counted as reliable, and is listed', () => {
    const w = world({ orders: [po({ id: 'r', expectedAt: day(1) })], risks: new Map([['r', { level: 'CRITICAL', score: 90 } as never]]) })
    const r = purchaseRecommendation(stockoutFor(w, FLOUR, BR), { leadTimeDays: 2, coverDays: 7, min: 4, now: NOW })
    expect(r.unreliable).toEqual([{ docNo: 'PO-1', qty: 20, why: 'risk' }])
  })

  test('no usage history: no recommendation, and it says so', () => {
    const w = world({ usage: usage([]) })
    const r = purchaseRecommendation(stockoutFor(w, FLOUR, BR), { coverDays: 7, min: 4, now: NOW })
    expect(r.qty).toBeNull()
    expect(r.meta.dataConfidence).toBe('insufficient')
  })
})

function delivered(id: string, supplierId: string, due: number, done: number, over: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return po({
    id, supplierId, supplierName: supplierId.toUpperCase(), status: 'received', orderedAt: due - 3 * DAY_MS, expectedAt: due,
    lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10, receivedQty: 10 }],
    receipts: [{ docNo: `RC-${id}`, date: done, invoiceNo: 'i', byId: 'u', byName: 'U', lines: [{ productId: 'flour', qty: 10 }] }],
    ...over,
  })
}

describe('G1 supplier and G5 alternates', () => {
  const s1 = [0, 1, 2, 3, 4, 5].map((i) => delivered(`a${i}`, 's1', day(-40 + i * 5), day(-40 + i * 5) + (i % 2 ? 2 * DAY_MS : 0)))
  const s2 = [0, 1, 2, 3, 4, 5].map((i) => delivered(`b${i}`, 's2', day(-40 + i * 5), day(-40 + i * 5)))

  test('the score breaks down into components that sum to it, with the SKU view', () => {
    const r = supplierIntel({ supplier: { id: 's1', name: 'S1' }, orders: s1, now: NOW })
    const sum = r.reasons.filter((x) => x.code.startsWith('component.')).reduce((s, x) => s + (x.points ?? 0), 0)
    expect(Math.abs(sum - (r.score ?? 0))).toBeLessThan(0.6)
    expect(r.skus[0]).toMatchObject({ productId: 'flour', deliveries: 6, late: 3, medianDelay: 2 })
    expect(r.meta.dataConfidence).toBe('low') // 6 delivered: "low" by the S2 thresholds
  })

  test('no history at all is insufficient, not a score', () => {
    const r = supplierIntel({ supplier: { id: 'new', name: 'NEW' }, orders: [], now: NOW })
    expect(r.score).toBeNull()
    expect(r.meta.dataConfidence).toBe('insufficient')
  })

  test('delivery risk without supplier history is low confidence', () => {
    const r = deliveryRiskIntel(po({ id: 'open' }), { now: NOW, history: [] })
    expect(r?.meta.dataConfidence).toBe('low')
    expect(r?.label).toMatch(/^(LOW|MEDIUM|HIGH|CRITICAL) · \d+\/100$/)
  })

  test('alternates side by side: price difference, gap if ordered, scores — and no switching', () => {
    const w = world({ stock: { 'br:flour': 4 } })
    const short = stockoutFor(w, FLOUR, BR)
    const suppliers: Supplier[] = [
      { id: 's1', name: 'S1', leadTimeDays: 4, active: true } as Supplier,
      { id: 's2', name: 'S2', leadTimeDays: 1, active: true } as Supplier,
    ]
    const items = [
      { id: 'i1', supplierId: 's1', productId: 'flour', buyingPrice: 20, active: true, createdAt: 0, updatedAt: 0 },
      { id: 'i2', supplierId: 's2', productId: 'flour', buyingPrice: 25, active: true, createdAt: 0, updatedAt: 0 },
    ]
    const intel = new Map([
      ['s1', supplierIntel({ supplier: suppliers[0], orders: s1, now: NOW })],
      ['s2', supplierIntel({ supplier: suppliers[1], orders: s2, now: NOW })],
    ])
    const r = alternateSuppliers({ product: FLOUR, shortage: short, qty: 20, suppliers, items, intel, now: NOW })!
    const b = r.options.find((o) => o.supplierId === 's2')!
    const a = r.options.find((o) => o.supplierId === 's1')!
    expect(b.priceDiff).toBe(5)
    expect(b.gapDaysIfOrdered).toBeLessThan(a.gapDaysIfOrdered)
    expect(r.tradeoffs[0]).toMatchObject({ code: 'alternate.tradeoff', params: expect.objectContaining({ supplier: 'S2', priceDiff: 5 }) })
    expect(FLOUR.supplierId).toBe('s1')
  })
})

describe('G6 anomalies', () => {
  const mv = (id: string, over: Partial<StockMovement>): StockMovement =>
    ({ id, docNo: id.toUpperCase(), type: 'issue', productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 2, fromLocationId: 'br', date: day(0), byUserId: 'u', byUserName: 'U', createdAt: day(0), ...over }) as StockMovement

  test('an unusual day of use, against its own robust baseline, with the range and z', () => {
    const history = Array.from({ length: 40 }, (_, i) => mv(`h${i}`, { qty: 2 + (i % 3 === 0 ? 1 : 0), date: day(-40 + i), createdAt: day(-40 + i) }))
    const r = detectAnomalies({ movements: [...history.filter((m) => m.date < day(-6)), mv('spike', { qty: 20, date: day(-1), createdAt: day(-1) })], products: [FLOUR], orders: [], counts: [], now: NOW })
    const a = r.anomalies.find((x) => x.kind === 'unusualConsumption')!
    expect(a).toBeTruthy()
    expect(a.observed).toBe(20)
    expect(a.reference.high).toBeLessThan(20)
    expect(a.entity).toMatchObject({ type: 'product', id: 'flour', locationId: 'br' })
  })

  test('the same receipt keyed twice minutes apart is flagged; days apart is not', () => {
    const a = mv('r1', { type: 'receive', fromLocationId: undefined, toLocationId: 'wh', createdAt: NOW - 5 * 60_000 })
    const b = mv('r2', { type: 'receive', fromLocationId: undefined, toLocationId: 'wh', createdAt: NOW - 2 * 60_000 })
    const c = mv('r3', { type: 'receive', fromLocationId: undefined, toLocationId: 'wh', createdAt: NOW - 3 * DAY_MS })
    const r = detectAnomalies({ movements: [a, b, c], products: [FLOUR], orders: [], counts: [], now: NOW })
    expect(r.anomalies.filter((x) => x.kind === 'duplicateOperation').map((x) => x.id)).toEqual(['duplicateOperation__r1__r2'])
  })

  test('a price spike against the median of earlier prices', () => {
    const hist = [10, 10, 11, 10, 15].map((cost, i) => ({ price: cost, unit: 'KG', factor: 1, cost, effectiveAt: day(-50 + i * 10), at: day(-50 + i * 10), by: 'u', byName: 'U' }))
    const r = detectAnomalies({ movements: [], products: [product('flour', { costHistory: hist })], orders: [], counts: [], now: NOW })
    expect(r.anomalies[0]).toMatchObject({ kind: 'priceSpike', observed: 15, reference: expect.objectContaining({ median: 10 }) })
  })

  test('refused at the door: a delivery with a large rejected share', () => {
    const o = po({ receipts: [{ docNo: 'RC', date: day(0), invoiceNo: 'i', byId: 'u', byName: 'U', lines: [{ productId: 'flour', qty: 12, rejectedQty: 8, rejectReason: 'damaged' }] }] })
    const r = detectAnomalies({ movements: [], products: [FLOUR], orders: [o], counts: [], now: NOW })
    expect(r.anomalies[0]).toMatchObject({ kind: 'receivingVariance', why: expect.objectContaining({ code: 'anomaly.rejected' }) })
  })

  test('nothing created after asOf is looked at', () => {
    const late = mv('later', { type: 'receive', fromLocationId: undefined, toLocationId: 'wh', createdAt: NOW + DAY_MS })
    const twin = mv('later2', { type: 'receive', fromLocationId: undefined, toLocationId: 'wh', createdAt: NOW + DAY_MS + 60_000 })
    expect(detectAnomalies({ movements: [late, twin], products: [FLOUR], orders: [], counts: [], now: NOW }).anomalies).toEqual([])
  })
})

describe('G7: every reason has words, and every result has reasons', () => {
  test('all codes the engines return are worded', () => {
    const w = world({ orders: [po({ id: 'p', expectedAt: day(8) })] })
    const all = stockoutIntel(w, { includeLow: true })
    const codes = new Set<string>()
    for (const s of all) for (const r of s.reasons) codes.add(r.code)
    for (const s of all) for (const t of transferCandidates(w, s)) for (const r of t.reasons) codes.add(r.code)
    for (const c of codes) expect(WHY_TEXT[c] ?? RISK_REASON_TEXT[c.slice(5) as never], c).toBeTruthy()
    const t = (s: string, v?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v?.[k] ?? `{${k}}`))
    for (const s of all) for (const r of s.reasons) expect(explain(r, t)).not.toMatch(/\{\w+\}/)
  })

  test('grounded: every id in a result is an id from the inputs', () => {
    const w = world({ orders: [po({ id: 'p' })] })
    const ids = new Set([...w.products.map((p) => p.id), ...w.locations.map((l) => l.id), ...w.orders.map((o) => o.id)])
    for (const s of stockoutIntel(w, { includeLow: true })) {
      expect(ids.has(s.productId) && ids.has(s.locationId)).toBe(true)
      for (const f of s.incoming) expect(ids.has(f.id) || w.transfers.some((t) => t.id === f.id)).toBe(true)
      for (const r of transferCandidates(w, s)) expect(ids.has(r.source.locationId) && ids.has(r.destination.locationId)).toBe(true)
    }
  })

  test('delivery outcomes from history feed the risk, as before (S3 unchanged)', () => {
    expect(deliveryOutcome(delivered('z', 's1', day(-5), day(-3))).delayDays).toBe(2)
  })
})

export type { StockoutInput }
