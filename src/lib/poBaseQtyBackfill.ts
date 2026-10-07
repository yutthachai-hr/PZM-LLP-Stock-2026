import type { Product, PurchaseOrder } from '../types'
import { resolveFactor, toBase } from './inventoryRules/uom'
import { sameUnit } from './units'

/**
 * The `baseQty` backfill for order lines keyed in another unit before lines carried it
 * (plan A2, 6 Oct 2026). Pure, and only a plan: it says what would be written, and what
 * could not be worked out, so nothing is ever set — or skipped — silently. Writing it is
 * a separate step the owner has to order.
 *
 * Only orders still `ordered`: a received or cancelled order owes nothing, so its lines
 * never reach the incoming figure and are left as they were filed.
 */
export interface BackfillLine {
  poId: string
  docNo: string
  supplierName: string
  index: number
  productId: string
  productName: string
  entryUnit: string
  orderedQty: number
  /** The product's rate today, base units per one `entryUnit`. */
  factor: number
  baseQty: number
}

export interface BackfillGap {
  poId: string
  docNo: string
  index: number
  productName: string
  entryUnit: string
  why: 'productMissing' | 'noRate'
}

export interface BackfillPlan {
  ordersScanned: number
  linesScanned: number
  set: BackfillLine[]
  gaps: BackfillGap[]
}

export function planPoBaseQtyBackfill(orders: readonly PurchaseOrder[], products: readonly Product[]): BackfillPlan {
  const byId = new Map(products.map((p) => [p.id, p]))
  const plan: BackfillPlan = { ordersScanned: 0, linesScanned: 0, set: [], gaps: [] }
  for (const o of orders) {
    if (o.status !== 'ordered') continue
    plan.ordersScanned++
    o.lines.forEach((l, index) => {
      plan.linesScanned++
      const unit = l.entryUnit?.trim()
      if (!unit || sameUnit(unit, l.unit) || l.baseQty !== undefined) return
      const at = { poId: o.id, docNo: o.docNo, index, productName: l.productName, entryUnit: unit }
      const p = byId.get(l.productId)
      if (!p) return void plan.gaps.push({ ...at, why: 'productMissing' })
      const factor = resolveFactor(p, unit)
      if (factor === null) return void plan.gaps.push({ ...at, why: 'noRate' })
      plan.set.push({ ...at, supplierName: o.supplierName, productId: p.id, orderedQty: l.orderedQty, factor, baseQty: toBase(l.orderedQty, factor) })
    })
  }
  return plan
}

// ---------------------------------------------------------------- full classification ----

/**
 * Release gate (owner, 6 Oct 2026): the dry run must say, for EVERY order line, which of
 * these it is — and anything ambiguous must go to a person, never be written.
 *
 *  - valid      nothing to do: placed in the product's own unit, or carries a baseQty that
 *               agrees with the rate
 *  - safe       an open order's line with no baseQty, whose rate is known and nothing
 *               suggests it moved since the order was placed — would be set
 *  - ambiguous  the value could be worked out but might be wrong, so it needs review:
 *               the product's base unit changed since (rebased), the ledger shows this
 *               product and unit converted at a different rate, a baseQty disagrees with
 *               today's rate, or the line is already part-received without one
 *  - invalid    cannot be worked out at all: product gone, no rate, or a broken quantity
 *  - closed     a received / cancelled / closed order's line with no baseQty: it owes
 *               nothing, so it is never written (counted so the totals add up)
 */
export type LineClass = 'valid' | 'safe' | 'ambiguous' | 'invalid' | 'closed'
export type AmbiguityReason = 'baseUnitChanged' | 'ledgerRateDiffers' | 'baseQtyDisagrees' | 'partReceived'

export interface ClassifiedLine {
  poId: string
  docNo: string
  status: string
  index: number
  productId: string
  productName: string
  entryUnit: string | null
  orderedQty: number
  baseQty: number | null
  class: LineClass
  /** What would be written (safe) or proposed for review (ambiguous). */
  proposed?: number
  factorToday?: number
  why?: AmbiguityReason[] | 'productMissing' | 'noRate' | 'badQty'
  /** Ledger rates seen for this product and unit, for the reviewer. */
  ledgerRates?: number[]
}

