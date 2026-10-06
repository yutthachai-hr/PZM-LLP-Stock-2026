import type { PurchaseOrder, Supplier } from '../types'
import { confirmedDateOf, deliveryOutcome, type DeliveryOutcome } from './deliveryMetrics'
import { bkkDayEnd, bkkDayStart, bkkDaysBetween, DAY_MS } from './inventoryRules/time'
import { onTimeHit, quantile } from './supplierPerformance'

/**
 * Late-delivery risk for open purchase orders (Supplier Intelligence S3, 5 Oct 2026).
 *
 * Rules, not a model: every point comes from a named reason, and the reasons are returned
 * with the score so "why is this PO high risk?" always has an answer. The result is a
 * score out of 100 — it is NOT a probability, and the screens say "Risk Score 72/100".
 * A calibrated model may replace this later (S5); `version` says which produced a result.
 */

export const RISK_ENGINE_VERSION = 'rules-1'

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export const RISK_CONFIG = {
  levels: { medium: 30, high: 60, critical: 80 },
  /** A supplier's history needs this many judged deliveries before its rates count. */
  minHistory: 3,
  historyDays: 90,
  points: {
    overdue: 30,
    overduePerExtraDay: 10,
    otdBelow80: 25,
    otdBelow90: 10,
    twoOfLastThreeLate: 20,
    skuLateRate: 15,
    supplierChangedDate: 15,
    pendingApproval: 15,
    shortLeadTime: 10,
    slowConfirmation: 10,
    unconfirmedNearDue: 10,
  },
  skuLateRate: 0.25,
  skuMinDeliveries: 2,
  slowConfirmationHours: 24,
}

export type RiskReasonCode = keyof typeof RISK_CONFIG.points | 'noHistory'

export interface RiskReason {
  code: RiskReasonCode
  points: number
  /** Fills the reason's text (lib copy, by code). */
  params: Record<string, string | number>
}

export interface DeliveryRisk {
  poId: string
  docNo: string
  supplierId: string
  supplierName: string
  /** The day the goods are expected (confirmed, else the order's due date). */
  dueDate: number | null
  score: number
  level: RiskLevel
  reasons: RiskReason[]
  calculatedAt: number
  version: string
}

export function levelFor(score: number): RiskLevel {
  const l = RISK_CONFIG.levels
  return score >= l.critical ? 'CRITICAL' : score >= l.high ? 'HIGH' : score >= l.medium ? 'MEDIUM' : 'LOW'
}

export const LEVEL_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }

export interface RiskContext {
  now: number
  /** Delivery outcomes of the supplier's past orders (any supplier; filtered here). */
  history: readonly DeliveryOutcome[]
  supplier?: Pick<Supplier, 'leadTimeDays'>
}

/** The day a delivery happened, for ordering a supplier's recent record. */
const doneAt = (o: DeliveryOutcome) => o.actualFullyReceivedAt ?? o.lastReceivedAt ?? o.orderedAt

