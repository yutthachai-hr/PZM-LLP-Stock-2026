import type { Line } from '../components/LineBuilder'
import type { QtyEntry } from './uom'

/** One form line from what the quantity sheet handed back. */
export function lineOf(product: { id: string; name: string; unitType: string }, e: QtyEntry): Line {
  return {
    productId: product.id,
    productName: product.name,
    unit: product.unitType,
    qty: e.qty,
    ...(e.entryUnit ? { entryUnit: e.entryUnit, entryQty: e.entryQty } : {}),
  }
}

/**
 * The lines with this product's line set to the entry: replaced where it already is,
 * appended where it is not, removed when the entry is nothing. A phone keys one product
 * at a time through a sheet, and tapping a product already on the list edits it rather
 * than adding a twin (the same rule the request picker learned on 21 Sep 2026).
 */
export function upsertLine(lines: Line[], product: { id: string; name: string; unitType: string }, e: QtyEntry): Line[] {
  const rest = lines.filter((l) => l.productId !== product.id)
  if (!(e.qty > 0)) return rest
  const next = lineOf(product, e)
  const at = lines.findIndex((l) => l.productId === product.id)
  if (at < 0) return [...lines, next]
  return lines.map((l, i) => (i === at ? next : l))
}
