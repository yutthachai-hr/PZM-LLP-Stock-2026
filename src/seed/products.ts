// Brand wiring for the official product catalogue.
//
// The item rows themselves live in catalog.generated.ts and are produced from the company's
// "รหัสสินค้า" workbooks by scripts/import-items.mjs — edit the workbook and re-run the script,
// never the generated file. SKUs must stay identical to the Cost of Goods workbooks.

import { LLP_PRODUCTS, PZM_PRODUCTS, type SeedProduct } from './catalog.generated'
import type { BrandId } from '../brand/brand'

export type { SeedProduct }

const CATALOGS: Record<BrandId, SeedProduct[]> = {
  pizza: PZM_PRODUCTS,
  lelapin: LLP_PRODUCTS,
}

/** The official catalogue for a brand. */
export function catalogFor(brand: BrandId): SeedProduct[] {
  return CATALOGS[brand] ?? []
}

/** Distinct categories in a brand's catalogue, in the order the workbook lists them. */
export function categoriesFor(brand: BrandId): string[] {
  return [...new Set(catalogFor(brand).map((p) => p.category))]
}