export function assessDeliveryRisk(order: PurchaseOrder, ctx: RiskContext): DeliveryRisk | null {
  if (order.status !== 'ordered') return null
  const { now } = ctx
  const P = RISK_CONFIG.points
  const reasons: RiskReason[] = []
  const add = (code: RiskReasonCode, points: number, params: RiskReason['params'] = {}) => reasons.push({ code, points, params })
  const due = confirmedDateOf(order)
  const self = deliveryOutcome(order)

  // Already late is the strongest signal there is.
  if (due !== null && now > bkkDayEnd(due)) {
    const days = bkkDaysBetween(due, now)
    add('overdue', P.overdue + P.overduePerExtraDay * Math.max(0, days - 1), { days })
  }

  // The supplier's recent record, judged against the dates it confirmed.
  const since = now - RISK_CONFIG.historyDays * DAY_MS
  const past = ctx.history
    .filter((o) => o.supplierId === order.supplierId && o.poId !== order.id && o.completed && o.deliveryStatus !== 'cancelled')
    .filter((o) => doneAt(o) >= since)
  const judged = past.filter((o) => onTimeHit(o) !== null)
  if (judged.length < RISK_CONFIG.minHistory) {
    add('noHistory', 0, { n: judged.length })
  } else {
    const otd = judged.filter((o) => onTimeHit(o)).length / judged.length
    if (otd < 0.8) add('otdBelow80', P.otdBelow80, { pct: Math.round(otd * 100), n: judged.length })
    else if (otd < 0.9) add('otdBelow90', P.otdBelow90, { pct: Math.round(otd * 100), n: judged.length })
    const last3 = [...judged].sort((a, b) => doneAt(b) - doneAt(a)).slice(0, 3)
    const late3 = last3.filter((o) => !onTimeHit(o)).length
    if (last3.length === 3 && late3 >= 2) add('twoOfLastThreeLate', P.twoOfLastThreeLate, { late: late3 })
  }

  // A product on this order that this supplier is often late with.
  let worst: { name: string; rate: number; n: number; avg: number | null } | null = null
  for (const line of order.lines) {
    const deliveries = past.flatMap((o) => (o.dueKnown ? o.lines.filter((l) => l.productId === line.productId) : []))
    if (deliveries.length < RISK_CONFIG.skuMinDeliveries) continue
    const late = deliveries.filter((l) => l.delayDays === null || l.delayDays > 0)
    const rate = late.length / deliveries.length
    const delays = late.map((l) => l.delayDays).filter((d): d is number => d !== null)
    const avg = delays.length ? delays.reduce((s, d) => s + d, 0) / delays.length : null
    if (rate > RISK_CONFIG.skuLateRate && (!worst || rate > worst.rate)) worst = { name: line.productName, rate, n: deliveries.length, avg }
  }
  if (worst) {
    add('skuLateRate', P.skuLateRate, {
      product: worst.name,
      pct: Math.round(worst.rate * 100),
      n: worst.n,
      avg: worst.avg === null ? '—' : Math.round(worst.avg * 10) / 10,
    })
  }

  // What happened on this order itself.
  if (self.supplierDateChangeCount > 0) add('supplierChangedDate', P.supplierChangedDate, { n: self.supplierDateChangeCount })
  if (order.supplierConfirmationStatus === 'pending_date_approval') add('pendingApproval', P.pendingApproval)

  // Less time than this supplier normally needs.
  const normal =
    ctx.supplier?.leadTimeDays ??
    quantile(
      past
        .filter((o) => o.confirmedDeliveryDate !== null)
        .map((o) => bkkDaysBetween(o.orderedAt, o.confirmedDeliveryDate as number))
        .sort((a, b) => a - b),
      0.5,
    )
  if (due !== null && normal !== null && normal !== undefined) {
    const lead = bkkDaysBetween(order.orderedAt, due)
    if (lead < normal) add('shortLeadTime', P.shortLeadTime, { lead, normal })
  }

  // The link went out and nobody has answered.
  const sent = order.supplierActivity?.find((a) => a.kind === 'linkIssued')?.at ?? order.supplierLink?.issuedAt
  if (sent !== undefined && self.supplierResponseMinutes === null) {
    const hours = Math.floor((now - sent) / 3_600_000)
    if (hours >= RISK_CONFIG.slowConfirmationHours) add('slowConfirmation', P.slowConfirmation, { hours })
    else if (due !== null && order.supplierConfirmationStatus === 'waiting' && bkkDaysBetween(now, due) <= 1 && now <= bkkDayEnd(due)) {
      add('unconfirmedNearDue', P.unconfirmedNearDue)
    }
  }

  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0))
  return {
    poId: order.id,
    docNo: order.docNo,
    supplierId: order.supplierId,
    supplierName: order.supplierName,
    dueDate: due === null ? null : bkkDayStart(due),
    score,
    level: levelFor(score),
    reasons: reasons.sort((a, b) => b.points - a.points),
    calculatedAt: now,
    version: RISK_ENGINE_VERSION,
  }
}

/** Every open order's risk, from one set of orders (open + history together). */
export function assessAll(
  orders: readonly PurchaseOrder[],
  now: number,
  suppliers: readonly Pick<Supplier, 'id' | 'leadTimeDays'>[] = [],
): Map<string, DeliveryRisk> {
  const history = orders.filter((o) => o.status === 'received' || o.status === 'cancelled').map(deliveryOutcome)
  const out = new Map<string, DeliveryRisk>()
  for (const o of orders) {
    const r = assessDeliveryRisk(o, { now, history, supplier: suppliers.find((s) => s.id === o.supplierId) })
    if (r) out.set(o.id, r)
  }
  return out
}
