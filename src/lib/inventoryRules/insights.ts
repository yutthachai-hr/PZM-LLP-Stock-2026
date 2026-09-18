import type {
  InventorySettings,
  Product,
  PurchaseOrder,
  PurchaseRequest,
  ReorderSnooze,
  StockLocation,
  StockMovement,
  Supplier,
} from '../../types'
import { significance } from './adjustments'
import { shortages, type StockShortage } from './lowStock'
import { incomingFor, openPurchaseFor, type OpenPurchase } from './purchasing'
import { recommend, stockoutSoon } from './reorder'
import type { StockView } from './stockView'
import { usageAt, usageIndex } from './usage'

/**
 * Everything worth saying about the stock itself, in one pass: what is low or out, what is
 * worth reordering, what will run out before a delivery could land, and which adjustments
 * were big enough to mention. The calendar draws it; the notification engine announces it;
 * the Worker computes it from the same documents. One function, so they cannot disagree.
 */

export interface ReorderInsight {
  product: Product
  location: StockLocation
  onHand: number
  incoming: number
  avgDaily: number | null
  daysLeft: number | null
  recommendedQty: number
  basis: 'usage' | 'minStock'
  leadTimeDays: number
  supplier?: Supplier
  /** A request or order already covering it — shown, and no notification is raised. */
  inProgress: OpenPurchase | null
}

export interface StockoutInsight {
  product: Product
  location: StockLocation
  qty: number
  avgDaily: number
  daysLeft: number
}

export interface AdjustmentInsight {
  movement: StockMovement
  product?: Product
  kind: 'adjustment' | 'waste'
  value: number | null
  pct: number | null
}

export interface InsightInput extends StockView {
  products: readonly Product[]
  locations: readonly StockLocation[]
  movements: readonly StockMovement[]
  orders: readonly PurchaseOrder[]
  requests: readonly PurchaseRequest[]
  suppliers: readonly Supplier[]
  settings: Pick<InventorySettings, 'coverDays' | 'usageWindowDays' | 'adjustValueBaht' | 'adjustPct' | 'wasteValueBaht'>
  snoozes?: readonly ReorderSnooze[]
  /** Supplier minimum order per product, when known (supplierItems). */
  minOrderQty?: (productId: string, supplierId: string | undefined) => number | undefined
  now: number
  /** Adjustments on or after this are considered. */
  adjustmentsSince: number
}

export interface Insights {
  shortages: StockShortage[]
  reorders: ReorderInsight[]
  stockouts: StockoutInsight[]
  adjustments: AdjustmentInsight[]
}

export const snoozeIdFor = (productId: string, locationId: string) => `snooze__reorder__${productId}__${locationId}`

export function inventoryInsights(input: InsightInput): Insights {
  const { now } = input
  const usage = usageIndex(input.movements, now, input.settings.usageWindowDays)
  const supplierById = new Map(input.suppliers.map((s) => [s.id, s]))
  const productById = new Map(input.products.map((p) => [p.id, p]))
  const snoozed = new Set((input.snoozes ?? []).filter((s) => s.until > now).map((s) => s.id))
  const reorders: ReorderInsight[] = []
  const stockouts: StockoutInsight[] = []

  for (const product of input.products) {
    if (product.active === false) continue
    const supplier = product.supplierId ? supplierById.get(product.supplierId) : undefined
    for (const location of input.locations) {
      if (location.active === false || !input.tracksProduct(location.id, product.id)) continue
      const onHand = input.qtyAt(location.id, product.id)
      const incoming = incomingFor(product.id, location.id, input.orders)
      const avgDaily = usageAt(usage, location.id, product.id)?.avgDaily ?? null
      const min = input.minFor(product, location.id)
      const rec = recommend({
        onHand,
        incoming,
        avgDaily,
        min,
        leadTimeDays: supplier?.leadTimeDays,
        coverDays: input.settings.coverDays,
        minOrderQty: input.minOrderQty?.(product.id, product.supplierId),
      })
      if (rec && !snoozed.has(snoozeIdFor(product.id, location.id))) {
        reorders.push({
          product,
          location,
          onHand,
          incoming,
          avgDaily,
          daysLeft: rec.daysLeft,
          recommendedQty: rec.recommendedQty,
          basis: rec.basis,
          leadTimeDays: rec.leadTimeDays,
          supplier,
          inProgress: openPurchaseFor(product.id, location.id, input),
        })
      }
      const days = stockoutSoon(onHand, incoming, avgDaily, supplier?.leadTimeDays)
      if (days !== null && avgDaily !== null) stockouts.push({ product, location, qty: onHand, avgDaily, daysLeft: days })
    }
  }

  const adjustments: AdjustmentInsight[] = []
  for (const m of input.movements) {
    if (m.type !== 'adjust' || m.date < input.adjustmentsSince) continue
    const product = productById.get(m.productId)
    const loc = m.fromLocationId ?? m.toLocationId
    const sig = significance(m, product, loc ? input.qtyAt(loc, m.productId) : 0, input.settings)
    if (sig) adjustments.push({ movement: m, product, kind: sig.kind, value: sig.value, pct: sig.pct })
  }

  return { shortages: shortages(input), reorders, stockouts, adjustments }
}
