import type { Product, PurchaseOrder, StockLocation, Transfer, TransferStatus } from '../types'
import { confirmedDateOf } from './deliveryMetrics'
import { LEVEL_RANK, type DeliveryRisk, type RiskLevel } from './deliveryRisk'
import { expectedDeliveryAt, remainingBaseQty } from './inventoryRules/purchasing'
import { TRANSFER_LEAD_DAYS } from './inventoryRules/suggestions'
import { bkkDayStart, DAY_MS } from './inventoryRules/time'
import type { UsageIndex } from './inventoryRules/usage'
import { usageAt } from './inventoryRules/usage'

/**
 * Will a location run out before the goods on order arrive? (Supplier Intelligence S4,
 * 5 Oct 2026.) Combines the shelf (on hand, less what is already promised to a transfer),
 * how fast it goes (the usage index), and what is coming (open orders, minus what already
 * arrived, on the day each is expected) — and the delivery risk of that order.
 *
 * A recommendation engine only: it never moves stock or places an order. A transfer it
 * suggests leaves the giving location above its own minimum and cover.
 */

export const SHORTAGE_CONFIG = {
  /** Days ahead the projection looks. */
  horizonDays: 14,
  /** Days of cover a giving location keeps for itself beyond the transfer lead time. */
  sourceKeepDays: 3,
  /**
   * Running out this soon after the last order lands means the order was too small and a
   * fresh one could not arrive in time — still this warning, not a reorder suggestion.
   */
  insufficientWithinDays: 3,
}

/** Promised away but not yet sent: still on the shelf, no longer available. */
const COMMITTED: readonly TransferStatus[] = ['draft', 'pendingApproval', 'returned']

export interface IncomingLot {
  poId: string
  docNo: string
  supplierId: string
  supplierName: string
  /** Base units still owed. */
  qty: number
  /** Start of the Bangkok day it is expected. */
  date: number
  risk: DeliveryRisk | null
}

export interface TransferOption {
  fromLocationId: string
  fromLocationName: string
  qty: number
  /** The giver's stock after giving, and what it keeps for itself. */
  sourceAfter: number
  sourceKeeps: number
}

export interface ShortageRisk {
  key: string
  productId: string
  productName: string
  unit: string
  locationId: string
  locationName: string
  onHand: number
  reserved: number
  available: number
  avgDaily: number
  daysOfCover: number
  /** The day the shelf is empty, at the current rate, before anything arrives. */
  stockoutDate: number
  incoming: IncomingLot[]
  /** The first delivery that lands on or after the stock-out, or null when none is coming. */
  nextIncoming: IncomingLot | null
  /** Days with nothing on the shelf before that delivery (0 = arrives in time). */
  gapDays: number
  /** Units the gap costs at the current rate. */
  shortageQty: number
  level: RiskLevel
  /** Why: codes the screens put into words. */
  reasons: { code: 'gap' | 'noIncoming' | 'insufficientIncoming' | 'lateRiskWouldGap' | 'zeroStock'; params: Record<string, string | number> }[]
  transfer: TransferOption | null
}

export interface ShortageInput {
  products: readonly Product[]
  locations: readonly StockLocation[]
  qtyAt: (locationId: string, productId: string) => number
  minFor: (product: Product, locationId: string) => number
  tracksProduct: (locationId: string, productId: string) => boolean
  usage: UsageIndex
  orders: readonly PurchaseOrder[]
  transfers: readonly Transfer[]
  risks: ReadonlyMap<string, DeliveryRisk>
  leadTimeOf?: (supplierId: string) => number | undefined
  now: number
}

function committedOut(transfers: readonly Transfer[], locationId: string, productId: string): number {
  let n = 0
  for (const t of transfers) {
    if (t.fromLocationId !== locationId || !COMMITTED.includes(t.status)) continue
    for (const i of t.items) if (i.productId === productId) n += i.dispatchQty || i.requestedQty || 0
  }
  return n
}

