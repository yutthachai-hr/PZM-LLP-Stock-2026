// How a unit is written, and when two spellings mean the same thing.
//
// Pure, and deliberately not in services/entryUnits.ts: the stock engine needs `sameUnit`
// and that file carries a React hook, which the engine has no business importing.

/**
 * The spelled-out name for an abbreviation, so the two boxes on the product form cannot
 * drift apart.
 *
 * Only the units that ship by default are in here. A unit the owner adds — ลัง, ถุง — has no
 * expansion anybody could guess, so it stands for itself, which is better than inventing a
 * long form nobody uses.
 */
const UNIT_NAMES: Record<string, string> = {
  lot: 'lot',
  pack: 'pack',
  ea: 'each',
  carton: 'carton',
  kg: 'kilogram',
  l: 'litre',
}

/** The display name for a unit abbreviation. Falls back to the abbreviation itself. */
export function unitNameFor(abbreviation: string): string {
  const key = abbreviation.trim().toLowerCase()
  return UNIT_NAMES[key] ?? abbreviation.trim()
}

/**
 * Whether two spellings of a unit mean the same thing.
 *
 * Case and surrounding space only. This exists because the catalogue was keyed by hand and
 * holds "Kilogram" where the list now offers "kilogram" — without this, opening a product
 * and pressing save would count as changing its unit and restamp its entire ledger.
 */
export function sameUnit(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
}

/**
 * A reference multiplier for a unit this product might be keyed in — "1 ลัง = 288 EA".
 *
 * Advisory only. Nothing in the ledger is ever computed from this: the owner's rule is that
 * the number typed is the number recorded, because a case from one supplier is not the same
 * size as a case from another. This exists so a person can see the arithmetic before they
 * type, not so the system can do it for them.
 */
export interface UnitConversion {
  label: string
  /** `per` label = `size` of `of`. */
  size: number
  /** How many `label` the `size` is for; 1 when absent. Lets "1 EA = 2.72 KG" be stored as {KG, 1, per 2.72}. */
  per?: number
  /** The unit `size` is measured in: another row's label, or the product's own unit when absent. */
  of?: string
}

const MAX_CONVERSIONS = 20
const MAX_CONVERSION_LABEL = 40

/**
 * Tidy a list of reference conversions the way it will be stored: trimmed labels, positive
 * finite sizes, de-duplicated case-insensitively (first one wins), and bounded. Exported so
 * the product editor shows the person exactly what saving will keep — the same shape
 * `normaliseUnits` in `services/entryUnits.ts` keeps for the owner's unit list.
 */
export function normaliseConversions(raw: readonly UnitConversion[], baseUnit?: string): UnitConversion[] {
  const out: UnitConversion[] = []
  for (const { label, size, per, of } of raw) {
    const clean = label.trim().slice(0, MAX_CONVERSION_LABEL)
    if (!clean) continue
    if (baseUnit !== undefined && sameUnit(clean, baseUnit)) continue // the base is not a conversion of itself
    if (!Number.isFinite(size) || size <= 0) continue
    if (per !== undefined && !(Number.isFinite(per) && per > 0)) continue
    if (out.some((c) => sameUnit(c.label, clean))) continue
    const ref = (of ?? '').trim().slice(0, MAX_CONVERSION_LABEL)
    const row: UnitConversion = { label: clean, size }
    if (per !== undefined && per !== 1) row.per = per
    // A reference to the base unit is the default and is not stored; a self-reference is nonsense.
    if (ref && !sameUnit(ref, clean) && !(baseUnit !== undefined && sameUnit(ref, baseUnit))) row.of = ref
    out.push(row)
    if (out.length >= MAX_CONVERSIONS) break
  }
  // A row pointing at a unit no row defines (or round in a circle) can never resolve; drop it
  // rather than store a rate that refuses every entry.
  return out.filter((c) => {
    let cur: UnitConversion | undefined = c
    const seen = new Set<string>()
    for (let hops = 0; cur && cur.of; hops++) {
      if (hops > out.length || seen.has(cur.label.toLowerCase())) return false
      seen.add(cur.label.toLowerCase())
      const next: UnitConversion | undefined = out.find((o) => sameUnit(o.label, cur!.of))
      if (!next) return false
      cur = next
    }
    return true
  })
}
