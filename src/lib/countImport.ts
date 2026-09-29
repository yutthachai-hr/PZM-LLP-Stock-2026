import type { Product } from '../types'
import { resolveFactor } from './inventoryRules/uom'
import type { ParsedSheet } from './stockSheet'
import { sameUnit } from './units'
import { round3 } from './qtyEntry'

/**
 * Bringing one location's figures from the company's closing-stock workbook into a monthly
 * count sheet (owner, 29 Sep 2026) — as counts to check, never as stock moved.
 *
 * The workbook counts in whatever unit the shelf was counted in — a box, a can, a sack —
 * and the catalogue keeps each product in its own unit. The owner's rule: every line whose
 * unit is not the product's own is asked about, one by one, before it goes in. A rate
 * the product already knows is offered, not assumed.
 */

export type ImportStatus =
  /** Counted in the product's own unit: goes in as it is. */
  | 'ready'
  /** Counted in another unit, or with no unit written: the rate has to be answered. */
  | 'unit'
  /** A code the catalogue does not have. Never created from here. */
  | 'unknown'
  /** No item code (work-in-progress rows and the like). */
  | 'nosku'
  /** The same product counted more than once in this column: which figure is meant? */
  | 'duplicate'

export interface ImportRow {
  excelRow: number
  code: string
  name: string
  packSize: string
  qty: number
  /** As written in the file; '' when the cell was empty. */
  fileUnit: string
  status: ImportStatus
  productId?: string
  /** The product's own unit. */
  unitType?: string
  /** A rate the product already has for fileUnit (1 fileUnit = rate × own unit). */
  knownRate?: number
  /** For a duplicate: every figure written for this product in the column. */
  alsoRows?: { excelRow: number; qty: number; fileUnit: string }[]
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/** The columns of the sheet: one per snapshot and location heading. */
export function importColumns(sheet: ParsedSheet): { snapshot: number; column: number; label: string; header: string }[] {
  return sheet.snapshots.flatMap((s, si) =>
    s.columns.map((c, ci) => ({ snapshot: si, column: ci, label: s.label, header: c.header })),
  )
}

/**
 * The location heading most likely meant for a location of ours, by name. A guess to be
 * confirmed on screen, never applied silently.
 */
export function guessHeader(headers: readonly string[], locationName: string): string {
  const n = locationName.toLowerCase()
  const find = (re: RegExp) => headers.find((h) => re.test(h.toLowerCase().replace(/\s+/g, '')))
  if (/สารสิน|sarasin/.test(n)) return find(/^srs/) ?? '' // i18n-key
  if (/อ่อนนุช|on ?nut/.test(n)) return find(/^onnut|^on\.?nut/) ?? '' // i18n-key
  if (/สุขุมวิท|sukhumvit|หลัก|main/.test(n)) return find(/^skv/) ?? '' // i18n-key
  return ''
}

/** One column of the sheet, sorted into what can go in, what needs a rate, and what cannot. */
export function importRows(
  sheet: ParsedSheet,
  at: { snapshot: number; column: number },
  products: readonly Pick<Product, 'id' | 'sku' | 'unitType' | 'unitConversions' | 'active'>[],
): ImportRow[] {
  const col = sheet.snapshots[at.snapshot]?.columns[at.column]
  if (!col) return []
  const bySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p]))
  const rows: ImportRow[] = []
  for (const r of sheet.rows) {
    const qty = num(r.cells[col.qtyCol])
    if (qty === null) continue // blank is "not counted here", never zero
    const fileUnit = col.unitCol >= 0 ? String(r.cells[col.unitCol] ?? '').trim() : ''
    const base = { excelRow: r.excelRow, code: r.code, name: r.name, packSize: r.packSize, qty, fileUnit }
    if (!r.hasSku) {
      rows.push({ ...base, status: 'nosku' })
      continue
    }
    const p = bySku.get(r.code.trim().toUpperCase())
    if (!p) {
      rows.push({ ...base, status: 'unknown' })
      continue
    }
    const same = !!fileUnit && sameUnit(fileUnit, p.unitType)
    const rate = !same && fileUnit ? resolveFactor(p, fileUnit) : null
    rows.push({
      ...base,
      status: same ? 'ready' : 'unit',
      productId: p.id,
      unitType: p.unitType,
      ...(rate !== null ? { knownRate: rate } : {}),
    })
  }
  // The same product twice in one column: neither goes in until someone says which.
  const seen = new Map<string, ImportRow[]>()
  for (const row of rows) if (row.productId) seen.set(row.productId, [...(seen.get(row.productId) ?? []), row])
  for (const group of seen.values()) {
    if (group.length < 2) continue
    const [first, ...rest] = group
    first.status = 'duplicate'
    first.alsoRows = group.map((g) => ({ excelRow: g.excelRow, qty: g.qty, fileUnit: g.fileUnit }))
    for (const g of rest) rows.splice(rows.indexOf(g), 1)
  }
  return rows
}

/**
 * A rate as answered on screen, in whichever direction was easier to say:
 * "1 BOX = 12 EA" (`perFile`) or "4 CAN = 1 Pack" (`filePerOne`). Returns how many of the
 * product's own unit one file unit is, or null for an answer that is not a positive number.
 */
export function rateOf(answer: { value: number; mode: 'perFile' | 'filePerOne' }): number | null {
  if (!Number.isFinite(answer.value) || answer.value <= 0) return null
  return answer.mode === 'perFile' ? answer.value : 1 / answer.value
}

/** The count in the product's own unit. */
export function countIn(qty: number, rate: number): number {
  return round3(qty * rate)
}
