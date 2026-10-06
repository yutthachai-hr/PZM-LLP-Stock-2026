import type { Product, StockLocation, TransferStatus } from '../types'
import { TRANSFER_LEAD_DAYS } from '../lib/inventoryRules/suggestions'
import { bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { usageAt } from '../lib/inventoryRules/usage'
import { meta, round3, type DataNote, type IntelMeta, type Reason } from './meta'
import { simulate, stockoutFor, STOCKOUT_CONFIG, type StockoutInput, type StockoutIntel } from './stockout'

/**
 * G3 — Transfer before buying: can another location cover the shortage?
 *
 * A recommendation is valid only when BOTH hold:
 *  - the destination's shortage gets smaller, and
 *  - the source stays at or above what it needs itself afterwards: its minimum, its own use
 *    for the transfer lead time plus SOURCE_KEEP_DAYS, and no stock-out over the horizon
 *    that it did not already have (its own incoming counted, its pending transfer requests
 *    taken off first — conservatively, as if they will all be approved).
 *
 * Recommendation only: the screen offers "สร้างคำขอโอน" which opens a draft for a person.
 */

export const SOURCE_KEEP_DAYS = 3
/** Requests not yet approved: counted against a source here, so two shortages cannot both claim the same spare. */
const PENDING_OUT: readonly TransferStatus[] = ['draft', 'pendingApproval', 'returned']

export interface TransferRecommendation {
  meta: IntelMeta
  productId: string
  productName: string
  unit: string
  source: { locationId: string; locationName: string; before: number; after: number; required: number; pendingOut: number }
  destination: { locationId: string; locationName: string; shortageBefore: number; shortageAfter: number; gapDaysBefore: number; gapDaysAfter: number }
  qty: number
  reasons: Reason[]
}

export interface TransferInput extends StockoutInput {
  minFor: (product: Product, locationId: string) => number
}

export function transferCandidates(input: TransferInput, shortage: StockoutIntel): TransferRecommendation[] {
  const pred = shortage.prediction
  if (!pred) return []
  const need = pred.estimatedShortageQty > 0 ? pred.estimatedShortageQty : pred.riskAdjusted.estimatedShortageQty
  if (need <= 0) return []
  const product = input.products.find((p) => p.id === shortage.productId)
  const dest = input.locations.find((l) => l.id === shortage.locationId)
  if (!product || !dest || !shortage.avgDaily) return []
  const today = bkkDayStart(input.now)
  const arrive = today + TRANSFER_LEAD_DAYS * DAY_MS
  const destFlows = shortage.incoming.map((f) => ({ qty: f.qty, date: f.date }))
  const destBefore = simulate(shortage.available, shortage.avgDaily, destFlows, today, STOCKOUT_CONFIG.horizonDays)
  const out: TransferRecommendation[] = []
  for (const src of input.locations) {
    if (src.id === dest.id || src.active === false || src.type === 'transit') continue
    const onHand = input.qtyAt(src.id, product.id)
    if (onHand <= 0) continue
    let pendingOut = 0
    for (const t of input.transfers) {
      if (t.fromLocationId !== src.id || !PENDING_OUT.includes(t.status)) continue
      for (const i of t.items) if (i.productId === product.id && !i.removed) pendingOut += i.dispatchQty || i.requestedQty || 0
    }
    const notes: DataNote[] = []
    const srcAvg = usageAt(input.usage, src.id, product.id)?.avgDaily ?? null
    if (srcAvg === null) notes.push('shortUsageHistory')
    const min = input.minFor(product, src.id)
    if (!(min > 0)) notes.push('noSafetyLevel')
    const required = Math.max(min, (srcAvg ?? 0) * (TRANSFER_LEAD_DAYS + SOURCE_KEEP_DAYS))
    const srcState = stockoutFor(input, product, src)
    const srcFlows = srcState.incoming.map((f) => ({ qty: f.qty, date: f.date }))
    const srcAvail = Math.max(0, onHand - srcState.reserved - pendingOut)
    const baseline = srcAvg ? simulate(srcAvail, srcAvg, srcFlows, today, STOCKOUT_CONFIG.horizonDays).gapDays : 0
    // The most it can give: down to `required`, and no new gap day of its own.
    let give = Math.floor(srcAvail - required)
    while (give >= 1 && srcAvg && simulate(srcAvail - give, srcAvg, srcFlows, today, STOCKOUT_CONFIG.horizonDays).gapDays > baseline) give--
    if (give < 1) continue
    const qty = Math.min(give, Math.ceil(need))
    const after = simulate(shortage.available, shortage.avgDaily, [...destFlows, { qty, date: arrive }], today, STOCKOUT_CONFIG.horizonDays)
    // Valid only if the destination is actually better off.
    if (after.estimatedShortageQty >= destBefore.estimatedShortageQty && after.gapDays >= destBefore.gapDays) continue
    const reasons: Reason[] = [
      { code: 'transfer.destNeed', params: { need: Math.ceil(need), gapDays: destBefore.gapDays, location: dest.name } },
      { code: 'transfer.sourceSpare', params: { onHand: round3(onHand), pendingOut: round3(pendingOut), required: round3(required), min, avgDaily: srcAvg === null ? '—' : round3(srcAvg), keepDays: TRANSFER_LEAD_DAYS + SOURCE_KEEP_DAYS } },
      { code: 'transfer.effect', params: { shortageBefore: destBefore.estimatedShortageQty, shortageAfter: after.estimatedShortageQty, gapBefore: destBefore.gapDays, gapAfter: after.gapDays } },
    ]
    out.push({
      meta: meta('transfer', input, notes, notes.includes('shortUsageHistory') ? 'low' : notes.length ? 'medium' : 'high'),
      productId: product.id,
      productName: product.name,
      unit: product.unitType,
      source: { locationId: src.id, locationName: src.name, before: round3(onHand), after: round3(onHand - qty), required: round3(required), pendingOut: round3(pendingOut) },
      destination: {
        locationId: dest.id,
        locationName: dest.name,
        shortageBefore: destBefore.estimatedShortageQty,
        shortageAfter: after.estimatedShortageQty,
        gapDaysBefore: destBefore.gapDays,
        gapDaysAfter: after.gapDays,
      },
      qty,
      reasons,
    })
  }
  return out.sort((a, b) => a.destination.shortageAfter - b.destination.shortageAfter || b.qty - a.qty)
}

/** The best candidate, or null when no location can safely help. */
export function bestTransfer(input: TransferInput, shortage: StockoutIntel): TransferRecommendation | null {
  return transferCandidates(input, shortage)[0] ?? null
}

/** For the tests: does giving `qty` from `src` create a stock-out it did not already have? */
export function sourceWouldShort(input: TransferInput, product: Product, src: StockLocation, qty: number): boolean {
  const s = stockoutFor(input, product, src)
  if (!s.avgDaily) return s.available - qty < input.minFor(product, src.id)
  const today = bkkDayStart(input.now)
  const flows = s.incoming.map((f) => ({ qty: f.qty, date: f.date }))
  const before = simulate(s.available, s.avgDaily, flows, today, STOCKOUT_CONFIG.horizonDays).gapDays
  const after = simulate(s.available - qty, s.avgDaily, flows, today, STOCKOUT_CONFIG.horizonDays).gapDays
  return after > before
}
