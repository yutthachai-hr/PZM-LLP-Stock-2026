import type { PurchaseOrder, Supplier } from '../types'
import { deliveryOutcome, type DeliveryOutcome } from '../lib/deliveryMetrics'
import { assessDeliveryRisk, type DeliveryRisk, type RiskLevel } from '../lib/deliveryRisk'
import { quantile, supplierStats, type SupplierStats } from '../lib/supplierPerformance'
import { supplierScore, type SupplierScore } from '../lib/supplierScore'
import { meta, round3, scoreLabel, type DataConfidence, type DataNote, type IntelMeta, type Reason } from './meta'

/**
 * G1 — Supplier risk intelligence, explainable.
 *
 * Built on the S2/S3 rules (lib/supplierPerformance, lib/supplierScore, lib/deliveryRisk),
 * which are deterministic and already answer "why" component by component. This layer adds
 * the supplier × SKU view (median and P90 delay per product, fill per product), the date-
 * change history, the version/as-of/confidence every Phase G result carries — and nothing
 * here is a probability: the score is "HIGH · 72/100".
 */

export interface SkuIntel {
  productId: string
  productName: string
  deliveries: number
  onTimeRate: number | null
  fillRate: number | null
  medianDelay: number | null
  p90Delay: number | null
  late: number
}

export interface SupplierIntel {
  meta: IntelMeta
  supplierId: string
  supplierName: string
  score: number | null
  grade: SupplierScore['grade']
  stats: Pick<SupplierStats, 'onTime' | 'fill' | 'delay' | 'requestedAcceptance' | 'response' | 'cancellation' | 'trend' | 'delivered' | 'cancelled' | 'placed'>
  dateChanges: { orders: number; changes: number }
  skus: SkuIntel[]
  /** "Why 82?": every component with its value, weight and points, then the notes. */
  reasons: Reason[]
}

export interface SupplierIntelInput {
  supplier: Pick<Supplier, 'id' | 'name'>
  /** Every order of this supplier the caller holds (open and finished). */
  orders: readonly PurchaseOrder[]
  now: number
  asOf?: number
}

const confidenceMap: Record<SupplierStats['confidence'], DataConfidence> = { insufficient: 'insufficient', low: 'low', medium: 'medium', high: 'high' }

export function skuIntel(outcomes: readonly DeliveryOutcome[]): SkuIntel[] {
  const m = new Map<string, { name: string; n: number; onTime: number; judged: number; ordered: number; received: number; delays: number[]; late: number }>()
  for (const o of outcomes) {
    if (!o.completed || o.deliveryStatus === 'cancelled') continue
    for (const l of o.lines) {
      const e = m.get(l.productId) ?? { name: l.productName, n: 0, onTime: 0, judged: 0, ordered: 0, received: 0, delays: [], late: 0 }
      e.n++
      e.ordered += l.ordered
      e.received += Math.min(l.received, l.ordered)
      if (o.dueKnown) {
        e.judged++
        if (l.delayDays !== null && l.delayDays <= 0) e.onTime++
        else e.late++
        if (l.delayDays !== null && l.delayDays > 0) e.delays.push(l.delayDays)
      }
      m.set(l.productId, e)
    }
  }
  return [...m].map(([productId, e]) => {
    const delays = [...e.delays].sort((a, b) => a - b)
    return {
      productId,
      productName: e.name,
      deliveries: e.n,
      onTimeRate: e.judged ? round3(e.onTime / e.judged) : null,
      fillRate: e.ordered ? round3(e.received / e.ordered) : null,
      medianDelay: quantile(delays, 0.5),
      p90Delay: quantile(delays, 0.9),
      late: e.late,
    }
  })
}

