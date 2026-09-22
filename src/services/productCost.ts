import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { resolveFactor } from '../lib/uom'
import { sameUnit } from '../lib/units'
import { COL, MAX_COST_HISTORY, type CostEntry, type Product } from '../types'

/**
 * What a product costs, stated the way the invoice states it.
 *
 * The owner's rule (22 Sep 2026): a price is keyed in whatever unit it was bought in —
 * a carton of 300 sachets, a bag, a kilo — and the books bring it to one of the
 * product's own unit themselves. Keying a carton price straight into "cost per unit"
 * had valued 11,536 sachets of ketchup at 3.4 million baht. Prices move month to
 * month, so every one stated is kept with the day it applies from, and the product's
 * `cost` is the newest that applies.
 */

/** The price brought to one of the product's own unit, at the product's rate for `unit`. */
export function costPerUnit(
  product: Pick<Product, 'name' | 'unitType' | 'unitConversions'>,
  price: number,
  unit: string,
): { factor: number; cost: number } {
  const label = unit.trim()
  const factor = !label || sameUnit(label, product.unitType) ? 1 : resolveFactor(product, label)
  if (factor === null || !(factor > 0)) {
    throw new AppError('ยังไม่ได้กำหนดอัตราแปลง "{unit}" ของ "{name}" — กำหนดที่หน้าสินค้าก่อน', { unit: label, name: product.name })
  }
  // Four decimals: a sachet at 0.993 baht is a real price; the valuation sums thousands of them.
  return { factor, cost: Math.round((price / factor) * 10000) / 10000 }
}

/** The cost that applies now: the entry with the latest effective day. */
export function currentCost(history: readonly Pick<CostEntry, 'cost' | 'effectiveAt'>[]): number | undefined {
  let best: Pick<CostEntry, 'cost' | 'effectiveAt'> | undefined
  for (const h of history) if (!best || h.effectiveAt >= best.effectiveAt) best = h
  return best?.cost
}

export async function setProductCost(params: {
  productId: string
  price: number
  /** The unit the price is for; '' or the product's own unit means per base unit. */
  unit: string
  /** The day this price applies from, ms. */
  effectiveAt: number
  actor: { id: string; name: string }
  note?: string
}): Promise<CostEntry> {
  const { productId, price, unit, effectiveAt, actor } = params
  if (!Number.isFinite(price) || price < 0) throw new AppError('ราคาต้องเป็นตัวเลขไม่ติดลบ')
  if (!Number.isFinite(effectiveAt) || effectiveAt <= 0) throw new AppError('กรุณาระบุวันที่มีผล')
  const db = backend.forBrand(getBrand())
  const product = await db.getOne<Product>(COL.products, productId)
  if (!product) throw new AppError('ไม่พบสินค้า')
  const { factor, cost } = costPerUnit(product, price, unit)
  const label = unit.trim() && !sameUnit(unit, product.unitType) ? unit.trim() : product.unitType
  const note = params.note?.trim()
  const entry: CostEntry = {
    price,
    unit: label,
    factor,
    cost,
    effectiveAt,
    at: Date.now(),
    by: actor.id,
    byName: actor.name,
    ...(note ? { note } : {}),
  }
  // Oldest first, by the day the price applies; the list is bounded, the oldest dropped.
  const history = [...(product.costHistory ?? []), entry].sort((a, b) => a.effectiveAt - b.effectiveAt || a.at - b.at).slice(-MAX_COST_HISTORY)
  await db.update(COL.products, productId, {
    cost: currentCost(history),
    costHistory: history,
    updatedAt: Date.now(),
  })
  return entry
}
