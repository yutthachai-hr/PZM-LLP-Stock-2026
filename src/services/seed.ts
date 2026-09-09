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
  // Match on name, so a run that failed after creating two of three finishes the job next
  // time instead of seeing "some locations exist" and leaving the third missing forever.
  const haveName = new Set(existing.map((l) => l.name))
  let n = 0
  for (const l of brandDef(brand).defaultLocations) {
    if (haveName.has(l.name)) continue
    await createLocation(l.name, l.type)
    n++
  }
  return n
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
