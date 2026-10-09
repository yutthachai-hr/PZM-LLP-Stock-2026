// Phase G8 — the historical evaluation harness: time-correct (no future leakage), and the
// benchmark on a seeded synthetic history with known behaviour. The numbers printed here
// are the ones docs/evidence/phase-g.md records.
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  asOf,
  binaryMetrics,
  brier,
  deliveryRiskPredictions,
  evaluateDeliveryRisk,
  evaluateDeterioration,
  evaluateStockout,
  orderAsOf,
  prAuc,
  rocAuc,
  stockoutDecisions,
  type HistoricalData,
} from '../src/intel/backtest'
import { syntheticHistory } from '../src/intel/synthetic'
import { DAY_MS } from '../src/lib/inventoryRules/time'
import type { PurchaseOrder } from '../src/types'

const H = syntheticHistory({ seed: 42 })

/** Everything that happened after t, scrambled: if a prediction at t changes, it leaked. */
function scrambleAfter(data: HistoricalData, t: number): HistoricalData {
  return {
    ...data,
    orders: data.orders.map((o) => ({
      ...o,
      receipts: (o.receipts ?? []).map((r) => (r.date >= t ? { ...r, date: r.date + 3 * DAY_MS, lines: r.lines.map((l) => ({ ...l, qty: l.qty * 7 })) } : r)),
      cancelledAt: o.cancelledAt ?? (o.orderedAt < t ? t + 5 * DAY_MS : undefined),
      receivedAt: o.receivedAt !== undefined && o.receivedAt > t ? o.receivedAt + DAY_MS : o.receivedAt,
    })),
    movements: data.movements.map((m) => (m.createdAt > t || m.date >= t ? { ...m, qty: m.qty * 13 } : m)),
    transfers: data.transfers.map((x) => (x.receivedAt !== undefined && x.receivedAt > t ? { ...x, receivedAt: x.receivedAt + 9 * DAY_MS } : x)),
  }
}

describe('G8: no future leakage', () => {
  test('an order as of t: later receipts, cancellations and date moves are not visible', () => {
    const due = Date.UTC(2026, 4, 10)
    const o = {
      id: 'x', docNo: 'X', supplierId: 's', supplierName: 'S', status: 'received', locationId: 'wh', orderedAt: due - 5 * DAY_MS, expectedAt: due + 3 * DAY_MS,
      lines: [{ productId: 'p', productName: 'P', unit: 'KG', orderedQty: 10, receivedQty: 10 }],
      receipts: [{ docNo: 'R', date: due + 2 * DAY_MS, invoiceNo: 'i', byId: 'u', byName: 'U', lines: [{ productId: 'p', qty: 10 }] }],
      revisions: [{ rev: 2, at: due - DAY_MS, by: 'u', byName: 'U', reason: 'r', changes: [{ kind: 'expectedAt', from: due, to: due + 3 * DAY_MS }] }],
      supplierConfirmedAt: due - DAY_MS, confirmedDeliveryDate: due + 3 * DAY_MS,
      createdBy: 'u', createdByName: 'U', createdAt: 0, updatedAt: 0,
    } as PurchaseOrder
    const before = orderAsOf(o, due - 2 * DAY_MS)!
    expect(before).toMatchObject({ status: 'ordered', expectedAt: due, receipts: [], confirmedDeliveryDate: undefined })
    expect(before.lines[0].receivedQty).toBe(0)
    expect(orderAsOf(o, due - 10 * DAY_MS)).toBeNull()
    expect(orderAsOf(o, due + 5 * DAY_MS)!.status).toBe('received')
  })

  test('delivery-risk predictions at t are identical whatever happened after t', () => {
    const preds = deliveryRiskPredictions(H, 'atPlacement').slice(10, 40)
    expect(preds.length).toBeGreaterThan(10)
    for (const p of preds) {
      const again = deliveryRiskPredictions(scrambleAfter(H, p.t), 'atPlacement').find((x) => x.poId === p.poId && x.t === p.t)
      // The scrambled world may finish the order differently (that is the label), never the prediction.
      if (again) expect([again.score, again.level, again.covered]).toEqual([p.score, p.level, p.covered])
    }
    // ~1 s alone: it recomputes the whole history 30 times. Beside the PGlite shadow tests in the
    // full suite it passed vitest's 5 s default (7 Oct 2026), so it gets room — the check is unchanged.
  }, 30_000)

  test('stockout predictions at t are identical whatever happened after t', () => {
    const t = H.start + 60 * DAY_MS
    const opts = { from: t, to: t + 8 * DAY_MS, stepDays: 1 }
    const a = stockoutDecisions(H, opts).filter((r) => r.t === t).map(({ productId, locationId, pred, covered, transfers }) => ({ productId, locationId, pred, covered, transfers }))
    const b = stockoutDecisions(scrambleAfter(H, t), opts).filter((r) => r.t === t).map(({ productId, locationId, pred, covered, transfers }) => ({ productId, locationId, pred, covered, transfers }))
    expect(a.length).toBeGreaterThan(5)
    expect(b).toEqual(a)
  })

  test('the as-of slice holds nothing keyed after t or dated on/after t’s day', () => {
    const t = H.start + 40 * DAY_MS + 5 * 3_600_000
    const s = asOf(H, t)
    expect(s.movements.every((m) => m.createdAt <= t && m.date < t)).toBe(true)
    expect(s.orders.every((o) => o.orderedAt <= t && (o.receipts ?? []).every((r) => r.date < t))).toBe(true)
  })
})