/** What is still owed on open orders to a location, one lot per order, by expected day. */
export function incomingLots(
  orders: readonly PurchaseOrder[],
  productId: string,
  locationId: string,
  risks: ReadonlyMap<string, DeliveryRisk>,
  leadTimeOf?: (supplierId: string) => number | undefined,
): IncomingLot[] {
  const lots: IncomingLot[] = []
  for (const o of orders) {
    // Cancelled, received, drafts: nothing is coming from those.
    if (o.status !== 'ordered' || o.locationId !== locationId) continue
    let qty = 0
    for (const l of o.lines) {
      if (l.productId !== productId) continue
      qty += remainingBaseQty(l).qty
    }
    if (qty <= 0) continue
    const date = confirmedDateOf(o) ?? expectedDeliveryAt(o, leadTimeOf?.(o.supplierId))
    if (date === undefined || date === null) continue
    lots.push({ poId: o.id, docNo: o.docNo, supplierId: o.supplierId, supplierName: o.supplierName, qty, date: bkkDayStart(date), risk: risks.get(o.id) ?? null })
  }
  return lots.sort((a, b) => a.date - b.date)
}

/**
 * Walk the days: the shelf goes down by the daily rate, lots land on their day (available
 * from that morning). The first day demand cannot be met is the stock-out; the gap runs
 * until the next lot that brings it back.
 */
export function project(available: number, avgDaily: number, lots: readonly IncomingLot[], today: number, horizonDays: number) {
  let stock = available
  let stockoutDay: number | null = available <= 0 ? today : null
  for (let d = 0; d <= horizonDays && stockoutDay === null; d++) {
    const day = today + d * DAY_MS
    for (const l of lots) if (l.date === day) stock += l.qty
    stock -= avgDaily
    if (stock < 0) stockoutDay = day
  }
  if (stockoutDay === null) return { stockoutDay: null, next: null, gapDays: 0 }
  const next = lots.find((l) => l.date > stockoutDay!) ?? null
  const gapDays = next ? Math.round((next.date - stockoutDay) / DAY_MS) : horizonDays
  return { stockoutDay, next, gapDays }
}

