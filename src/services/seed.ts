import { backend } from '../backend'
import { COL, type Product, type StockLocation } from '../types'
import { catalogFor } from '../seed/products'
import { createLocation } from './locations'
import { deleteProduct } from './products'
import { brandDef, getBrand, type BrandId } from '../brand/brand'
import { AppError } from '../i18n/AppError'

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
  // Only ever seed a brand that has NO locations at all.
  //
  // This briefly matched the defaults by name instead, so a half-finished first run could
  // be resumed. That was wrong for a warehouse that is already in use: the defaults are
  // written in English, the real locations here are named in Thai, and nothing links
  // "Main Warehouse" to "คลังหลัก" — so the first sign-in after that shipped added three
  // empty duplicates alongside the real ones, and staff could not tell which to receive
  // stock into. Renaming a location is normal and must never resurrect the original name.
  //
  // The failure it guarded against — a first run dying between two createLocation calls —
  // leaves a brand-new brand short a location, which an admin can add in Settings in ten
  // seconds. Duplicating the locations of a live warehouse is far worse.
  if (existing.length > 0) return 0
  const defs = brandDef(brand).defaultLocations
  for (const l of defs) await createLocation(l.name, l.type)
  return defs.length
}

/**
 * A document id derived from the SKU, so two devices importing at the same time write the
 * same document instead of two copies of the product.
 *
 * SKUs come from the company's item-code workbooks and are already unique and key-safe
 * (letters, digits and dashes). Anything else is refused rather than quietly mangled into
 * an id that would not round-trip.
 */
function idForSku(sku: string): string {
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(sku)) {
    throw new AppError('รหัสสินค้าใช้เป็นคีย์ไม่ได้: {sku}', { sku })
  }
  return sku
}

/**
 * Add every catalogue item the brand does not already have.
 *
 * Matching is by SKU, not by id, because products imported before this existed have random
 * ids — matching on id would add a second copy of all 288 of them. Adding one at a time
 * with a generated id also meant a failure halfway left the catalogue permanently short:
 * the next attempt saw products already present and skipped the rest.
 */
async function importCatalog(brand: BrandId): Promise<number> {
  const catalog = catalogFor(brand)

  // The document id is the SKU, so two catalogue entries sharing one would quietly write
  // over each other and the second product would simply never exist. The import script
  // already refuses to generate that, and this is the check that keeps it true.
  const skus = new Set<string>()
  for (const p of catalog) {
    if (skus.has(p.sku)) {
      throw new AppError('แคตตาล็อกมีรหัสสินค้าซ้ำ: {sku} — แก้ไฟล์ต้นทางก่อนนำเข้า', { sku: p.sku })
    }
    skus.add(p.sku)
  }

  const existing = await backend.getAll<Product>(COL.products)
  const haveSku = new Set(existing.map((p) => p.sku))
  const now = Date.now()
  let n = 0
  for (const p of catalog) {
    if (haveSku.has(p.sku)) continue
    await backend.set(COL.products, idForSku(p.sku), {
      ...p,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
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
  return {
    locations: await ensureBrandLocations(brand),
    products: await importCatalog(brand),
  }
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
