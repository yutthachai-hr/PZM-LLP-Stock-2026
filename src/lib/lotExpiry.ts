import type { Product } from '../types'

/**
 * Lot / expiry — schema compatibility only (owner, 6 Oct 2026: "YES but DEFER"; design in
 * docs/adr/ADR-002-lot-expiry.md). The flags default to false: a product without them, or
 * with them false, is tracked exactly as today. Nothing in the app branches on these yet;
 * when lot tracking is built, every place that needs to ask goes through here.
 */
export function tracksLot(p: Pick<Product, 'trackLot'>): boolean {
  return p.trackLot === true
}

export function tracksExpiry(p: Pick<Product, 'trackExpiry'>): boolean {
  return p.trackExpiry === true
}