export interface BaseQtyReport {
  totalLines: number
  counts: Record<LineClass, number>
  /** Lines the backfill would write: the safe ones, and only those. */
  wouldChange: number
  lines: ClassifiedLine[]
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-4)

export function classifyPoBaseQty(
  orders: readonly PurchaseOrder[],
  products: readonly Product[],
  movements: readonly { productId: string; entryUnit?: string; entryQty?: number; qty: number }[] = [],
): BaseQtyReport {
  const byId = new Map(products.map((p) => [p.id, p]))
  // Rates the ledger actually converted at, per product and unit (rows with an entryQty).
  const rates = new Map<string, number[]>()
  for (const m of movements) {
    if (!m.entryUnit || !(m.entryQty && m.entryQty > 0) || !Number.isFinite(m.qty)) continue
    const k = `${m.productId}|${m.entryUnit.trim().toLowerCase()}`
    const r = Math.abs(m.qty) / m.entryQty
    const list = rates.get(k) ?? []
    if (!list.some((x) => close(x, r))) list.push(r)
    rates.set(k, list)
  }
  const report: BaseQtyReport = { totalLines: 0, counts: { valid: 0, safe: 0, ambiguous: 0, invalid: 0, closed: 0 }, wouldChange: 0, lines: [] }
  for (const o of orders) {
    o.lines.forEach((l, index) => {
      report.totalLines++
      const unit = l.entryUnit?.trim() || null
      const base: Omit<ClassifiedLine, 'class'> = {
        poId: o.id, docNo: o.docNo, status: o.status, index, productId: l.productId, productName: l.productName,
        entryUnit: unit, orderedQty: l.orderedQty, baseQty: l.baseQty ?? null,
      }
      const put = (c: ClassifiedLine) => {
        report.counts[c.class]++
        if (c.class !== 'valid') report.lines.push(c)
      }
      if (!Number.isFinite(l.orderedQty) || l.orderedQty <= 0 || (l.baseQty !== undefined && !(Number.isFinite(l.baseQty) && l.baseQty > 0))) {
        return put({ ...base, class: 'invalid', why: 'badQty' })
      }
      if (!unit || sameUnit(unit, l.unit)) return put({ ...base, class: 'valid' })
      const p = byId.get(l.productId)
      if (!p) return put({ ...base, class: l.baseQty !== undefined ? 'valid' : o.status === 'ordered' ? 'invalid' : 'closed', ...(l.baseQty === undefined && o.status === 'ordered' ? { why: 'productMissing' as const } : {}) })
      const factor = resolveFactor(p, unit)
      const ledger = rates.get(`${p.id}|${unit.toLowerCase()}`) ?? []
      if (l.baseQty !== undefined) {
        // Filed with a value: valid when it agrees with the rate it implies being one the
        // product or the ledger knows; otherwise someone should look.
        const implied = l.baseQty / l.orderedQty
        const known = (factor !== null && close(implied, factor)) || ledger.some((r) => close(implied, r))
        return put(known ? { ...base, class: 'valid' } : { ...base, class: 'ambiguous', why: ['baseQtyDisagrees'], factorToday: factor ?? undefined, ledgerRates: ledger, ...(factor !== null ? { proposed: toBase(l.orderedQty, factor) } : {}) })
      }
      if (o.status !== 'ordered') return put({ ...base, class: 'closed' })
      if (factor === null) return put({ ...base, class: 'invalid', why: 'noRate', ledgerRates: ledger })
      const why: AmbiguityReason[] = []
      if (!sameUnit(l.unit, p.unitType)) why.push('baseUnitChanged')
      if (ledger.some((r) => !close(r, factor))) why.push('ledgerRateDiffers')
      if ((l.receivedQty ?? 0) > 0) why.push('partReceived')
      const proposed = toBase(l.orderedQty, factor)
      if (why.length) return put({ ...base, class: 'ambiguous', why, proposed, factorToday: factor, ledgerRates: ledger })
      report.wouldChange++
      put({ ...base, class: 'safe', proposed, factorToday: factor })
    })
  }
  return report
}
