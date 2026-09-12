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
