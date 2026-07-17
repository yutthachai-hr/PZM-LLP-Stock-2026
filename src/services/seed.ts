import { backend } from '../backend'
import { COL, type Product, type StockLocation } from '../types'
import { catalogFor } from '../seed/products'
import { createLocation } from './locations'
import { deleteProduct } from './products'
import { brandDef, getBrand, type BrandId } from '../brand/brand'

export interface SeedResult {
  products: number
  locations: number
}

export interface ResetResult {
  removed: number
  imported: number
}

/**
 * Ensure a brand has its default locations (called automatically on first entry).
 * No-op if the brand already has any locations. Products are NOT touched.
 */
export async function ensureBrandLocations(brand: BrandId): Promise<number> {
  const existing = await backend.getAll<StockLocation>(COL.locations)
  if (existing.length > 0) return 0
  const defs = brandDef(brand).defaultLocations
  for (const l of defs) await createLocation(l.name, l.type)
  return defs.length
}

async function importCatalog(brand: BrandId): Promise<number> {
  const now = Date.now()
  let n = 0
  for (const p of catalogFor(brand)) {
    await backend.add(COL.products, { ...p, hasImage: false, active: true, createdAt: now, updatedAt: now })
    n++
  }
  return n
}

/**
 * Import the starter data for the CURRENT brand: default locations (if none) plus the
 * official product catalogue (only when the brand has no products yet). Safe to re-run.
 */
export async function seedInitialData(): Promise<SeedResult> {
  const brand = getBrand()
  const result: SeedResult = { products: 0, locations: 0 }

  const locs = await backend.getAll<StockLocation>(COL.locations)
  if (locs.length === 0) {
    for (const l of brandDef(brand).defaultLocations) {
      await createLocation(l.name, l.type)
      result.locations++
    }
  }

  const existing = await backend.getAll<Product>(COL.products)
  if (existing.length === 0) result.products = await importCatalog(brand)

  return result
}

/**
 * Destructive: wipe the CURRENT brand's products (with their images and cached balances)
 * and re-import the official catalogue from scratch. Movement history is preserved — it
 * keeps denormalised product names, so past documents still read correctly.
 *
 * Only for replacing a catalogue that was never really used. Always confirm with the user.
 */
export async function resetCatalog(): Promise<ResetResult> {
  const brand = getBrand()
  const existing = await backend.getAll<Product>(COL.products)
  for (const p of existing) await deleteProduct(p.id)
  return { removed: existing.length, imported: await importCatalog(brand) }
}

/** How many products the official catalogue holds for a brand (0 if it ships none). */
export function catalogSize(brand: BrandId): number {
  return catalogFor(brand).length
}
