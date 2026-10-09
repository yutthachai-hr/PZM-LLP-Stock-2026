import { LEVEL_RANK } from '../lib/deliveryRisk'
import { DEFAULT_LEAD_DAYS } from '../lib/inventoryRules/reorder'
import { bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { meta, round3, weaker, type DataNote, type IntelMeta, type Reason } from './meta'
import type { StockoutIntel } from './stockout'

/**
 * G4 — How much to buy, with every step of the arithmetic shown.
 *
 *     forecast demand   = avg daily use × (lead time + cover days)
 *   + safety            = max(minimum, avg daily use × safety days)
 *   − available         (on hand − reserved)
 *   − reliable incoming (placed orders due inside the window and not HIGH/CRITICAL risk,
 *                        goods in transit to here)
 *   − transfer          (a G3 recommendation the person is taking, if any)
 *   = need, then rounded up to the supplier's minimum order and its pack
 *
 * A risky delivery is left out of "reliable" and listed, so the person sees what the
 * number assumes. No usage history = no recommendation, said plainly.
 */

export interface PurchaseStep {
  code: 'forecast' | 'safety' | 'available' | 'reliableIncoming' | 'transfer' | 'need' | 'moq' | 'pack' | 'recommended'
  /** Signed contribution, in the product's unit (the pack step shows the rounded total). */
  value: number
  params: Record<string, string | number>
}

export interface PurchaseRecommendation {
  meta: IntelMeta
  productId: string
  locationId: string
  supplierId?: string
  /** In the product's own unit. 0 = nothing to buy. Null = no reliable recommendation. */
  qty: number | null
  /** The same in the supplier's pack, when one is given: "24 CTN". */
  packs?: { label: string; size: number; count: number }
  steps: PurchaseStep[]
  /** Deliveries left out of "reliable", and why. */
  unreliable: { docNo: string; qty: number; why: 'risk' | 'outsideWindow' | 'noDate' }[]
  reasons: Reason[]
}

export interface PurchaseContext {
  supplierId?: string
  leadTimeDays?: number
  coverDays: number
  safetyDays?: number
  min: number
  minOrderQty?: number
  pack?: { label: string; size: number }
  /** Units a recommended transfer will bring (G3), taken off the need. */
  transferQty?: number
  now: number
  asOf?: number
}

export function purchaseRecommendation(state: StockoutIntel, ctx: PurchaseContext): PurchaseRecommendation {
  const notes: DataNote[] = [...state.meta.dataNotes]
  const base = { productId: state.productId, locationId: state.locationId, ...(ctx.supplierId ? { supplierId: ctx.supplierId } : {}) }
  if (state.avgDaily === null) {
    return {
      meta: meta('purchase', ctx, notes, 'insufficient'),
      ...base,
      qty: null,
      steps: [],
      unreliable: [],
      reasons: [{ code: 'purchase.noUsage', params: {} }],
    }
  }
  const avg = state.avgDaily
  const lead = ctx.leadTimeDays ?? DEFAULT_LEAD_DAYS
  if (ctx.leadTimeDays === undefined) notes.push('unknownLeadTime')
  const safetyDays = ctx.safetyDays ?? 0
  const window = bkkDayStart(ctx.now) + (lead + ctx.coverDays) * DAY_MS
  const forecast = avg * (lead + ctx.coverDays)
  const safety = Math.max(ctx.min, avg * safetyDays)
  if (!(ctx.min > 0) && !safetyDays) notes.push('noSafetyLevel')
  let reliable = 0
  const unreliable: PurchaseRecommendation['unreliable'] = []
  for (const f of state.incoming) {
    if (f.date === null) unreliable.push({ docNo: f.docNo, qty: f.qty, why: 'noDate' })
    else if (f.date > window) unreliable.push({ docNo: f.docNo, qty: f.qty, why: 'outsideWindow' })
    else if (f.risk && LEVEL_RANK[f.risk.level] >= LEVEL_RANK.HIGH) unreliable.push({ docNo: f.docNo, qty: f.qty, why: 'risk' })
    else reliable += f.qty
  }
  const transfer = Math.max(0, ctx.transferQty ?? 0)
  const need = forecast + safety - state.available - reliable - transfer
  const steps: PurchaseStep[] = [
    { code: 'forecast', value: round3(forecast), params: { avgDaily: round3(avg), lead, cover: ctx.coverDays } },
    { code: 'safety', value: round3(safety), params: { min: ctx.min, safetyDays } },
    { code: 'available', value: -round3(state.available), params: { onHand: state.onHand, reserved: state.reserved } },
    { code: 'reliableIncoming', value: -round3(reliable), params: { n: state.incoming.length - unreliable.length } },
  ]
  if (transfer) steps.push({ code: 'transfer', value: -transfer, params: {} })
  steps.push({ code: 'need', value: round3(need), params: {} })
  let qty = need > 0 ? Math.ceil(round3(need)) : 0
  if (qty > 0 && ctx.minOrderQty && qty < ctx.minOrderQty) {
    qty = Math.ceil(ctx.minOrderQty)
    steps.push({ code: 'moq', value: qty, params: { moq: ctx.minOrderQty } })
  }
  let packs: PurchaseRecommendation['packs']
  if (qty > 0 && ctx.pack && ctx.pack.size > 0) {
    const count = Math.ceil(qty / ctx.pack.size)
    qty = round3(count * ctx.pack.size)
    packs = { label: ctx.pack.label, size: ctx.pack.size, count }
    steps.push({ code: 'pack', value: qty, params: { label: ctx.pack.label, size: ctx.pack.size, count } })
  }
  steps.push({ code: 'recommended', value: qty, params: {} })
  const reasons: Reason[] = [{ code: qty > 0 ? 'purchase.buy' : 'purchase.enough', params: { qty, need: round3(need) } }]
  if (unreliable.length) reasons.push({ code: 'purchase.excludedIncoming', params: { n: unreliable.length, qty: round3(unreliable.reduce((s, u) => s + u.qty, 0)) } })
  const m = meta('purchase', ctx, notes)
  return {
    meta: { ...m, dataConfidence: weaker(m.dataConfidence, state.meta.dataConfidence === 'insufficient' ? 'low' : state.meta.dataConfidence) },
    ...base,
    qty,
    ...(packs ? { packs } : {}),
    steps,
    unreliable,
    reasons,
  }
}
