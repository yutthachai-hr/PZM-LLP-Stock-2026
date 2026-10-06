import type { Product, PurchaseOrder } from '../types'
import { resolveFactor, toBase } from './inventoryRules/uom'
import { sameUnit } from './units'

/**
 * The `baseQty` backfill for order lines keyed in another unit before lines carried it
 * (plan A2, 6 Oct 2026). Pure, and only a plan: it says what would be written, and what
 * could not be worked out, so nothing is ever set — or skipped — silently. Writing it is
 * a separate step the owner has to order.
 *
 * Only orders still `ordered`: a received or cancelled order owes nothing, so its lines
 * never reach the incoming figure and are left as they were filed.
 */
export interface BackfillLine {
  poId: string
  docNo: string
  supplierName: string
  index: number
  productId: string
  productName: string
  entryUnit: string
  orderedQty: number
  /** The product's rate today, base units per one `entryUnit`. */
  factor: number
  baseQty: number
}

export interface BackfillGap {
  poId: string
  docNo: string
  index: number
  productName: string
  entryUnit: string
  why: 'productMissing' | 'noRate'
}

export interface BackfillPlan {
  ordersScanned: number
  linesScanned: number
  set: BackfillLine[]
  gaps: BackfillGap[]
}

export function planPoBaseQtyBackfill(orders: readonly PurchaseOrder[], products: readonly Product[]): BackfillPlan {
  const byId = new Map(products.map((p) => [p.id, p]))
  const plan: BackfillPlan = { ordersScanned: 0, linesScanned: 0, set: [], gaps: [] }
  for (const o of orders) {
    if (o.status !== 'ordered') continue
    plan.ordersScanned++
    o.lines.forEach((l, index) => {
      plan.linesScanned++
      const unit = l.entryUnit?.trim()
      if (!unit || sameUnit(unit, l.unit) || l.baseQty !== undefined) return
      const at = { poId: o.id, docNo: o.docNo, index, productName: l.productName, entryUnit: unit }
      const p = byId.get(l.productId)
      if (!p) return void plan.gaps.push({ ...at, why: 'productMissing' })
      const factor = resolveFactor(p, unit)
      if (factor === null) return void plan.gaps.push({ ...at, why: 'noRate' })
      plan.set.push({ ...at, supplierName: o.supplierName, productId: p.id, orderedQty: l.orderedQty, factor, baseQty: toBase(l.orderedQty, factor) })
    })
  }
  return plan
}
