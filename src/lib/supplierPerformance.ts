import type { PurchaseOrder } from '../types'
import { deliveryOutcome, type DeliveryOutcome } from './deliveryMetrics'
import { DAY_MS } from './inventoryRules/time'
import { SUPPLIER_SCORE_CONFIG, type ScoreConfig } from './supplierScore'

/**
 * Supplier performance from delivery outcomes (Supplier Intelligence S2, 5 Oct 2026).
 *
 * Pure: give it orders, get numbers. Every rate keeps its raw counts (`hits` of `n`) beside
 * it, so the plain ratio can later be swapped for a smoothed one (Bayesian, say) in one
 * function without the screens changing — and so a 100 % from two orders never reads like
 * a 100 % from two hundred. Formulas are in docs/PLAN-supplier-intelligence.md §8.
 */

export type PerformanceWindow = '30d' | '90d' | '6m' | '12m' | 'all'

export const WINDOW_DAYS: Record<PerformanceWindow, number | null> = {
  '30d': 30,
  '90d': 90,
  '6m': 182,
  '12m': 365,
  all: null,
}

export interface RateStat {
  hits: number
  n: number
  /** hits ÷ n; null when n is 0. The one place a smoothed estimate would go. */
  rate: number | null
}

export function rate(hits: number, n: number): RateStat {
  return { hits, n, rate: n > 0 ? hits / n : null }
}

export type Confidence = 'insufficient' | 'low' | 'medium' | 'high'

export function confidenceFor(completed: number, cfg: ScoreConfig = SUPPLIER_SCORE_CONFIG): Confidence {
  if (completed < cfg.confidence.low) return 'insufficient'
  if (completed < cfg.confidence.medium) return 'low'
  if (completed < cfg.confidence.high) return 'medium'
  return 'high'
}

export interface DelayStats {
  /** Late deliveries the figures below are over (late only, by the owner's definition). */
  lateCount: number
  avg: number | null
  median: number | null
  p90: number | null
  max: number | null
  /** Mean days late over every dated delivery, on-time ones counting 0 — the severity input. */
  meanOverAll: number | null
}

export interface ItemStats {
  productId: string
  productName: string
  deliveries: number
  late: number
  lateRate: number | null
  avgDelayWhenLate: number | null
}

export interface SupplierStats {
  supplierId: string
  supplierName: string
  /** Placed (not draft) in the window. */
  placed: number
  /** Finished: received in full, closed short, or cancelled. */
  completed: number
  /** Finished and delivered (received or closed short) — what delivery rates are over. */
  delivered: number
  cancelled: number
  open: number
  onTime: RateStat
  requestedAcceptance: RateStat
  fill: { received: number; ordered: number; rate: number | null }
  delay: DelayStats
  response: { n: number; avgMinutes: number | null; medianMinutes: number | null; unanswered: number }
  cancellation: RateStat
  trend: { recent: RateStat; previous: RateStat; direction: 'up' | 'down' | 'flat' | null }
  confidence: Confidence
  items: ItemStats[]
  /** Newest first. */
  outcomes: DeliveryOutcome[]
}

export function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null
  // Nearest-rank: the value at or above q of the list. Plain, and what people expect of "P90".
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[i]
}

/** Delivered in full by the confirmed day. Closed short or late is a miss; undated is not judged. */
export function onTimeHit(o: DeliveryOutcome): boolean | null {
  if (o.deliveryStatus === 'early' || o.deliveryStatus === 'on_time') return true
  if (o.deliveryStatus === 'late') return false
  if (o.deliveryStatus === 'partial') return o.dueKnown ? false : null
  return null
}

function delayStats(outcomes: readonly DeliveryOutcome[]): DelayStats {
  const dated = outcomes.filter((o) => (o.deliveryStatus !== 'cancelled' && o.delayDays !== null))
  const late = dated
    .map((o) => o.delayDays as number)
    .filter((d) => d > 0)
    .sort((a, b) => a - b)
  return {
    lateCount: late.length,
    avg: late.length ? late.reduce((s, d) => s + d, 0) / late.length : null,
    median: quantile(late, 0.5),
    p90: quantile(late, 0.9),
    max: late.length ? late[late.length - 1] : null,
    meanOverAll: dated.length ? dated.reduce((s, o) => s + Math.max(0, o.delayDays as number), 0) / dated.length : null,
  }
}

function onTimeOf(outcomes: readonly DeliveryOutcome[]): RateStat {
  let hits = 0
  let n = 0
  for (const o of outcomes) {
    const h = onTimeHit(o)
    if (h === null) continue
    n++
    if (h) hits++
  }
  return rate(hits, n)
}

function itemStats(outcomes: readonly DeliveryOutcome[]): ItemStats[] {
  const m = new Map<string, { name: string; n: number; late: number; delays: number[] }>()
  for (const o of outcomes) {
    if (o.deliveryStatus === 'cancelled' || o.deliveryStatus === 'open' || !o.dueKnown) continue
    for (const l of o.lines) {
      const e = m.get(l.productId) ?? { name: l.productName, n: 0, late: 0, delays: [] }
      e.n++
      // Late: completed after the due day, or never completed (closed short).
      const lateBy = l.delayDays === null ? null : l.delayDays
      if (lateBy === null || lateBy > 0) {
        e.late++
        if (lateBy !== null) e.delays.push(lateBy)
      }
      m.set(l.productId, e)
    }
  }
  return [...m].map(([productId, e]) => ({
    productId,
    productName: e.name,
    deliveries: e.n,
    late: e.late,
    lateRate: e.n ? e.late / e.n : null,
    avgDelayWhenLate: e.delays.length ? e.delays.reduce((s, d) => s + d, 0) / e.delays.length : null,
  }))
}

