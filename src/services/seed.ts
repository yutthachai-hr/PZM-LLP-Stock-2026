import { backend } from '../backend'
import { COL, type Product, type StockLocation } from '../types'
import { SEED_PRODUCTS } from '../seed/products'
import { createLocation } from './locations'
import { brandDef, getBrand, type BrandId } from '../brand/brand'

export interface SeedResult {
  products: number
  locations: number
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

/**
 * Import the starter data for the CURRENT brand: default locations (if none) plus the
 * sample product catalogue for brands that ship one (Pizza Mania). Safe to re-run.
 */
export async function seedInitialData(): Promise<SeedResult> {
  const brand = getBrand()
  const def = brandDef(brand)
  const result: SeedResult = { products: 0, locations: 0 }

  const locs = await backend.getAll<StockLocation>(COL.locations)
  if (locs.length === 0) {
    for (const l of def.defaultLocations) {
      await createLocation(l.name, l.type)
      result.locations++
    }
  }

  if (def.hasSampleProducts) {
    const existing = await backend.getAll<Product>(COL.products)
    if (existing.length === 0) {
      const now = Date.now()
      for (const p of SEED_PRODUCTS) {
        await backend.add(COL.products, {
          ...p,
          hasImage: false,
          active: true,
          createdAt: now,
          updatedAt: now,
        })
        result.products++
      }
    }
  }

  return result
}