export function shortageRisks(input: ShortageInput): ShortageRisk[] {
  const today = bkkDayStart(input.now)
  const active = input.locations.filter((l) => l.active !== false && l.type !== 'transit')
  const out: ShortageRisk[] = []
  for (const loc of active) {
    for (const p of input.products) {
      if (!input.tracksProduct(loc.id, p.id)) continue
      const avgDaily = usageAt(input.usage, loc.id, p.id)?.avgDaily ?? null
      // No usage history, or nothing used: no rate to project with — no warning invented.
      if (avgDaily === null || avgDaily <= 0) continue
      const onHand = input.qtyAt(loc.id, p.id)
      const reserved = committedOut(input.transfers, loc.id, p.id)
      const available = Math.max(0, onHand - reserved)
      const lots = incomingLots(input.orders, p.id, loc.id, input.risks, input.leadTimeOf)
      const projected = project(available, avgDaily, lots, today, SHORTAGE_CONFIG.horizonDays)
      // Running out after every order has landed is a reorder question (the reorder
      // suggestions answer it), not a delivery arriving too late: only a stock-out before
      // a delivery — or with nothing on order at all — is this warning.
      const beforeDelivery = projected.stockoutDay !== null && (!lots.length || projected.next !== null)
      const tooSmall =
        projected.stockoutDay !== null &&
        lots.length > 0 &&
        projected.next === null &&
        projected.stockoutDay - today <= SHORTAGE_CONFIG.insufficientWithinDays * DAY_MS
      const { stockoutDay, next, gapDays } = beforeDelivery || tooSmall ? projected : { stockoutDay: null, next: null, gapDays: 0 }
      const reasons: ShortageRisk['reasons'] = []
      let level: RiskLevel = 'LOW'

      if (stockoutDay !== null) {
        const daysAway = Math.round((stockoutDay - today) / DAY_MS)
        if (available <= 0) reasons.push({ code: 'zeroStock', params: {} })
        if (!lots.length) {
          // Nothing on order: the reorder suggestions already cover this; kept, but low key.
          reasons.push({ code: 'noIncoming', params: { days: daysAway } })
          level = daysAway <= 1 ? 'HIGH' : 'MEDIUM'
        } else if (tooSmall) {
          // What is on order lands, but is not enough: out again soon after.
          const last = lots[lots.length - 1]
          reasons.push({ code: 'insufficientIncoming', params: { days: daysAway, docNo: last.docNo, qty: last.qty } })
          level = daysAway <= 1 ? 'CRITICAL' : 'HIGH'
        } else {
          reasons.push({ code: 'gap', params: { days: gapDays, docNo: next?.docNo ?? '', supplier: next?.supplierName ?? '' } })
          level = daysAway <= 1 ? 'CRITICAL' : daysAway <= 3 ? 'HIGH' : 'MEDIUM'
        }
      } else {
        // Arrives in time — unless that delivery is itself at risk and the margin is thin.
        const cover = available / avgDaily
        const first = lots[0]
        if (first && first.risk && LEVEL_RANK[first.risk.level] >= LEVEL_RANK.HIGH) {
          const margin = cover - (first.date - today) / DAY_MS
          if (margin < 1) {
            reasons.push({ code: 'lateRiskWouldGap', params: { docNo: first.docNo, level: first.risk.level, score: first.risk.score } })
            level = 'MEDIUM'
          }
        }
      }
      if (level === 'LOW') continue

      // A too-small order: the gap is until a fresh order could land (the default lead time).
      const gap = tooSmall && !beforeDelivery ? Math.max(1, SHORTAGE_CONFIG.insufficientWithinDays - Math.round(((stockoutDay ?? today) - today) / DAY_MS)) : gapDays
      const shortageQty = Math.ceil(avgDaily * Math.max(gap, reasons.some((r) => r.code === 'lateRiskWouldGap') ? 1 : 0))
      out.push({
        key: `${p.id}__${loc.id}`,
        productId: p.id,
        productName: p.name,
        unit: p.unit,
        locationId: loc.id,
        locationName: loc.name,
        onHand,
        reserved,
        available,
        avgDaily,
        daysOfCover: available / avgDaily,
        stockoutDate: stockoutDay ?? today + Math.floor(available / avgDaily) * DAY_MS,
        incoming: lots,
        nextIncoming: next,
        gapDays: gap,
        shortageQty,
        level,
        reasons,
        transfer: transferOption(input, p, loc.id, shortageQty),
      })
    }
  }
  return out.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.stockoutDate - b.stockoutDate)
}

/**
 * The best location to send from, if one can spare it without running short itself: after
 * giving it still holds its minimum and its own cover for the transfer lead time plus a few
 * days. Never suggests more than the gap needs.
 */
export function transferOption(input: ShortageInput, product: Product, toLocationId: string, need: number): TransferOption | null {
  if (need <= 0) return null
  let best: TransferOption | null = null
  for (const src of input.locations) {
    if (src.id === toLocationId || src.active === false || src.type === 'transit') continue
    const onHand = input.qtyAt(src.id, product.id)
    if (onHand <= 0) continue
    const avg = usageAt(input.usage, src.id, product.id)?.avgDaily ?? 0
    const keeps = Math.max(input.minFor(product, src.id), avg * (TRANSFER_LEAD_DAYS + SHORTAGE_CONFIG.sourceKeepDays))
    const spare = Math.floor(onHand - committedOut(input.transfers, src.id, product.id) - keeps)
    if (spare < 1) continue
    const qty = Math.min(spare, Math.ceil(need))
    if (!best || qty > best.qty) best = { fromLocationId: src.id, fromLocationName: src.name, qty, sourceAfter: onHand - qty, sourceKeeps: keeps }
  }
  return best
}
