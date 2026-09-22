import type { Tone } from '../../components/frame/tones'

/**
 * Where a product stands, from its balance and its minimum. One rule for the stat tiles,
 * the status column, the grid cards and the filter, so a product the "ใกล้หมด" tile counts
 * is one the "ใกล้หมด" filter finds.
 *
 * The three are exclusive: nothing on hand is `out` whatever its minimum; `low` is at or
 * under a minimum that has been set; everything else is `normal`. A product with no
 * minimum can be out, never low — nobody said how little is too little.
 */
export type StockState = 'normal' | 'low' | 'out'

export function stockState(qty: number, min: number): StockState {
  if (qty <= 0) return 'out'
  if (min > 0 && qty <= min) return 'low'
  return 'normal'
}

export const STATE_LOOK: Record<StockState, { tone: Tone; label: string }> = {
  normal: { tone: 'green', label: 'ปกติ' }, // i18n-key
  low: { tone: 'amber', label: 'ใกล้หมด' }, // i18n-key
  out: { tone: 'red', label: 'หมดสต๊อก' }, // i18n-key
}