export function supplierStats(
  supplierId: string,
  supplierName: string,
  outcomes: readonly DeliveryOutcome[],
  now: number,
  cfg: ScoreConfig = SUPPLIER_SCORE_CONFIG,
): SupplierStats {
  const finished = outcomes.filter((o) => o.completed)
  const delivered = finished.filter((o) => o.deliveryStatus !== 'cancelled')
  const cancelled = finished.filter((o) => o.deliveryStatus === 'cancelled').length
  const both = delivered.filter((o) => o.requestedAccepted !== null)
  let received = 0
  let ordered = 0
  for (const o of delivered) {
    if (o.fillRate === null) continue
    received += o.orderedQuantity - o.shortQuantity
    ordered += o.orderedQuantity
  }
  const responses = outcomes
    .map((o) => o.supplierResponseMinutes)
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b)
  const linked = outcomes.filter((o) => o.supplierConfirmationStatus !== null)
  // Trend by delivery day: the last 30 days against the 30 before, only on enough orders.
  const at = (o: DeliveryOutcome) => o.actualFullyReceivedAt ?? o.lastReceivedAt ?? o.orderedAt
  const recent = onTimeOf(delivered.filter((o) => at(o) > now - 30 * DAY_MS))
  const previous = onTimeOf(delivered.filter((o) => at(o) <= now - 30 * DAY_MS && at(o) > now - 60 * DAY_MS))
  let direction: SupplierStats['trend']['direction'] = null
  if (recent.n >= cfg.trendMinSample && previous.n >= cfg.trendMinSample && recent.rate !== null && previous.rate !== null) {
    const d = recent.rate - previous.rate
    direction = Math.abs(d) < cfg.trendFlatBand ? 'flat' : d > 0 ? 'up' : 'down'
  }
  return {
    supplierId,
    supplierName,
    placed: outcomes.length,
    completed: finished.length,
    delivered: delivered.length,
    cancelled,
    open: outcomes.length - finished.length,
    onTime: onTimeOf(delivered),
    requestedAcceptance: rate(both.filter((o) => o.requestedAccepted).length, both.length),
    fill: { received, ordered, rate: ordered > 0 ? received / ordered : null },
    delay: delayStats(delivered),
    response: {
      n: responses.length,
      avgMinutes: responses.length ? responses.reduce((s, m) => s + m, 0) / responses.length : null,
      medianMinutes: quantile(responses, 0.5),
      unanswered: linked.filter((o) => o.supplierResponseMinutes === null).length,
    },
    cancellation: rate(cancelled, outcomes.length),
    trend: { recent, previous, direction },
    confidence: confidenceFor(delivered.length, cfg),
    items: itemStats(delivered),
    outcomes: [...outcomes].sort((a, b) => b.orderedAt - a.orderedAt),
  }
}

/** Orders placed inside a window ending now. */
export function inWindow(orders: readonly PurchaseOrder[], window: PerformanceWindow, now: number): PurchaseOrder[] {
  const days = WINDOW_DAYS[window]
  return orders.filter((o) => o.status !== 'draft' && (days === null || o.orderedAt > now - days * DAY_MS))
}

/** Every supplier with orders in the window, with its stats. */
export function performanceBySupplier(
  orders: readonly PurchaseOrder[],
  window: PerformanceWindow,
  now: number,
  cfg: ScoreConfig = SUPPLIER_SCORE_CONFIG,
): SupplierStats[] {
  const groups = new Map<string, { name: string; outcomes: DeliveryOutcome[] }>()
  for (const o of inWindow(orders, window, now)) {
    const g = groups.get(o.supplierId) ?? { name: o.supplierName, outcomes: [] }
    g.outcomes.push(deliveryOutcome(o))
    groups.set(o.supplierId, g)
  }
  return [...groups].map(([id, g]) => supplierStats(id, g.name, g.outcomes, now, cfg))
}

export interface PerformanceSummary {
  suppliers: number
  completed: number
  onTime: RateStat
  avgDelay: number | null
  /** Open orders already past their confirmed day, or waiting on a date decision. */
  atRisk: number
}

export function performanceSummary(stats: readonly SupplierStats[], now: number): PerformanceSummary {
  const all = stats.flatMap((s) => s.outcomes)
  const delivered = all.filter((o) => o.completed && o.deliveryStatus !== 'cancelled')
  const lateDays = delivered.map((o) => o.delayDays).filter((d): d is number => d !== null && d > 0)
  return {
    suppliers: stats.length,
    completed: stats.reduce((s, x) => s + x.completed, 0),
    onTime: onTimeOf(delivered),
    avgDelay: lateDays.length ? lateDays.reduce((s, d) => s + d, 0) / lateDays.length : null,
    atRisk: all.filter(
      (o) =>
        o.deliveryStatus === 'open' &&
        (o.supplierConfirmationStatus === 'pending_date_approval' ||
          (o.confirmedDeliveryDate !== null && now > o.confirmedDeliveryDate + DAY_MS - 1)),
    ).length,
  }
}
