import type { QtyEntry } from './uom'

// The quantity box's arithmetic, apart from the component so a test can reach it.

export interface EntryUnit {
  /** Stable identity, and the <select> value. */
  key: string
  label: string
  /**
   * How many of the product's own unit one of these is. Null when nobody has stated it
   * for this product yet: the unit is offered, and choosing it asks for the rate.
   */
  factor: number | null
  /** The unit stamped on the row as `entryUnit`; the product's own unit for the base choice. */
  records: string
  /** True when the label is a translation key rather than stored data. */
  translate?: boolean
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** The entry for a typed number in a unit, converted for the product. */
export function entryOf(text: string, unit: EntryUnit, factor: number): QtyEntry {
  const n = Number(text)
  const entryQty = Number.isFinite(n) && n > 0 ? round3(n) : 0
  const base = unit.key === 'base'
  return { qty: round3(entryQty * factor), entryQty, ...(base ? {} : { entryUnit: unit.records }), factor }
}

/**
 * Whether the box still says what is on the line — compared the way entryOf files it
 * (keyed figure rounded, then converted and rounded again), never by converting the
 * stored figure back. That round trip is lossy: 4 KG of a 2.72 KG piece files as 1.471 EA,
 * and 1.471 EA back is 4.001 KG, so the old check rewrote the box to 4.001 while the owner
 * was still typing "4", and the next keystroke landed after it (25 Sep 2026).
 */
export function showsValue(text: string, factor: number, value: number): boolean {
  const n = Number(text)
  const keyed = Number.isFinite(n) && n > 0 ? round3(n) : 0
  return round3(keyed * factor) === round3(value)
}
