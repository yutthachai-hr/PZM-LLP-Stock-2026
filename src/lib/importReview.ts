import { matchOcrLines } from './billOcr'
import { buildMatchIndex, type MatchIndex } from './productMatch'
import { suggestProducts } from './productSuggest'
import type { Product } from '../types'

/**
 * What an imported line (Excel, photo, PDF) is filed as — decided here, not in the screen, so
 * the safety rules can be tested (release hardening, 8 Oct 2026). Used by every consumer of
 * the import window: purchase request, order, monthly count, adjust, line builder.
 *
 *   sure    SKU, a confirmed alias, or the one product of exactly that name (lib/billOcr):
 *           pre-ticked, as before — if its unit is known
 *   guess   the one clear word-by-word suggestion: SHOWN, never ticked. It is imported only
 *           after the person confirms it (ticking it, or picking it) — a model's or a fuzzy
 *           match's guess must not become a stock line because nobody looked
 *   picked  chosen or confirmed by the person
 *   null    nothing chosen
 *
 * A line whose unit the product cannot convert, or a product with no unit of its own (some
 * R&D catalogue rows, main 476fa35), is flagged and never imported until resolved. Nothing
 * here invents a product, a supplier, or a unit, or changes the catalogue.
 */
export interface ReadLine {
  name: string
  code?: string
  qty: number
  unit?: string
  note?: string
}

export type How = 'sure' | 'guess' | 'picked' | null

export interface ReviewRow {
  key: number
  read: ReadLine
  product: Product | null
  qty: number
  entryUnit?: string
  entryQty?: number
  /** The unit as written, when the product has no rate for it. */
  unitUnknown?: string
  include: boolean
  how: How
  suggestions: Product[]
}

/** A product that cannot hold stock yet: it has no unit of its own. */
export const lacksUnit = (p: Pick<Product, 'unitType'>) => !p.unitType || !p.unitType.trim()

function matchOne(read: ReadLine, index: MatchIndex) {
  const bare = read.name.replace(/[\s.,;:]+$/, '')
  const tries = [...(read.code ? [read.code] : []), read.name, ...(bare !== read.name ? [bare] : [])]
  for (const name of tries) {
    const m = matchOcrLines({ lines: [{ name, qty: read.qty, unit: read.unit }] }, index).matched[0]
    if (m) return m
  }
  return undefined
}

/** A line read for a chosen product, converted by that product's own units. */
export function convertFor(read: ReadLine, product: Product): Pick<ReviewRow, 'qty' | 'entryUnit' | 'entryQty' | 'unitUnknown'> {
  const m = matchOcrLines({ lines: [{ name: product.name, qty: read.qty, unit: read.unit }] }, buildMatchIndex([product], [])).matched[0]
  return m ? { qty: m.qty, entryUnit: m.entryUnit, entryQty: m.entryQty, unitUnknown: m.unitUnknown } : { qty: read.qty }
}

/** Whether a row may be ticked at all: a product, a usable unit, a positive quantity. */
export function blockedReason(r: Pick<ReviewRow, 'product' | 'unitUnknown' | 'qty'>): 'no-product' | 'unit-unknown' | 'product-has-no-unit' | 'bad-qty' | null {
  if (!r.product) return 'no-product'
  if (lacksUnit(r.product)) return 'product-has-no-unit'
  if (r.unitUnknown) return 'unit-unknown'
  if (!(Number.isFinite(r.qty) && r.qty > 0)) return 'bad-qty'
  return null
}

export function planRows(lines: readonly ReadLine[], products: readonly Product[], index: MatchIndex = buildMatchIndex(products as Product[], [])): ReviewRow[] {
  return lines.map((read, key): ReviewRow => {
    const m = matchOne(read, index)
    if (m) {
      const row: ReviewRow = { key, read, product: m.product, qty: m.qty, entryUnit: m.entryUnit, entryQty: m.entryQty, unitUnknown: m.unitUnknown, include: false, how: 'sure', suggestions: [] }
      return { ...row, include: blockedReason(row) === null }
    }
    const sug = suggestProducts(read.name, products, 4)
    const clear = sug.length > 0 && sug[0].score === 1 && (sug.length === 1 || sug[1].score < 1)
    if (clear) {
      // Offered, filled in, and left UNTICKED: the person confirms it or picks another.
      return { key, read, product: sug[0].product, ...convertFor(read, sug[0].product), include: false, how: 'guess', suggestions: sug.map((x) => x.product) }
    }
    return { key, read, product: null, qty: read.qty, include: false, how: null, suggestions: sug.map((x) => x.product) }
  })
}

/** The person chose a product for a row (or none). Their choice is a confirmation. */
export function choose(r: ReviewRow, product: Product | null): ReviewRow {
  if (!product) return { ...r, product: null, include: false, how: null, unitUnknown: undefined, entryUnit: undefined, entryQty: undefined, qty: r.read.qty }
  const next: ReviewRow = { ...r, product, ...convertFor(r.read, product), how: 'picked', include: false }
  return { ...next, include: blockedReason(next) === null }
}

/** The person ticked or unticked a row. Ticking a guess confirms it; a blocked row stays off. */
export function setInclude(r: ReviewRow, on: boolean): ReviewRow {
  if (!on) return { ...r, include: false }
  if (blockedReason(r) !== null) return { ...r, include: false }
  return { ...r, include: true, how: r.how === 'guess' ? 'picked' : r.how }
}

/** What leaves the window: ticked, confirmed (never a bare guess), and not blocked. */
export function importable(rows: readonly ReviewRow[]): ReviewRow[] {
  return rows.filter((r) => r.include && (r.how === 'sure' || r.how === 'picked') && blockedReason(r) === null)
}
