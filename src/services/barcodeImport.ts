import type { Product } from '../types'

/**
 * Barcodes from a spreadsheet (owner, 22 Sep 2026: both this and scanning one at a time).
 *
 * The sheet is two columns — the SKU from the company's own item-code workbook, and the
 * number on the box. SKU stays the key: a row whose SKU is not in the catalogue is
 * reported, never created, the same rule the stock import follows.
 *
 * Planning is separate from writing so the screen can show what will happen before
 * anything is saved: what changes, what is already right, and every row that cannot be
 * applied and why. Pure; tests in tests/barcode-import.test.ts.
 */
export interface BarcodeRow {
  sku: string
  barcode: string
}

export type BarcodeIssue = 'unknownSku' | 'duplicateInFile' | 'takenByOther' | 'blank'

export interface BarcodePlan {
  /** Rows that will be written: the product, its new barcode and the one it had. */
  changes: { product: Product; barcode: string; was?: string }[]
  /** Rows that already say what the catalogue says. */
  unchanged: number
  /** Rows that cannot be applied, each with the reason. */
  problems: { row: BarcodeRow; issue: BarcodeIssue; detail?: string }[]
}

/** Which header names the sheet may use, folded to lower case with spaces removed. */
const SKU_HEADERS = ['sku', 'รหัสสินค้า', 'รหัส', 'itemcode', 'code', 'productcode']
const BARCODE_HEADERS = ['barcode', 'บาร์โค้ด', 'บาร์โค๊ด', 'ean', 'upc']

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '')

/** Find the two columns in a sheet's header row; either may be missing. */
export function findColumns(header: readonly string[]): { sku: number; barcode: number } {
  const at = (names: string[]) => header.findIndex((h) => names.includes(fold(h ?? '')))
  return { sku: at(SKU_HEADERS), barcode: at(BARCODE_HEADERS) }
}

export function planBarcodeImport(rows: readonly BarcodeRow[], products: readonly Product[]): BarcodePlan {
  const bySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p]))
  const owner = new Map<string, Product>()
  for (const p of products) if (p.barcode) owner.set(p.barcode.trim().toLowerCase(), p)

  const plan: BarcodePlan = { changes: [], unchanged: 0, problems: [] }
  const seen = new Map<string, string>() // barcode -> sku that claimed it in this file

  for (const raw of rows) {
    const row = { sku: raw.sku.trim(), barcode: raw.barcode.trim() }
    if (!row.sku || !row.barcode) {
      if (row.sku || row.barcode) plan.problems.push({ row, issue: 'blank' })
      continue
    }
    const product = bySku.get(row.sku.toUpperCase())
    if (!product) {
      plan.problems.push({ row, issue: 'unknownSku' })
      continue
    }
    const key = row.barcode.toLowerCase()
    const claimed = seen.get(key)
    if (claimed && claimed !== row.sku) {
      plan.problems.push({ row, issue: 'duplicateInFile', detail: claimed })
      continue
    }
    const holder = owner.get(key)
    if (holder && holder.id !== product.id) {
      plan.problems.push({ row, issue: 'takenByOther', detail: holder.name })
      continue
    }
    seen.set(key, row.sku)
    if ((product.barcode ?? '').trim().toLowerCase() === key) {
      plan.unchanged++
      continue
    }
    plan.changes.push({ product, barcode: row.barcode, ...(product.barcode ? { was: product.barcode } : {}) })
  }
  return plan
}
