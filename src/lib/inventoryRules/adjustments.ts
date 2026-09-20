import type { InventorySettings, Product, StockMovement } from '../../types'
import { isLegacyUnitRow } from './uom'
import { LOSS_REASONS } from './usage'

/**
 * Which adjustments a manager should hear about.
 *
 * Waste is an adjustment out for a reason meaning the stock is gone (lost, broken,
 * expired, damaged) worth at least `wasteValueBaht`. Any other adjustment is significant
 * when it is worth at least `adjustValueBaht`, or moves at least `adjustPct` percent of
 * what the location held. Value needs the product's unit cost; without one only the
 * percentage can trigger, and the value shows as unknown.
 */

export interface Significance {
  kind: 'adjustment' | 'waste'
  /** Baht, or null when the product has no cost. */
  value: number | null
  /** Percent of what was on hand before, or null when nothing was. */
  pct: number | null
  out: boolean
}

export function significance(
  m: StockMovement,
  product: Product | undefined,
  /** The balance now, after the movement; the rate is judged against the balance before. */
  onHandNow: number,
  settings: Pick<InventorySettings, 'adjustValueBaht' | 'adjustPct' | 'wasteValueBaht'>,
): Significance | null {
  if (m.type !== 'adjust' || m.voided || isLegacyUnitRow(m)) return null
  const out = !!m.fromLocationId
  const cost = product?.cost
  const value = cost !== undefined && cost > 0 ? m.qty * cost : null
  const before = out ? onHandNow + m.qty : onHandNow - m.qty
  const pct = before > 0 ? (m.qty / before) * 100 : null
  const loss = out && (LOSS_REASONS as readonly string[]).includes(m.reason ?? '')
  if (loss) {
    if (value !== null && settings.wasteValueBaht > 0 && value >= settings.wasteValueBaht) return { kind: 'waste', value, pct, out }
  }
  const byValue = value !== null && settings.adjustValueBaht > 0 && value >= settings.adjustValueBaht
  const byPct = pct !== null && settings.adjustPct > 0 && pct >= settings.adjustPct
  if (byValue || byPct) return { kind: loss ? 'waste' : 'adjustment', value, pct, out }
  return null
}
