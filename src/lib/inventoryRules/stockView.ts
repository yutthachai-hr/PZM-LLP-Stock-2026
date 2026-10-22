import { TRANSIT_LOCATION_ID, type MinOverride, type Product, type StockLevel, type StockLocation } from '../../types'

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

/** The stock buckets (owner, 22 Oct 2026): branch (qtyAt, available), in transit, company total. */
export interface StockBuckets {
  /** Shipped between our own sites and not yet received: still the company's, at no branch. */
  transitQty: (productId: string) => number
  /**
   * Company total: every site plus in transit. An internal transfer alone never changes it.
   * Transit is added once whether or not the caller's locations list includes it.
   */
  companyQty: (productId: string) => number
}

export function stockView(input: {
  locations: readonly StockLocation[]
  levels: readonly StockLevel[]
  minOverrides: readonly MinOverride[]
}): StockView & StockBuckets {
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
  const qtyAt = (locationId: string, productId: string) => levelMap.get(`${locationId}__${productId}`) ?? 0
  const sites = locations.filter((l) => l.id !== TRANSIT_LOCATION_ID && l.type !== 'transit')
  return {
    qtyAt,
    transitQty: (productId) => qtyAt(TRANSIT_LOCATION_ID, productId),
    companyQty: (productId) => sites.reduce((sum, l) => sum + qtyAt(l.id, productId), 0) + qtyAt(TRANSIT_LOCATION_ID, productId),
    minFor: (product, locationId) => overrideMap.get(`${locationId}__${product.id}`) ?? product.minStock ?? 0,
    tracksProduct: (locationId, productId) =>
      stockedAt.has(`${locationId}__${productId}`) || (!stockedAnywhere.has(productId) && locationId === home),
  }
}
