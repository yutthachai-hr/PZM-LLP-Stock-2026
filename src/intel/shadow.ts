import type { PurchaseOrder, StockMovement } from '../types'
import { deliveryOutcome } from '../lib/deliveryMetrics'
import { LEVEL_RANK, type RiskLevel } from '../lib/deliveryRisk'
import { onTimeHit } from '../lib/supplierPerformance'
import { bkkDayKey, bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { isLegacyUnitRow } from '../lib/uom'
import { binaryMetrics, type BinaryMetrics } from './backtest'
import type { DataConfidence } from './meta'
import type { DeliveryRiskIntel } from './supplier'
import type { StockoutIntel } from './stockout'

/**
 * G9 — Shadow mode: predictions kept as immutable snapshots, compared later with what
 * actually happened. Pure: building a snapshot and judging it. Writing one is
 * services/intelShadow.ts, which writes only `intelShadow` (create-only in the rules) —
 * shadow mode never creates a request, an order or a transfer, never moves stock, never
 * approves anything and never sends a message.
 *
 *  - `dr__<poId>`: an order's delivery risk the first time a manager's device sees it
 *    within a day of it being placed.
 *  - `so__<yyyymmdd>`: the day's stock-out predictions, once a day (up to 300 lines).
 */

export const SHADOW_STOCKOUT_LIMIT = 300
export const SHADOW_STOCKOUT_WINDOW_DAYS = 7

export interface DeliveryShadow {
  id: string
  kind: 'deliveryRisk'
  engineVersion: string
  createdAt: number
  inputsAsOf: number
  createdBy: string
  poId: string
  supplierId: string
  dueDate: number | null
  score: number
  level: RiskLevel
  dataConfidence: DataConfidence
  reasons: { code: string; points: number }[]
}

export interface StockoutShadowItem {
  productId: string
  locationId: string
  level: RiskLevel
  stockoutDate: number | null
  shortageQty: number
  gapDays: number
  dataConfidence: DataConfidence
}

export interface StockoutShadow {
  id: string
  kind: 'stockout'
  engineVersion: string
  createdAt: number
  inputsAsOf: number
  createdBy: string
  day: number
  items: StockoutShadowItem[]
}

export type ShadowSnapshot = DeliveryShadow | StockoutShadow

export const deliveryShadowId = (poId: string) => `dr__${poId}`
export const stockoutShadowId = (now: number) => `so__${bkkDayKey(now)}`

export function deliverySnapshot(r: DeliveryRiskIntel, by: string): DeliveryShadow {
  return {
    id: deliveryShadowId(r.poId),
    kind: 'deliveryRisk',
    engineVersion: r.meta.engineVersion,
    createdAt: r.meta.calculatedAt,
    inputsAsOf: r.meta.inputsAsOf,
    createdBy: by,
    poId: r.poId,
    supplierId: r.supplierId,
    dueDate: r.dueDate,
    score: r.score,
    level: r.level,
    dataConfidence: r.meta.dataConfidence,
    reasons: r.reasons.slice(0, 12).map((x) => ({ code: x.code, points: x.points ?? 0 })),
  }
}

export function stockoutSnapshot(results: readonly StockoutIntel[], now: number, by: string, engineVersion: string): StockoutShadow {
  const items = results
    .filter((r) => r.prediction)
    .slice(0, SHADOW_STOCKOUT_LIMIT)
    .map((r) => ({
      productId: r.productId,
      locationId: r.locationId,
      level: r.prediction!.riskLevel,
      stockoutDate: r.prediction!.estimatedStockoutDate,
      shortageQty: r.prediction!.estimatedShortageQty,
      gapDays: r.prediction!.gapDays,
      dataConfidence: r.meta.dataConfidence,
    }))
  return { id: stockoutShadowId(now), kind: 'stockout', engineVersion, createdAt: now, inputsAsOf: now, createdBy: by, day: bkkDayStart(now), items }
}

export interface ShadowRow {
  id: string
  subject: string
  predicted: string
  /** null while the outcome is not known yet. */
  actual: boolean | null
  pred: boolean
}

export interface ShadowEvaluation {
  delivery: { metrics: BinaryMetrics; pending: number; rows: ShadowRow[] }
  stockout: { metrics: BinaryMetrics; pending: number; rows: ShadowRow[] }
}

/** Judge the snapshots against what happened: orders as they finished, the real ledger. */
export function evaluateShadow(snapshots: readonly ShadowSnapshot[], orders: readonly PurchaseOrder[], movements: readonly StockMovement[], now: number, threshold: RiskLevel = 'HIGH'): ShadowEvaluation {
  const dRows: ShadowRow[] = []
  const sRows: ShadowRow[] = []
  for (const s of snapshots) {
    if (s.kind === 'deliveryRisk') {
      const o = orders.find((x) => x.id === s.poId)
      const hit = o && o.status === 'received' ? onTimeHit(deliveryOutcome(o)) : null
      dRows.push({
        id: s.id,
        subject: o?.docNo ?? s.poId,
        predicted: `${s.level} · ${s.score}/100`,
        actual: o?.status === 'cancelled' ? null : hit === null ? null : !hit,
        pred: LEVEL_RANK[s.level] >= LEVEL_RANK[threshold],
      })
    } else {
      const done = s.day + SHADOW_STOCKOUT_WINDOW_DAYS * DAY_MS <= bkkDayStart(now)
      const byKey = new Map(s.items.map((i) => [`${i.productId}__${i.locationId}`, i]))
      for (const [key, i] of byKey) {
        let label: boolean | null = null
        if (done) {
          label = false
          for (let d = 0; d < SHADOW_STOCKOUT_WINDOW_DAYS && !label; d++) {
            const end = s.day + (d + 1) * DAY_MS
            let b = 0
            for (const m of movements) {
              if (m.productId !== i.productId || m.voided || isLegacyUnitRow(m) || m.date >= end) continue
              b += (m.toLocationId === i.locationId ? m.qty : 0) - (m.fromLocationId === i.locationId ? m.qty : 0)
            }
            label = b <= 0
          }
        }
        sRows.push({
          id: `${s.id}__${key}`,
          subject: key,
          predicted: i.stockoutDate === null ? `${i.level}` : `${i.level} · ${bkkDayKey(i.stockoutDate)}`,
          actual: label,
          pred: i.stockoutDate !== null && i.stockoutDate < s.day + SHADOW_STOCKOUT_WINDOW_DAYS * DAY_MS,
        })
      }
    }
  }
  const judged = (rows: ShadowRow[]) => rows.filter((r) => r.actual !== null).map((r) => ({ pred: r.pred, label: r.actual as boolean, covered: true }))
  return {
    delivery: { metrics: binaryMetrics(judged(dRows)), pending: dRows.filter((r) => r.actual === null).length, rows: dRows },
    stockout: { metrics: binaryMetrics(judged(sRows)), pending: sRows.filter((r) => r.actual === null).length, rows: sRows },
  }
}