describe('G8: metrics', () => {
  test('binary metrics, ROC-AUC, PR-AUC and Brier on a known table', () => {
    const m = binaryMetrics([
      { pred: true, label: true, covered: true },
      { pred: true, label: false, covered: true },
      { pred: false, label: true, covered: true },
      { pred: false, label: false, covered: true },
      { pred: false, label: false, covered: false },
    ])
    expect(m).toMatchObject({ n: 5, covered: 4, coverage: 0.8, precision: 0.5, recall: 0.5, falseWarningRate: 0.5, missRate: 0.5 })
    expect(rocAuc([{ score: 0.9, label: true }, { score: 0.1, label: false }])).toBe(1)
    expect(prAuc([{ score: 0.9, label: true }, { score: 0.8, label: false }, { score: 0.7, label: true }])).toBe(0.833)
    expect(brier([{ p: 1, label: true }, { p: 0, label: false }])).toBe(0)
  })
})

describe('G8: benchmark on the synthetic history (seed 42, 150 days)', () => {
  const report: Record<string, unknown> = {}

  test('delivery risk: ranks late orders above on-time ones', () => {
    for (const point of ['atPlacement', 'dayBeforeDue'] as const) {
      for (const threshold of ['MEDIUM', 'HIGH'] as const) report[`delivery.${point}.${threshold}`] = evaluateDeliveryRisk(H, point, threshold)
    }
    const e = report['delivery.atPlacement.MEDIUM'] as ReturnType<typeof evaluateDeliveryRisk>
    expect(e.metrics.n).toBeGreaterThan(30)
    expect(e.rocAuc).toBeGreaterThan(0.6)
  })

  test('stockout, quantity and transfer safety', () => {
    const e = evaluateStockout(H, { from: H.start + 35 * DAY_MS, to: H.end, stepDays: 2 })
    report.stockout = e
    expect(e.metrics.n).toBeGreaterThan(100)
    expect(e.transferSafety.violations).toBe(0)
  })

  test('supplier deterioration', () => {
    const points = Array.from({ length: 12 }, (_, i) => H.start + (65 + i * 5) * DAY_MS)
    report.deterioration = evaluateDeterioration(H, points)
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/phase-g-benchmark.json', JSON.stringify(report, null, 1))
  })
})