export function supplierIntel(input: SupplierIntelInput): SupplierIntel {
  const { supplier, now } = input
  const outcomes = input.orders.filter((o) => o.supplierId === supplier.id && o.status !== 'draft').map(deliveryOutcome)
  const stats = supplierStats(supplier.id, supplier.name, outcomes, now)
  const score = supplierScore(stats)
  const notes: DataNote[] = []
  if (stats.delivered === 0) notes.push('noSupplierHistory')
  else if (stats.confidence === 'insufficient' || stats.confidence === 'low') notes.push('thinSupplierHistory')
  const reasons: Reason[] = score.components.map((c) => ({
    code: `component.${c.key}`,
    points: Math.round(c.points * 10) / 10,
    params: {
      value: c.value === null ? '—' : Math.round(c.value),
      weight: Math.round(c.effectiveWeight),
      hits: c.basis.hits ?? '',
      n: c.basis.n ?? '',
      raw: c.basis.raw === null || c.basis.raw === undefined ? '' : Math.round(c.basis.raw * 100) / 100,
    },
  }))
  if (stats.delay.median !== null) reasons.push({ code: 'delayDistribution', params: { median: stats.delay.median, p90: stats.delay.p90 ?? '—', late: stats.delay.lateCount } })
  if (stats.trend.direction) reasons.push({ code: `trend.${stats.trend.direction}`, params: { recent: pct(stats.trend.recent.rate), previous: pct(stats.trend.previous.rate) } })
  const changed = outcomes.filter((o) => o.supplierDateChangeCount > 0)
  const changes = changed.reduce((s, o) => s + o.supplierDateChangeCount, 0)
  if (changes) reasons.push({ code: 'dateChanges', params: { orders: changed.length, changes } })
  if (stats.cancelled) reasons.push({ code: 'cancellations', params: { n: stats.cancelled, of: stats.placed } })
  return {
    meta: meta('supplier', input, notes, notes.includes('noSupplierHistory') ? 'insufficient' : confidenceMap[stats.confidence]),
    supplierId: supplier.id,
    supplierName: supplier.name,
    score: score.score,
    grade: score.grade,
    stats: {
      onTime: stats.onTime,
      fill: stats.fill,
      delay: stats.delay,
      requestedAcceptance: stats.requestedAcceptance,
      response: stats.response,
      cancellation: stats.cancellation,
      trend: stats.trend,
      delivered: stats.delivered,
      cancelled: stats.cancelled,
      placed: stats.placed,
    },
    dateChanges: { orders: changed.length, changes },
    skus: skuIntel(outcomes),
    reasons,
  }
}

const pct = (r: number | null) => (r === null ? '—' : Math.round(r * 100))

export interface DeliveryRiskIntel {
  meta: IntelMeta
  poId: string
  docNo: string
  supplierId: string
  level: RiskLevel
  score: number
  /** "HIGH · 72/100" — a score, not a probability. */
  label: string
  dueDate: number | null
  reasons: Reason[]
  raw: DeliveryRisk
}

/** An open PO's delivery risk, with the confidence its history supports. */
export function deliveryRiskIntel(
  order: PurchaseOrder,
  ctx: { now: number; asOf?: number; history: readonly DeliveryOutcome[]; supplier?: Pick<Supplier, 'leadTimeDays'> },
): DeliveryRiskIntel | null {
  const r = assessDeliveryRisk(order, { now: ctx.now, history: ctx.history, supplier: ctx.supplier })
  if (!r) return null
  const thin = r.reasons.find((x) => x.code === 'noHistory')
  // Without the supplier's history the score still holds what is certain (overdue, a date
  // change on this order) — it is just blind to the supplier's habits. Said, not hidden.
  const notes: DataNote[] = thin ? ['thinSupplierHistory'] : []
  if (r.dueDate === null) notes.push('missingIncomingDate')
  return {
    meta: meta('delivery', ctx, notes, thin ? 'low' : r.dueDate === null ? 'medium' : 'high'),
    poId: r.poId,
    docNo: r.docNo,
    supplierId: r.supplierId,
    level: r.level,
    score: r.score,
    label: scoreLabel(r.level, r.score),
    dueDate: r.dueDate,
    reasons: r.reasons.map((x) => ({ code: `risk.${x.code}`, points: x.points, params: x.params })),
    raw: r,
  }
}
