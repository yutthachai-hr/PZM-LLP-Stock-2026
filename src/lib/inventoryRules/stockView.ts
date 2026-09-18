import type { MinOverride, Product, StockLevel, StockLocation } from '../../types'

/**
 * Balances, minimums and "has this location ever kept it", from the raw documents.
 *
 * The app builds these once per render in DataContext; the cron Worker builds them from
 * the same documents it read over REST. One function, so the Worker's "low stock" is the
 * dashboard's "low stock" to the unit.
 */
export interface StockView {
  qtyAt: (locationId: string, productId: string) => number
  minFor: (product: Product, locationId: string) => number
  tracksProduct: (locationId: string, productId: string) => boolean
}

export function stockView(input: {
  locations: readonly StockLocation[]
  levels: readonly StockLevel[]
  minOverrides: readonly MinOverride[]
}): StockView {
  const { locations, levels, minOverrides } = input
  // Only the product's own unit. A row for a unit someone keyed carries the same
  // locationId and productId, so keying this map on those alone would let a Pack balance
  // overwrite the KG one and every total on every screen would quietly be the wrong row.
  const levelMap = new Map(levels.filter((l) => !l.unit).map((l) => [`${l.locationId}__${l.productId}`, l.qty]))
  const overrideMap = new Map(minOverrides.map((o) => [`${o.locationId}__${o.productId}`, o.minStock]))
  // Where a product has ever actually been. A balance row is only written when stock
  // moves, so its existence is the record of "this has been kept here" — including a row
  // that has since fallen to zero, which is exactly when a shortage matters.
  const stockedAt = new Set(levels.map((l) => `${l.locationId}__${l.productId}`))
  const stockedAnywhere = new Set(levels.map((l) => l.productId))
  // One place to chase something nobody has ever received: the main warehouse. Picked by
  // type rather than by name, and the oldest of them, so it does not move about.
  const home =
    [...locations]
      .filter((l) => l.active !== false)
      .sort(
        (a, b) =>
          (a.type === 'warehouse' ? 0 : 1) - (b.type === 'warehouse' ? 0 : 1) || (a.createdAt ?? 0) - (b.createdAt ?? 0),
      )[0]?.id ?? ''
  return {
    qtyAt: (locationId, productId) => levelMap.get(`${locationId}__${productId}`) ?? 0,
    minFor: (product, locationId) => overrideMap.get(`${locationId}__${product.id}`) ?? product.minStock ?? 0,
    tracksProduct: (locationId, productId) =>
      stockedAt.has(`${locationId}__${productId}`) || (!stockedAnywhere.has(productId) && locationId === home),
  }
}
