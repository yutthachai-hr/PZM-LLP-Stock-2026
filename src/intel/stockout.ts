import type { Product, PurchaseOrder, StockLocation, Transfer } from '../types'
import { confirmedDateOf } from '../lib/deliveryMetrics'
import { LEVEL_RANK, type DeliveryRisk, type RiskLevel } from '../lib/deliveryRisk'
import { expectedDeliveryAt, remainingBaseQty } from '../lib/inventoryRules/purchasing'
import { RESERVING_STATUSES } from '../lib/inventoryRules/supply'
import { TRANSFER_LEAD_DAYS } from '../lib/inventoryRules/suggestions'
import { bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { usageAt, type UsageIndex } from '../lib/inventoryRules/usage'
import { meta, round3, weaker, type DataNote, type IntelMeta, type Reason } from './meta'

/**
 * G2 — Stockout intelligence per SKU × location.
 *
 *   available = on hand − reserved (real commitments only, as E1)
 *   incoming  = what placed orders still owe (partial receipts subtracted; cancelled orders
 *               and closed remainders are not `ordered`, so they owe nothing) + goods in
 *               transit to here, each on the day it is expected
 *   walk the days: arrivals land in the morning, the day's use goes out; every unit a day
 *   cannot supply is shortage, every day that happens is a gap day.
 *
 * Run twice: on the dates promised, and with each risky delivery (HIGH/CRITICAL) moved by
 * its supplier's P90 delay — so "arrives in time, unless it is late as usual" is said.
 * No usage rate = no prediction: `prediction: null` with the reason, never a guess.
 */

export const STOCKOUT_CONFIG = { horizonDays: 14, staleBalanceHours: 24 }

export interface IncomingFlow {
  kind: 'po' | 'transfer'
  id: string
  docNo: string
  qty: number
  /** Start of the Bangkok day it is expected; null when no date is known (not projected). */
  date: number | null
  /** The day used in the risk-adjusted run. */
  adjustedDate: number | null
  risk?: { level: RiskLevel; score: number }
  supplierId?: string
}

export interface StockoutPrediction {
  estimatedStockoutDate: number | null
  estimatedShortageQty: number
  gapDays: number
  /** The same, with risky deliveries moved by their supplier's P90 delay. */
  riskAdjusted: { estimatedStockoutDate: number | null; estimatedShortageQty: number; gapDays: number }
  riskLevel: RiskLevel
}

export interface StockoutIntel {
  meta: IntelMeta
  key: string
  productId: string
  productName: string
  unit: string
  locationId: string
  locationName: string
  onHand: number
  reserved: number
  available: number
  avgDaily: number | null
  daysOfCover: number | null
  incoming: IncomingFlow[]
  /** Null = no reliable prediction (see meta.dataNotes). */
  prediction: StockoutPrediction | null
  reasons: Reason[]
}

export interface StockoutInput {
  products: readonly Product[]
  locations: readonly StockLocation[]
  qtyAt: (locationId: string, productId: string) => number
  tracksProduct: (locationId: string, productId: string) => boolean
  usage: UsageIndex
  orders: readonly PurchaseOrder[]
  transfers: readonly Transfer[]
  risks: ReadonlyMap<string, DeliveryRisk>
  /** P90 delay in days for a supplier's late deliveries; null/undefined when unknown. */
  p90DelayOf?: (supplierId: string) => number | null | undefined
  leadTimeOf?: (supplierId: string) => number | undefined
  /** When the balances were read; older than a day is flagged stale. */
  balanceAsOf?: number
  now: number
  asOf?: number
}

/** A day-by-day walk. Pure; exported for the tests and the backtest. */
export function simulate(available: number, avgDaily: number, flows: readonly { date: number | null; qty: number }[], today: number, horizonDays: number) {
  let stock = available
  let first: number | null = null
  let unmet = 0
  let gap = 0
  for (let d = 0; d <= horizonDays; d++) {
    const day = today + d * DAY_MS
    for (const f of flows) if (f.date !== null && (f.date === day || (d === 0 && f.date < today))) stock += f.qty
    if (stock >= avgDaily) stock -= avgDaily
    else {
      unmet += avgDaily - stock
      stock = 0
      gap++
      if (first === null) first = day
    }
  }
  return { estimatedStockoutDate: first, estimatedShortageQty: Math.ceil(round3(unmet)), gapDays: gap }
}

function levelFor(firstDay: number | null, today: number, adjustedFirst: number | null): RiskLevel {
  if (firstDay !== null) {
    const away = Math.round((firstDay - today) / DAY_MS)
    return away <= 1 ? 'CRITICAL' : away <= 3 ? 'HIGH' : 'MEDIUM'
  }
  return adjustedFirst !== null ? 'MEDIUM' : 'LOW'
}

export function stockoutFor(input: StockoutInput, product: Product, loc: StockLocation): StockoutIntel {
  const today = bkkDayStart(input.now)
  const notes: DataNote[] = []
  const reasons: Reason[] = []
  const onHand = input.qtyAt(loc.id, product.id)
  let reserved = 0
  for (const t of input.transfers) {
    if (t.fromLocationId !== loc.id || !RESERVING_STATUSES.includes(t.status)) continue
    for (const i of t.items) if (i.productId === product.id && !i.removed) reserved += i.dispatchQty || i.requestedQty || 0
  }
  const available = Math.max(0, onHand - reserved)
  const stat = usageAt(input.usage, loc.id, product.id)
  const avgDaily = stat?.avgDaily ?? null
  if (avgDaily === null) notes.push(stat && stat.moves > 0 ? 'shortUsageHistory' : 'noUsageHistory')
  if (input.balanceAsOf !== undefined && input.now - input.balanceAsOf > STOCKOUT_CONFIG.staleBalanceHours * 3_600_000) notes.push('staleBalance')

  // What is coming. Only `ordered` POs owe anything: cancelled ones and closed remainders
  // (status received) are out by their status; a partial receipt is subtracted per line.
  const incoming: IncomingFlow[] = []
  for (const o of input.orders) {
    if (o.status !== 'ordered' || o.locationId !== loc.id) continue
    let qty = 0
    for (const l of o.lines) {
      if (l.productId !== product.id) continue
      const r = remainingBaseQty(l, product)
      if (r.unknown) notes.push('unknownUnit')
      qty += r.qty
    }
    if (qty <= 0) continue
    const due = confirmedDateOf(o) ?? expectedDeliveryAt(o, input.leadTimeOf?.(o.supplierId)) ?? null
    if (due === null) notes.push('missingIncomingDate')
    const risk = input.risks.get(o.id)
    const date = due === null ? null : bkkDayStart(due)
    const p90 = risk && LEVEL_RANK[risk.level] >= LEVEL_RANK.HIGH ? (input.p90DelayOf?.(o.supplierId) ?? 1) : 0
    incoming.push({
      kind: 'po',
      id: o.id,
      docNo: o.docNo,
      qty: round3(qty),
      date,
      adjustedDate: date === null ? null : date + Math.max(0, p90 ?? 0) * DAY_MS,
      supplierId: o.supplierId,
      ...(risk ? { risk: { level: risk.level, score: risk.score } } : {}),
    })
  }
  // Goods already on the road to here count as incoming, on the day they should land.
  for (const t of input.transfers) {
    if (t.toLocationId !== loc.id || (t.status !== 'inTransit' && t.status !== 'receiving')) continue
    const qty = t.items.filter((i) => i.productId === product.id && !i.removed).reduce((s, i) => s + (i.dispatchQty || 0), 0)
    if (qty <= 0) continue
    const date = Math.max(today, bkkDayStart(t.dispatchDate) + TRANSFER_LEAD_DAYS * DAY_MS)
    incoming.push({ kind: 'transfer', id: t.id, docNo: t.docNo, qty: round3(qty), date, adjustedDate: date })
  }
  incoming.sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity))

  let prediction: StockoutPrediction | null = null
  if (avgDaily !== null && avgDaily > 0) {
    const h = STOCKOUT_CONFIG.horizonDays
    const nominal = simulate(available, avgDaily, incoming, today, h)
    const adjusted = simulate(available, avgDaily, incoming.map((f) => ({ qty: f.qty, date: f.adjustedDate })), today, h)
    const riskLevel = levelFor(nominal.estimatedStockoutDate, today, adjusted.estimatedStockoutDate)
    prediction = { ...nominal, riskAdjusted: adjusted, riskLevel }
    reasons.push({ code: 'stockout.basis', params: { available: round3(available), avgDaily: round3(avgDaily), cover: round3(available / avgDaily), incoming: incoming.length } })
    if (nominal.estimatedStockoutDate !== null) {
      const next = incoming.find((f) => f.date !== null && f.date > nominal.estimatedStockoutDate!)
      reasons.push({
        code: incoming.length ? 'stockout.gapBeforeDelivery' : 'stockout.nothingOnOrder',
        params: { gapDays: nominal.gapDays, shortage: nominal.estimatedShortageQty, docNo: next?.docNo ?? '' },
      })
    } else if (adjusted.estimatedStockoutDate !== null) {
      const risky = incoming.find((f) => f.risk && LEVEL_RANK[f.risk.level] >= LEVEL_RANK.HIGH)
      reasons.push({ code: 'stockout.lateDeliveryWouldGap', params: { docNo: risky?.docNo ?? '', level: risky?.risk?.level ?? '', score: risky?.risk?.score ?? 0, gapDays: adjusted.gapDays } })
    }
  } else if (avgDaily === 0) {
    reasons.push({ code: 'stockout.noUse', params: {} })
  }
  if (reserved > 0) reasons.push({ code: 'stockout.reserved', params: { qty: round3(reserved) } })

  let m = meta('stockout', input, notes)
  // A unit we cannot convert hides part of what is coming: weaker, but the rest still stands.
  if (notes.includes('unknownUnit') && avgDaily !== null) m = { ...m, dataConfidence: weaker('low', m.dataConfidence === 'insufficient' ? 'low' : m.dataConfidence) }
  if (avgDaily === null) prediction = null
  return {
    meta: m,
    key: `${product.id}__${loc.id}`,
    productId: product.id,
    productName: product.name,
    unit: product.unitType,
    locationId: loc.id,
    locationName: loc.name,
    onHand,
    reserved: round3(reserved),
    available: round3(available),
    avgDaily,
    daysOfCover: avgDaily ? round3(available / avgDaily) : null,
    incoming,
    prediction,
    reasons,
  }
}

/** Every tracked SKU × location with a predicted shortage (or a risky margin), worst first. */
export function stockoutIntel(input: StockoutInput, opts: { includeLow?: boolean } = {}): StockoutIntel[] {
  const out: StockoutIntel[] = []
  for (const loc of input.locations) {
    if (loc.active === false || loc.type === 'transit') continue
    for (const p of input.products) {
      if (p.active === false || !input.tracksProduct(loc.id, p.id)) continue
      const r = stockoutFor(input, p, loc)
      if (!opts.includeLow && (!r.prediction || r.prediction.riskLevel === 'LOW')) continue
      out.push(r)
    }
  }
  const rank = (r: StockoutIntel) => (r.prediction ? LEVEL_RANK[r.prediction.riskLevel] : -1)
  return out.sort((a, b) => rank(b) - rank(a) || (a.prediction?.estimatedStockoutDate ?? Infinity) - (b.prediction?.estimatedStockoutDate ?? Infinity))
}
