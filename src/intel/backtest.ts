import type { Product, PurchaseOrder, StockLocation, StockMovement, Supplier, Transfer } from '../types'
import { deliveryOutcome } from '../lib/deliveryMetrics'
import { assessDeliveryRisk, LEVEL_RANK, type RiskLevel } from '../lib/deliveryRisk'
import { onTimeHit } from '../lib/supplierPerformance'
import { bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { usageIndex, LOSS_REASONS } from '../lib/inventoryRules/usage'
import { isLegacyUnitRow } from '../lib/uom'
import { round3 } from './meta'
import { stockoutFor, type StockoutInput } from './stockout'
import { transferCandidates, SOURCE_KEEP_DAYS } from './transfer'
import { purchaseRecommendation } from './purchase'
import { supplierIntel } from './supplier'
import { detectAnomalies } from './anomaly'
import { TRANSFER_LEAD_DAYS } from '../lib/inventoryRules/suggestions'

/**
 * G8 — Historical evaluation, time-correct.
 *
 * Every prediction at a decision point t is made from `asOf(data, t)` ONLY: orders as they
 * stood at t (receipts after t removed, revisions and date changes after t undone, status
 * worked out from what had happened by t), movements created by t and dated before t's day,
 * transfers in the state they were in at t. The outcome is then read from the full data.
 * Because features can only see the as-of slice, future leakage is impossible by
 * construction — and tests/backtest.test.ts proves it by scrambling everything after t and
 * getting the same predictions.
 *
 * Reported per engine: sample size, coverage (how often there was enough evidence to
 * predict at all), precision, recall, false-warning rate, miss rate. For scores, the
 * ranking metrics a calibrated model would later be judged by (ROC-AUC, PR-AUC) and — with
 * the score read as if it were a probability, which it is not — Brier and calibration bins,
 * so a future model has a baseline to beat. No model is promoted on one metric.
 */

export interface HistoricalData {
  products: readonly Product[]
  locations: readonly StockLocation[]
  suppliers: readonly Supplier[]
  orders: readonly PurchaseOrder[]
  transfers: readonly Transfer[]
  movements: readonly StockMovement[]
}

// ------------------------------------------------------------------ as-of slices ----

/** A purchase order as it stood at `t`, or null if it had not been placed yet. */
export function orderAsOf(o: PurchaseOrder, t: number): PurchaseOrder | null {
  if (o.status === 'draft' || o.orderedAt > t) return null
  const day = bkkDayStart(t)
  // A receipt counts once its business day is over by t — a delivery dated today may still
  // be being keyed; dated before today it was known.
  const receipts = (o.receipts ?? []).filter((r) => r.date < day)
  let lines = o.lines.map((l) => ({ ...l, receivedQty: 0 }))
  let expectedAt = o.expectedAt
  // Undo, newest first, every revision made after t.
  for (const rev of [...(o.revisions ?? [])].filter((r) => r.at > t).sort((a, b) => b.at - a.at)) {
    for (const c of rev.changes) {
      if (c.kind === 'expectedAt') expectedAt = c.from
      else if (c.kind === 'qty') lines = lines.map((l) => (l.productName === c.productName ? { ...l, orderedQty: c.from, ...(l.baseQty !== undefined && l.orderedQty > 0 ? { baseQty: (l.baseQty / l.orderedQty) * c.from } : {}) } : l))
      else if (c.kind === 'add') lines = lines.filter((l) => l.productName !== c.productName)
    }
  }
  // Date moves after t (supplier answers applied, approvals) are undone too.
  for (const h of [...(o.deliveryDateHistory ?? [])].filter((x) => x.at > t).sort((a, b) => b.at - a.at)) {
    if ((h.action === 'accepted' || h.action === 'autoApplied' || h.action === 'approved') && h.from !== undefined) expectedAt = h.from
  }
  for (const r of receipts) for (const rl of r.lines) lines = lines.map((l) => (l.productId === rl.productId ? { ...l, receivedQty: l.receivedQty + rl.qty } : l))
  const allIn = lines.every((l) => l.receivedQty >= l.orderedQty)
  const status: PurchaseOrder['status'] =
    o.cancelledAt !== undefined && o.cancelledAt <= t ? 'cancelled' : o.closedShortAt !== undefined && o.closedShortAt <= t ? 'received' : allIn && receipts.length ? 'received' : 'ordered'
  const confirmedKnown = o.supplierConfirmedAt !== undefined && o.supplierConfirmedAt <= t
  return {
    ...o,
    status,
    lines,
    receipts,
    ...(expectedAt !== undefined ? { expectedAt } : { expectedAt: undefined }),
    confirmedDeliveryDate: confirmedKnown ? o.confirmedDeliveryDate : undefined,
    supplierConfirmedAt: confirmedKnown ? o.supplierConfirmedAt : undefined,
    supplierConfirmationStatus: confirmedKnown ? o.supplierConfirmationStatus : o.supplierLink && o.supplierLink.issuedAt <= t ? 'waiting' : undefined,
    pendingDeliveryDate: o.pendingDeliveryDate && o.pendingDeliveryDate.at <= t ? o.pendingDeliveryDate : undefined,
    deliveryDateHistory: (o.deliveryDateHistory ?? []).filter((h) => h.at <= t),
    supplierActivity: (o.supplierActivity ?? []).filter((a) => a.at <= t),
    supplierLink: o.supplierLink && o.supplierLink.issuedAt <= t ? o.supplierLink : undefined,
    revisions: (o.revisions ?? []).filter((r) => r.at <= t),
    cancelledAt: o.cancelledAt !== undefined && o.cancelledAt <= t ? o.cancelledAt : undefined,
    closedShortAt: o.closedShortAt !== undefined && o.closedShortAt <= t ? o.closedShortAt : undefined,
    receivedAt: o.receivedAt !== undefined && o.receivedAt <= t ? o.receivedAt : undefined,
  }
}

export function transferAsOf(tr: Transfer, t: number): Transfer | null {
  if (tr.createdAt > t) return null
  const status: Transfer['status'] =
    tr.cancelledAt !== undefined && tr.cancelledAt <= t ? 'cancelled' : tr.receivedAt !== undefined && tr.receivedAt <= t ? 'completed' : tr.approvedAt !== undefined && tr.approvedAt <= t ? 'inTransit' : tr.submittedAt !== undefined && tr.submittedAt <= t ? 'pendingApproval' : 'draft'
  return { ...tr, status }
}

export function asOf(data: HistoricalData, t: number): HistoricalData {
  const day = bkkDayStart(t)
  return {
    products: data.products.filter((p) => p.createdAt <= t),
    locations: data.locations,
    suppliers: data.suppliers,
    orders: data.orders.map((o) => orderAsOf(o, t)).filter((o): o is PurchaseOrder => !!o),
    transfers: data.transfers.map((x) => transferAsOf(x, t)).filter((x): x is Transfer => !!x),
    movements: data.movements.filter((m) => m.createdAt <= t && m.date < day && !m.voided && !isLegacyUnitRow(m)),
  }
}

// ---------------------------------------------------------------------- metrics ----

export interface BinaryMetrics {
  n: number
  covered: number
  coverage: number | null
  tp: number
  fp: number
  fn: number
  tn: number
  precision: number | null
  recall: number | null
  falseWarningRate: number | null
  missRate: number | null
}

export function binaryMetrics(rows: readonly { pred: boolean; label: boolean; covered: boolean }[]): BinaryMetrics {
  const cov = rows.filter((r) => r.covered)
  const tp = cov.filter((r) => r.pred && r.label).length
  const fp = cov.filter((r) => r.pred && !r.label).length
  const fn = cov.filter((r) => !r.pred && r.label).length
  const tn = cov.filter((r) => !r.pred && !r.label).length
  const div = (a: number, b: number) => (b > 0 ? round3(a / b) : null)
  return {
    n: rows.length,
    covered: cov.length,
    coverage: div(cov.length, rows.length),
    tp,
    fp,
    fn,
    tn,
    precision: div(tp, tp + fp),
    recall: div(tp, tp + fn),
    falseWarningRate: div(fp, fp + tn),
    missRate: div(fn, tp + fn),
  }
}

/** ROC-AUC by the rank statistic (ties count half). Null without both classes. */
export function rocAuc(rows: readonly { score: number; label: boolean }[]): number | null {
  const pos = rows.filter((r) => r.label)
  const neg = rows.filter((r) => !r.label)
  if (!pos.length || !neg.length) return null
  let s = 0
  for (const p of pos) for (const n of neg) s += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0
  return round3(s / (pos.length * neg.length))
}

/** Average precision (area under the precision–recall curve, step-wise). */
export function prAuc(rows: readonly { score: number; label: boolean }[]): number | null {
  const pos = rows.filter((r) => r.label).length
  if (!pos) return null
  const sorted = [...rows].sort((a, b) => b.score - a.score)
  let tp = 0
  let ap = 0
  sorted.forEach((r, i) => {
    if (r.label) {
      tp++
      ap += tp / (i + 1)
    }
  })
  return round3(ap / pos)
}

/** Brier score of p in [0,1] against the outcome. */
export function brier(rows: readonly { p: number; label: boolean }[]): number | null {
  if (!rows.length) return null
  return round3(rows.reduce((s, r) => s + (r.p - (r.label ? 1 : 0)) ** 2, 0) / rows.length)
}

export function calibration(rows: readonly { p: number; label: boolean }[], bins = 5): { from: number; to: number; n: number; meanP: number | null; observed: number | null }[] {
  return Array.from({ length: bins }, (_, i) => {
    const from = i / bins
    const to = (i + 1) / bins
    const inBin = rows.filter((r) => r.p >= from && (i === bins - 1 ? r.p <= to : r.p < to))
    return {
      from,
      to,
      n: inBin.length,
      meanP: inBin.length ? round3(inBin.reduce((s, r) => s + r.p, 0) / inBin.length) : null,
      observed: inBin.length ? round3(inBin.filter((r) => r.label).length / inBin.length) : null,
    }
  })
}

// ------------------------------------------------------------------- evaluations ----

export interface DeliveryRiskEval {
  point: 'atPlacement' | 'dayBeforeDue'
  threshold: RiskLevel
  metrics: BinaryMetrics
  rocAuc: number | null
  prAuc: number | null
  /** The score read as if it were a probability — a baseline only. */
  brierUncalibrated: number | null
  calibrationUncalibrated: ReturnType<typeof calibration>
}

/** One prediction per finished order, made from what was known at the decision point. */
export function deliveryRiskPredictions(data: HistoricalData, point: DeliveryRiskEval['point']) {
  const out: { poId: string; t: number; score: number; level: RiskLevel; label: boolean; covered: boolean }[] = []
  for (const final of data.orders) {
    if (final.status !== 'received') continue
    const truth = onTimeHit(deliveryOutcome(final))
    if (truth === null) continue
    const dueDay = final.expectedAt !== undefined ? bkkDayStart(final.expectedAt) : null
    const t = point === 'atPlacement' ? final.orderedAt + 60_000 : dueDay === null ? null : Math.max(final.orderedAt + 60_000, dueDay - DAY_MS + 2 * 3_600_000) // 09:00 Bangkok, the day before
    if (t === null) continue
    const known = asOf(data, t)
    const order = known.orders.find((o) => o.id === final.id)
    if (!order || order.status !== 'ordered') continue // already finished by then: nothing to decide
    const history = known.orders.filter((o) => o.id !== order.id && (o.status === 'received' || o.status === 'cancelled')).map(deliveryOutcome)
    const r = assessDeliveryRisk(order, { now: t, history, supplier: known.suppliers.find((s) => s.id === order.supplierId) })
    if (!r) continue
    out.push({ poId: final.id, t, score: r.score, level: r.level, label: !truth, covered: !r.reasons.some((x) => x.code === 'noHistory') })
  }
  return out
}

export function evaluateDeliveryRisk(data: HistoricalData, point: DeliveryRiskEval['point'], threshold: RiskLevel = 'HIGH'): DeliveryRiskEval {
  const rows = deliveryRiskPredictions(data, point)
  const scored = rows.map((r) => ({ score: r.score, label: r.label }))
  const probs = rows.map((r) => ({ p: r.score / 100, label: r.label }))
  return {
    point,
    threshold,
    metrics: binaryMetrics(rows.map((r) => ({ pred: LEVEL_RANK[r.level] >= LEVEL_RANK[threshold], label: r.label, covered: r.covered }))),
    rocAuc: rocAuc(scored),
    prAuc: prAuc(scored),
    brierUncalibrated: brier(probs),
    calibrationUncalibrated: calibration(probs),
  }
}

/** Signed effect of a movement on a location's balance. */
function delta(m: StockMovement, locationId: string): number {
  return (m.toLocationId === locationId ? m.qty : 0) - (m.fromLocationId === locationId ? m.qty : 0)
}

/** The real balance at the end of each day, from the full ledger (the ground truth). */
function trueEndOfDay(movements: readonly StockMovement[], locationId: string, productId: string, day: number): number {
  let b = 0
  for (const m of movements) if (m.productId === productId && !m.voided && !isLegacyUnitRow(m) && m.date < day + DAY_MS) b += delta(m, locationId)
  return b
}

function used(movements: readonly StockMovement[], locationId: string, productId: string, from: number, to: number): number {
  let u = 0
  for (const m of movements) {
    if (m.productId !== productId || m.fromLocationId !== locationId || m.voided || m.date < from || m.date >= to) continue
    if (m.type === 'issue' || m.type === 'consume' || (m.type === 'adjust' && (LOSS_REASONS as readonly string[]).includes(m.reason ?? ''))) u += m.qty
  }
  return u
}

export interface StockoutEval {
  windowDays: number
  metrics: BinaryMetrics
  quantity: { n: number; mae: number | null; bias: number | null; within25: number | null }
  transferSafety: { n: number; violations: number; violationRate: number | null }
}

export interface StockoutDecision {
  t: number
  productId: string
  locationId: string
  pred: boolean
  covered: boolean
  label: boolean
  forecast?: number
  actualUse?: number
  transfers: { sourceId: string; qty: number }[]
}

/** Predictions at each decision day, from the as-of slice; truth from the full ledger. */
export function stockoutDecisions(data: HistoricalData, opts: { from: number; to: number; stepDays?: number; windowDays?: number; coverDays?: number; leadTimeDays?: number; minFor?: (p: Product, loc: string) => number }): StockoutDecision[] {
  const step = (opts.stepDays ?? 1) * DAY_MS
  const win = opts.windowDays ?? 7
  const out: StockoutDecision[] = []
  for (let day = bkkDayStart(opts.from); day <= opts.to - win * DAY_MS; day += step) {
    const t = day // the morning: everything dated before today and keyed by now
    const known = asOf(data, t)
    const usage = usageIndex(known.movements, t, 30)
    const bal = new Map<string, number>()
    for (const m of known.movements) {
      if (m.toLocationId) bal.set(`${m.toLocationId}:${m.productId}`, (bal.get(`${m.toLocationId}:${m.productId}`) ?? 0) + m.qty)
      if (m.fromLocationId) bal.set(`${m.fromLocationId}:${m.productId}`, (bal.get(`${m.fromLocationId}:${m.productId}`) ?? 0) - m.qty)
    }
    const input: StockoutInput & { minFor: (p: Product, l: string) => number } = {
      products: known.products,
      locations: known.locations,
      qtyAt: (l, p) => bal.get(`${l}:${p}`) ?? 0,
      tracksProduct: (l, p) => usage.has(`${l}__${p}`),
      usage,
      orders: known.orders,
      transfers: known.transfers,
      risks: new Map(),
      minFor: opts.minFor ?? ((p) => p.minStock ?? 0),
      now: t,
      asOf: t,
    }
    for (const loc of known.locations) {
      if (loc.type === 'transit') continue
      for (const p of known.products) {
        if (!usage.has(`${loc.id}__${p.id}`)) continue
        const s = stockoutFor(input, p, loc)
        const covered = s.prediction !== null
        const pred = !!s.prediction?.estimatedStockoutDate && s.prediction.estimatedStockoutDate < day + win * DAY_MS
        let label = false
        for (let d = 0; d < win && !label; d++) label = trueEndOfDay(data.movements, loc.id, p.id, day + d * DAY_MS) <= 0
        const row: StockoutDecision = { t, productId: p.id, locationId: loc.id, pred, covered, label, transfers: [] }
        if (pred && covered) {
          const lead = opts.leadTimeDays ?? 2
          const cover = opts.coverDays ?? 7
          const rec = purchaseRecommendation(s, { leadTimeDays: lead, coverDays: cover, min: input.minFor(p, loc.id), now: t })
          row.forecast = rec.steps.find((x) => x.code === 'forecast')?.value
          row.actualUse = used(data.movements, loc.id, p.id, day, day + (lead + cover) * DAY_MS)
          row.transfers = transferCandidates(input, s).map((r) => ({ sourceId: r.source.locationId, qty: r.qty }))
        }
        out.push(row)
      }
    }
  }
  return out
}

export function evaluateStockout(data: HistoricalData, opts: Parameters<typeof stockoutDecisions>[1]): StockoutEval {
  const rows = stockoutDecisions(data, opts)
  const q = rows.filter((r) => r.forecast !== undefined && r.actualUse !== undefined && r.actualUse > 0)
  const errs = q.map((r) => (r.forecast! - r.actualUse!) / r.actualUse!)
  // A transfer is unsafe if, taking it out, the source's REAL ledger would have hit zero
  // within the transfer lead time plus its keep days. What the source really sent to the
  // same destination in that window is taken out of the real path first: the recommended
  // transfer stands in for it — counting both would send the same goods twice.
  let n = 0
  let violations = 0
  const keep = TRANSFER_LEAD_DAYS + SOURCE_KEEP_DAYS
  for (const r of rows) {
    for (const tr of r.transfers) {
      n++
      const sentAnyway = data.movements.filter(
        (m) => m.productId === r.productId && m.fromLocationId === tr.sourceId && m.toLocationId === r.locationId && !m.voided && m.date >= r.t && m.date < r.t + (keep + 1) * DAY_MS,
      )
      for (let d = 0; d <= keep; d++) {
        const end = r.t + (d + 1) * DAY_MS
        const back = sentAnyway.filter((m) => m.date < end).reduce((s, m) => s + m.qty, 0)
        if (trueEndOfDay(data.movements, tr.sourceId, r.productId, r.t + d * DAY_MS) + Math.min(back, tr.qty) - tr.qty < 0) {
          violations++
          break
        }
      }
    }
  }
  return {
    windowDays: opts.windowDays ?? 7,
    metrics: binaryMetrics(rows),
    quantity: {
      n: q.length,
      mae: q.length ? round3(q.reduce((s, r) => s + Math.abs(r.forecast! - r.actualUse!), 0) / q.length) : null,
      bias: errs.length ? round3(errs.reduce((s, e) => s + e, 0) / errs.length) : null,
      within25: errs.length ? round3(errs.filter((e) => Math.abs(e) <= 0.25).length / errs.length) : null,
    },
    transferSafety: { n, violations, violationRate: n ? round3(violations / n) : null },
  }
}

/** Supplier deterioration: flagged at t vs the on-time rate of the 30 days after t. */
export function evaluateDeterioration(data: HistoricalData, points: readonly number[]): BinaryMetrics {
  const rows: { pred: boolean; label: boolean; covered: boolean }[] = []
  for (const t of points) {
    const known = asOf(data, t)
    const intel = new Map(data.suppliers.map((s) => [s.id, supplierIntel({ supplier: s, orders: known.orders, now: t })]))
    const flagged = new Set(detectAnomalies({ movements: [], products: [], orders: [], counts: [], supplierIntel: intel, now: t }).anomalies.filter((a) => a.kind === 'supplierDeterioration').map((a) => a.entity.id))
    for (const s of data.suppliers) {
      // The flag says "worse than its earlier baseline": true if the next 30 days stay
      // below that same baseline (the 30 days before the recent ones) by 10 points or more.
      const trend = intel.get(s.id)!.stats.trend
      const before = trend.previous
      const after = data.orders
        .filter((o) => o.supplierId === s.id && o.status === 'received')
        .map(deliveryOutcome)
        .filter((o) => {
          const at = o.actualFullyReceivedAt ?? o.lastReceivedAt
          return at !== null && at > t && at <= t + 30 * DAY_MS
        })
        .map(onTimeHit)
        .filter((h): h is boolean => h !== null)
      if (before.rate === null || after.length < 3) continue
      const rateAfter = after.filter(Boolean).length / after.length
      rows.push({ pred: flagged.has(s.id), label: rateAfter < before.rate - 0.1, covered: before.n >= 5 && trend.recent.n >= 5 })
    }
  }
  return binaryMetrics(rows)
}
