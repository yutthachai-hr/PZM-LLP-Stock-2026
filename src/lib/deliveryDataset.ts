import type { PurchaseOrder } from '../types'
import { deliveryOutcome, type DeliveryOutcome } from './deliveryMetrics'
import { bkkDayStart, bkkDaysBetween, BKK_OFFSET_MS, DAY_MS } from './inventoryRules/time'
import { onTimeHit } from './supplierPerformance'

/**
 * Model readiness (Supplier Intelligence S5, 5 Oct 2026) — a dataset, not a model.
 *
 * One row per finished delivery: what was knowable when the order was placed (features)
 * and how it turned out (label). Every history feature is computed only from deliveries
 * finished BEFORE the order was placed, so no row ever sees its own future; and the split
 * is by time, never random — a model is judged on orders that came after everything it
 * learned from. No model is trained here; the rule engine stays the baseline until a
 * candidate beats it, calibrated, on held-out future data.
 */

export const FEATURE_SET_VERSION = 'delivery-features-1'

export interface DeliveryFeatureRow {
  featureSetVersion: string
  poId: string
  supplierId: string
  orderedAt: number
  // what was known when it was placed
  requestedLeadDays: number | null
  confirmedLeadDays: number | null
  supplierChangedDate: number
  supplierResponseMinutes: number | null
  lines: number
  orderedQuantity: number
  supplierHistoryN: number
  supplierOnTimeRate: number | null
  supplierAvgDelayDays: number | null
  supplierItemLateRate: number | null
  recentLate3: number | null
  dayOfWeek: number
  month: number
  // outcome
  onTime: 0 | 1
  delayDays: number
  fillRate: number | null
}

const doneAt = (o: DeliveryOutcome) => o.actualFullyReceivedAt ?? o.lastReceivedAt ?? o.orderedAt

export function datasetRows(orders: readonly PurchaseOrder[]): DeliveryFeatureRow[] {
  const outcomes = orders.filter((o) => o.status !== 'draft').map(deliveryOutcome)
  const finished = outcomes.filter((o) => o.completed && o.deliveryStatus !== 'cancelled' && onTimeHit(o) !== null)
  const rows: DeliveryFeatureRow[] = []
  for (const o of finished) {
    // Strictly before this order was placed: nothing from its own future.
    const prior = finished.filter((p) => p.supplierId === o.supplierId && p.poId !== o.poId && doneAt(p) < o.orderedAt)
    const hits = prior.filter((p) => onTimeHit(p)).length
    const lateDelays = prior.map((p) => p.delayDays ?? 0).filter((d) => d > 0)
    const products = new Set(o.lines.map((l) => l.productId))
    const itemLines = prior.flatMap((p) => p.lines.filter((l) => products.has(l.productId)))
    const itemLate = itemLines.filter((l) => l.delayDays === null || l.delayDays > 0).length
    const last3 = [...prior].sort((a, b) => doneAt(b) - doneAt(a)).slice(0, 3)
    const day = new Date(bkkDayStart(o.orderedAt) + BKK_OFFSET_MS)
    rows.push({
      featureSetVersion: FEATURE_SET_VERSION,
      poId: o.poId,
      supplierId: o.supplierId,
      orderedAt: o.orderedAt,
      requestedLeadDays: o.requestedDeliveryDate === null ? null : bkkDaysBetween(o.orderedAt, o.requestedDeliveryDate),
      confirmedLeadDays: o.confirmedDeliveryDate === null ? null : bkkDaysBetween(o.orderedAt, o.confirmedDeliveryDate),
      supplierChangedDate: o.supplierDateChangeCount,
      supplierResponseMinutes: o.supplierResponseMinutes,
      lines: o.lines.length,
      orderedQuantity: o.orderedQuantity,
      supplierHistoryN: prior.length,
      supplierOnTimeRate: prior.length ? hits / prior.length : null,
      supplierAvgDelayDays: lateDelays.length ? lateDelays.reduce((s, d) => s + d, 0) / lateDelays.length : null,
      supplierItemLateRate: itemLines.length ? itemLate / itemLines.length : null,
      recentLate3: last3.length === 3 ? last3.filter((p) => !onTimeHit(p)).length : null,
      dayOfWeek: day.getUTCDay(),
      month: day.getUTCMonth() + 1,
      onTime: onTimeHit(o) ? 1 : 0,
      delayDays: o.delayDays ?? 0,
      fillRate: o.fillRate,
    })
  }
  return rows.sort((a, b) => a.orderedAt - b.orderedAt)
}

/**
 * Train / validation / test by order date: everything placed before `validFrom` trains,
 * up to `testFrom` validates, the rest tests. Never shuffled.
 */
export function timeSplit<T extends { orderedAt: number }>(rows: readonly T[], validFrom: number, testFrom: number) {
  return {
    train: rows.filter((r) => r.orderedAt < validFrom),
    validation: rows.filter((r) => r.orderedAt >= validFrom && r.orderedAt < testFrom),
    test: rows.filter((r) => r.orderedAt >= testFrom),
  }
}

/** Below this many labelled rows (and late ones), training anything is not worth it yet. */
export const MODEL_READY = { minRows: 500, minLate: 80 }

export function readiness(rows: readonly DeliveryFeatureRow[]): { rows: number; late: number; ready: boolean; spanDays: number } {
  const late = rows.filter((r) => r.onTime === 0).length
  const spanDays = rows.length ? Math.round((rows[rows.length - 1].orderedAt - rows[0].orderedAt) / DAY_MS) : 0
  return { rows: rows.length, late, ready: rows.length >= MODEL_READY.minRows && late >= MODEL_READY.minLate, spanDays }
}

export function toCsv(rows: readonly DeliveryFeatureRow[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0]) as (keyof DeliveryFeatureRow)[]
  const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n')
}
