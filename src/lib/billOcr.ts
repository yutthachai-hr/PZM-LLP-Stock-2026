import type { Product } from '../types'
import { matchProduct, type MatchIndex } from './productMatch'
import { resolveFactor, toBase } from './uom'
import { sameUnit } from './units'
import { roundQty } from './validate'

/**
 * A supplier's bill read by AI (Automation Plan Phase 4 — owner, 25 Sep 2026), made safe
 * to show. The model's answer is untrusted text: every field is checked and trimmed here,
 * and nothing it says is filed — the receiving screen fills its boxes from it and the
 * person checks them before confirming, as with anything keyed by hand.
 */

export interface OcrLine {
  name: string
  qty: number
  unit?: string
}

export interface OcrBill {
  supplier?: string
  invoiceNo?: string
  /** YYYY-MM-DD, as the date box stores it. */
  date?: string
  lines: OcrLine[]
  /** Which model answered, as the server reports it — for saying who found nothing. */
  model?: string
}

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const s = String(v).trim().slice(0, max)
  return s || undefined
}

/**
 * A quantity as models actually write it: 2, "2", "1,250.5", "2 kg", "2kg", "x2".
 * Returns the number and whatever unit trailed it.
 */
export function readQtyText(v: unknown): { qty: number; unit?: string } {
  if (typeof v === 'number') return { qty: Number.isFinite(v) ? v : 0 }
  const m = /(-?\d[\d,]*(?:\.\d+)?)\s*([^\d\s][^\d]*)?/.exec(String(v ?? '').trim())
  if (!m) return { qty: 0 }
  const qty = Number(m[1].replace(/,/g, ''))
  const unit = m[2]?.trim().replace(/[.,;:)]+$/, '')
  return { qty: Number.isFinite(qty) ? qty : 0, ...(unit ? { unit: unit.slice(0, 20) } : {}) }
}

const pick = (o: Record<string, unknown>, keys: readonly string[]) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '')

/**
 * Whatever the model returned, as an OcrBill — or an empty one. Never throws.
 *
 * Lenient on purpose (6 Oct 2026): models answer `items` or `products` instead of `lines`,
 * `quantity` instead of `qty`, and "2 kg" instead of 2 — the strict reading dropped every
 * row of a perfectly readable order and said "no lines found".
 */
export function cleanOcr(raw: unknown): OcrBill {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const date = str(r.date, 10)
  const list = pick(r, ['lines', 'items', 'products', 'rows'])
  const lines = Array.isArray(list) ? list : Array.isArray(raw) ? raw : []
  return {
    model: str(r.model, 80),
    supplier: str(pick(r, ['supplier', 'vendor', 'seller']), 200),
    invoiceNo: str(pick(r, ['invoiceNo', 'invoice', 'documentNo', 'number']), 100),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    lines: lines
      .slice(0, 100)
      .map((l) => {
        const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>
        const read = readQtyText(pick(o, ['qty', 'quantity', 'amount', 'count']))
        const unit = str(pick(o, ['unit', 'uom']), 20) ?? read.unit
        return { name: str(pick(o, ['name', 'product', 'item', 'description']), 200) ?? '', qty: roundQty(read.qty), unit }
      })
      .filter((l) => l.name && l.qty > 0),
  }
}

export interface OcrMatchedLine {
  product: Product
  /** In the product's own unit. */
  qty: number
  /** When the bill's unit is one of the product's other units: what was read, in it. */
  entryUnit?: string
  entryQty?: number
  /** The bill named a unit this product does not know: the number is taken as its own unit. */
  unitUnknown?: string
  read: OcrLine
}

export interface OcrMatch {
  matched: OcrMatchedLine[]
  /** Lines no product matched without guessing — shown, never filed. */
  unmatched: OcrLine[]
}

/** The bill's lines against the catalogue: only a sure match (SKU, alias, one exact name) counts. */
export function matchOcrLines(bill: OcrBill, index: MatchIndex): OcrMatch {
  const matched: OcrMatchedLine[] = []
  const unmatched: OcrLine[] = []
  for (const read of bill.lines) {
    const m = matchProduct(read.name, index)
    const product = m.kind === 'exact' || m.kind === 'alias' ? m.product : undefined
    if (!product) {
      unmatched.push(read)
      continue
    }
    if (!read.unit || sameUnit(read.unit, product.unitType)) {
      matched.push({ product, qty: read.qty, read })
      continue
    }
    const factor = resolveFactor(product, read.unit)
    if (factor !== null) {
      matched.push({ product, qty: toBase(read.qty, factor), entryUnit: read.unit, entryQty: read.qty, read })
    } else {
      matched.push({ product, qty: read.qty, unitUnknown: read.unit, read })
    }
  }
  return { matched, unmatched }
}
