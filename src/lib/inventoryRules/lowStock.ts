import type { Product, StockLocation } from '../../types'

/**
 * The one rule for "running low", used by the dashboard, the top bar's warning badge and
 * the calendar — so a number on one screen can never disagree with the list on another.
 *
 * A product is low at a location when that location has ever held it, it has a minimum
 * there, and the balance is at or under that minimum; it is out when the balance is at or
 * under zero. Products with no minimum are never low: nobody set the bar.
 */

export interface StockShortage {
  product: Product
  location: StockLocation
  qty: number
  min: number
  out: boolean
}

export function shortages(input: {
  products: readonly Product[]
  locations: readonly StockLocation[]
  qtyAt: (locationId: string, productId: string) => number
  minFor: (product: Product, locationId: string) => number
  tracksProduct: (locationId: string, productId: string) => boolean
}): StockShortage[] {
  const out: StockShortage[] = []
  for (const product of input.products) {
    if (product.active === false) continue
    for (const location of input.locations) {
      if (location.active === false) continue
      // Goods on the road are nobody's shelf: a transit balance falling is a delivery
      // arriving, not a shortage. The Worker reads every location, so this is where it stops.
      if (location.type === 'transit') continue
      if (!input.tracksProduct(location.id, product.id)) continue
      const min = input.minFor(product, location.id)
      if (min <= 0) continue
      const qty = input.qtyAt(location.id, product.id)
      if (qty <= min) out.push({ product, location, qty, min, out: qty <= 0 })
    }
  }
  return out
}
