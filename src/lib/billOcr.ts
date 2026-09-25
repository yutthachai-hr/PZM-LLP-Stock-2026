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
}

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const s = String(v).trim().slice(0, max)
  return s || undefined
}

/** Whatever the model returned, as an OcrBill — or an empty one. Never throws. */
export function cleanOcr(raw: unknown): OcrBill {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const date = str(r.date, 10)
  const lines = Array.isArray(r.lines) ? r.lines : []
  return {
    supplier: str(r.supplier, 200),
    invoiceNo: str(r.invoiceNo, 100),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    lines: lines
      .slice(0, 100)
      .map((l) => {
        const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>
        const qty = Number(String(o.qty ?? '').replace(/,/g, ''))
        return { name: str(o.name, 200) ?? '', qty: Number.isFinite(qty) ? roundQty(qty) : 0, unit: str(o.unit, 20) }
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
