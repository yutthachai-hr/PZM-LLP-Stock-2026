import type { Product, Supplier, SupplierItem } from '../types'
import { DEFAULT_LEAD_DAYS } from '../lib/inventoryRules/reorder'
import { bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { meta, round3, type DataNote, type IntelMeta, type Reason } from './meta'
import { simulate, STOCKOUT_CONFIG, type StockoutIntel } from './stockout'
import type { SupplierIntel } from './supplier'

/**
 * G5 — Which of a product's suppliers, if it is short: the tradeoffs, side by side.
 *
 * For the usual supplier and every listed alternate that is active: price (supplierItems'
 * buying price, per the product's unit), lead time, the supplier's score and its record on
 * this very product, and what ordering `qty` from it today would do to the shortage — the
 * gap days left if it arrives on its lead time, delayed by its usual lateness when it is
 * often late. "B costs +25 per CTN but closes the 2-day gap" is the sentence this makes.
 *
 * Never switches anything: the order still goes to `product.supplierId` unless a person
 * picks another on the order.
 */

export interface SupplierOption {
  supplierId: string
  supplierName: string
  primary: boolean
  price: number | null
  /** Per unit of the product, against the usual supplier (null when either price is unknown). */
  priceDiff: number | null
  leadTimeDays: number
  /** Days added for its usual lateness (median delay when its on-time rate is under 80%). */
  expectedDelayDays: number
  expectedArrival: number
  gapDaysIfOrdered: number
  shortageIfOrdered: number
  score: number | null
  skuOnTimeRate: number | null
  skuDeliveries: number
  dataNotes: DataNote[]
}

export interface AlternateSupplierIntel {
  meta: IntelMeta
  productId: string
  locationId: string
  qty: number
  options: SupplierOption[]
  /** One line per alternate against the usual supplier. */
  tradeoffs: Reason[]
}

export function alternateSuppliers(input: {
  product: Product
  shortage: StockoutIntel
  qty: number
  suppliers: readonly Supplier[]
  items: readonly SupplierItem[]
  intel: ReadonlyMap<string, SupplierIntel>
  now: number
  asOf?: number
}): AlternateSupplierIntel | null {
  const { product, shortage } = input
  const ids = [product.supplierId, ...(product.alternateSupplierIds ?? [])].filter((x): x is string => !!x)
  const eligible = [...new Set(ids)].map((id) => input.suppliers.find((s) => s.id === id)).filter((s): s is Supplier => !!s && s.active !== false)
  if (eligible.length < 2 || !shortage.avgDaily) return null
  const today = bkkDayStart(input.now)
  const flows = shortage.incoming.map((f) => ({ qty: f.qty, date: f.date }))
  const options: SupplierOption[] = eligible.map((s) => {
    const notes: DataNote[] = []
    const item = input.items.find((i) => i.supplierId === s.id && i.productId === product.id && i.active !== false)
    const price = item?.buyingPrice ?? null
    if (price === null) notes.push('noPrice')
    const lead = s.leadTimeDays ?? DEFAULT_LEAD_DAYS
    if (s.leadTimeDays === undefined) notes.push('unknownLeadTime')
    const intel = input.intel.get(s.id)
    if (!intel || intel.meta.dataConfidence === 'insufficient') notes.push('noSupplierHistory')
    const onTime = intel?.stats.onTime.rate ?? null
    const delay = onTime !== null && onTime < 0.8 ? (intel?.stats.delay.median ?? 1) : 0
    const arrival = today + (lead + delay) * DAY_MS
    const sim = simulate(shortage.available, shortage.avgDaily!, [...flows, { qty: input.qty, date: arrival }], today, STOCKOUT_CONFIG.horizonDays)
    const sku = intel?.skus.find((k) => k.productId === product.id)
    return {
      supplierId: s.id,
      supplierName: s.name,
      primary: s.id === product.supplierId,
      price,
      priceDiff: null,
      leadTimeDays: lead,
      expectedDelayDays: delay,
      expectedArrival: arrival,
      gapDaysIfOrdered: sim.gapDays,
      shortageIfOrdered: sim.estimatedShortageQty,
      score: intel?.score ?? null,
      skuOnTimeRate: sku?.onTimeRate ?? null,
      skuDeliveries: sku?.deliveries ?? 0,
      dataNotes: notes,
    }
  })
  const primary = options.find((o) => o.primary) ?? options[0]
  for (const o of options) o.priceDiff = o.price !== null && primary.price !== null ? round3(o.price - primary.price) : null
  const tradeoffs: Reason[] = options
    .filter((o) => o !== primary)
    .map((o) => ({
      code: 'alternate.tradeoff',
      params: {
        supplier: o.supplierName,
        primary: primary.supplierName,
        priceDiff: o.priceDiff === null ? '—' : o.priceDiff,
        gapDiff: primary.gapDaysIfOrdered - o.gapDaysIfOrdered,
        leadDiff: o.leadTimeDays - primary.leadTimeDays,
        score: o.score === null ? '—' : Math.round(o.score),
        primaryScore: primary.score === null ? '—' : Math.round(primary.score),
      },
    }))
  const all = options.flatMap((o) => o.dataNotes)
  return {
    meta: meta('alternate', input, all, all.includes('noSupplierHistory') || all.includes('noPrice') ? 'low' : all.length ? 'medium' : 'high'),
    productId: product.id,
    locationId: shortage.locationId,
    qty: input.qty,
    options: options.sort((a, b) => a.gapDaysIfOrdered - b.gapDaysIfOrdered || (a.price ?? Infinity) - (b.price ?? Infinity)),
    tradeoffs,
  }
}
