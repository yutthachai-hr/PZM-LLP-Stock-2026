import type { Line } from '../../components/LineBuilder'
import type { OcrBill, OcrMatch } from '../../lib/billOcr'
import { mergeKey } from '../../lib/supplierName'
import { sameUnit } from '../../lib/units'
import type { PurchaseOrder, Supplier } from '../../types'
import { owedLines, type ReceiptDraft } from './receipt'

/** Same value as DocumentCard's: a supplier typed by hand. Kept here so this file stays pure. */
const OTHER_SUPPLIER = '__other'

export interface OcrFill {
  patch: Partial<ReceiptDraft>
  /** Lines put on the form. */
  filled: number
  /** What was read but not put on the form, and why — shown to the person. */
  skipped: { name: string; why: 'noProduct' | 'notOnOrder' | 'unit' | 'already' }[]
}

/**
 * What an AI-read bill fills in on the receiving form (Automation Plan Phase 4). Never
 * overwrites what the person has typed: a bill number already there stays, a product already
 * on the lines is not added twice. From an order, only the order's lines are filled, in the
 * unit they were ordered in; a quantity in another unit is left for the person.
 */
export function ocrFill(
  bill: OcrBill,
  match: OcrMatch,
  ctx: { draft: ReceiptDraft; order: PurchaseOrder | null; suppliers: readonly Supplier[] },
): OcrFill {
  const { draft, order } = ctx
  const patch: Partial<ReceiptDraft> = {}
  const skipped: OcrFill['skipped'] = match.unmatched.map((l) => ({ name: l.name, why: 'noProduct' as const }))
  let filled = 0

  if (bill.invoiceNo && !draft.invoiceNo.trim()) patch.invoiceNo = bill.invoiceNo
  if (bill.date) patch.docDateStr = bill.date

  if (order) {
    const entries = { ...draft.entries }
    const owed = owedLines(order)
    for (const m of match.matched) {
      const line = owed.find((l) => l.productId === m.product.id)
      if (!line) {
        skipped.push({ name: m.read.name, why: 'notOnOrder' })
        continue
      }
      let qty: number | null = null
      if (line.entryUnit) {
        // Ordered in another unit: take the number only when the bill says that unit.
        if (m.read.unit && sameUnit(m.read.unit, line.entryUnit)) qty = m.read.qty
      } else if (!m.unitUnknown) {
        qty = m.qty
      }
      if (qty === null) {
        skipped.push({ name: m.read.name, why: 'unit' })
        continue
      }
      entries[line.productId] = { qty, reason: entries[line.productId]?.reason ?? '' }
      filled++
    }
    patch.entries = entries
    return { patch, filled, skipped }
  }

  if (bill.supplier && !draft.supplierName.trim()) {
    const key = mergeKey(bill.supplier)
    const known = ctx.suppliers.find((s) => s.active !== false && (mergeKey(s.name) === key || (mergeKey(s.name).length >= 3 && key.includes(mergeKey(s.name)))))
    patch.supplierId = known ? known.id : OTHER_SUPPLIER
    patch.supplierName = known ? known.name : bill.supplier
  }
  const lines: Line[] = [...draft.lines]
  for (const m of match.matched) {
    if (lines.some((l) => l.productId === m.product.id)) {
      skipped.push({ name: m.read.name, why: 'already' })
      continue
    }
    if (m.unitUnknown) skipped.push({ name: m.read.name, why: 'unit' })
    lines.push({
      productId: m.product.id,
      productName: m.product.name,
      unit: m.product.unitType,
      qty: m.qty,
      ...(m.entryUnit ? { entryUnit: m.entryUnit, entryQty: m.entryQty } : {}),
    })
    filled++
  }
  patch.lines = lines
  return { patch, filled, skipped }
}
