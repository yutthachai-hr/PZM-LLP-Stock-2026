import type { Product, PurchaseOrder, StockLocation, StockMovement, Supplier, Transfer } from '../types'
import { assessAll } from './deliveryRisk'
import { shortageRisks } from './inventoryRisk'
import type { RiskEngineInput } from './inventoryRules/notifications'
import { usageIndex } from './inventoryRules/usage'

/**
 * Delivery risk and stock-outs before deliveries, reduced to what the notification engine
 * needs (5 Oct 2026). The engine (inventoryRules/notifications `evaluate`, job `risk`)
 * turns a level reached into one document per level — so a score moving inside a level
 * writes nothing, and only a crossing announces itself.
 */
export function riskEngineInput(input: {
  orders: readonly PurchaseOrder[]
  transfers: readonly Transfer[]
  suppliers: readonly Supplier[]
  products: readonly Product[]
  locations: readonly StockLocation[]
  qtyAt: (locationId: string, productId: string) => number
  minFor: (product: Product, locationId: string) => number
  tracksProduct: (locationId: string, productId: string) => boolean
  movements: readonly StockMovement[]
  usageWindowDays: number
  now: number
}): RiskEngineInput {
  const risks = assessAll(input.orders, input.now, input.suppliers)
  const byId = new Map(input.orders.map((o) => [o.id, o]))
  const shortages = shortageRisks({
    products: input.products,
    locations: input.locations,
    qtyAt: input.qtyAt,
    minFor: input.minFor,
    tracksProduct: input.tracksProduct,
    usage: usageIndex(input.movements, input.now, input.usageWindowDays),
    orders: input.orders,
    transfers: input.transfers,
    risks,
    leadTimeOf: (id) => input.suppliers.find((s) => s.id === id)?.leadTimeDays,
    now: input.now,
  })
  return {
    deliveries: [...risks.values()].map((r) => {
      const o = byId.get(r.poId)
      return {
        poId: r.poId,
        docNo: r.docNo,
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        locationId: o?.locationId ?? '',
        level: r.level,
        score: r.score,
        // Whoever placed and sent it hears about it, besides the managers.
        people: [...new Set([o?.sentBy, o?.createdBy].filter((u): u is string => !!u))],
      }
    }),
    // Only a stock-out tied to a delivery — "nothing on order" is the reorder alerts' job.
    shortages: shortages
      .filter((s) => s.incoming.length > 0)
      .map((s) => ({
        productId: s.productId,
        productName: s.productName,
        locationId: s.locationId,
        locationName: s.locationName,
        level: s.level,
        stockoutDate: s.stockoutDate,
        gapDays: s.gapDays,
        docNo: s.nextIncoming?.docNo ?? s.incoming[s.incoming.length - 1].docNo,
      })),
  }
}
