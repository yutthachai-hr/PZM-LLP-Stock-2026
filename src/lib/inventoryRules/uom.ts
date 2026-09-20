import type { UnitConversion } from '../units'

// Kept free of app imports (no i18n, no backend): the cron Worker bundles this folder.
function sameUnit(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
}
/** Three decimals, the ledger's resolution (validate.ts roundQty, without its imports). */
function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Units of measure: how a quantity keyed in one unit becomes the product's own.
 *
 * ## The rule (owner, 20 Sep 2026 — replacing the rule of 13 Sep)
 *
 * A product has ONE balance per location, in its own unit (`unitType`). Whatever unit a
 * person keys — a Carton, a Pack, 500 g — is converted into that unit at filing, with a
 * rate the owner has set for THIS product ("1 Carton = 500 EA"). The movement keeps both
 * numbers (`entryQty` as keyed, `qty` in the base unit), so the history says exactly what
 * happened even after the rate is changed. Nothing is guessed: a unit with no rate for
 * the product cannot be filed until someone states the rate.
 *
 * Two kinds of rate:
 *  - Standard measures, true for every product in the world: grams into kilograms,
 *    millilitres into litres. Only those two — the owner's choice; no ounces or gallons.
 *  - The product's own conversions (`Product.unitConversions`): a case, a pack, a bag.
 *    These differ per product and per supplier, so they live on the product.
 *
 * Pure: no React, no backend, no i18n. Shared by the entry screens, the stock engine, the
 * Worker and the tests. `entryFor` (which refuses in the app's own words) lives in lib/uom.ts.
 */

const MASS: Record<string, number> = { g: 0.001, กรัม: 0.001, gram: 0.001, grams: 0.001, kg: 1, 'กก.': 1, กก: 1, กิโลกรัม: 1, kilogram: 1, kilograms: 1 }
const VOLUME: Record<string, number> = { ml: 0.001, 'มล.': 0.001, มล: 0.001, มิลลิลิตร: 0.001, millilitre: 0.001, milliliter: 0.001, l: 1, lt: 1, ลิตร: 1, litre: 1, liter: 1, litres: 1, liters: 1 }

function key(u: string): string {
  return u.trim().toLowerCase()
}

/** The measure a unit belongs to, and its size in that measure's canonical unit (kg / l). */
export function measureOf(unit: string): { measure: 'mass' | 'volume'; size: number } | null {
  const k = key(unit)
  if (k in MASS) return { measure: 'mass', size: MASS[k] }
  if (k in VOLUME) return { measure: 'volume', size: VOLUME[k] }
  return null
}

/**
 * How many `to` one `from` is, when both are standard measures of the same kind:
 * g→kg = 0.001, kg→g = 1000. Null for anything else — a Carton has no standard size.
 */
export function standardFactor(from: string, to: string): number | null {
  if (sameUnit(from, to)) return 1
  const a = measureOf(from)
  const b = measureOf(to)
  if (!a || !b || a.measure !== b.measure) return null
  return a.size / b.size
}

/** What the entry screens and the engine need to know about a product to convert for it. */
export interface UnitBearer {
  unitType: string
  unitConversions?: readonly UnitConversion[]
}

/** Deeper than this a chain is a mistake, not a hierarchy. */
const MAX_CHAIN = 6

/**
 * The rate for keying this product in `entryUnit`: how many base units one `entryUnit`
 * is. The product's own rows win over the standard table, so an owner can state that
 * their "g" pack is nominal if they must. A row may be stated in another row's unit
 * ("1 Carton = 12 Pack", "1 Pack = 25 EA") and is followed down to the base; a row's
 * `per` divides ("1 EA = 2.72 KG" is stored as 2.72 KG = 1 EA). Null = no rate known =
 * cannot be filed.
 */
export function resolveFactor(product: UnitBearer, entryUnit: string | undefined, depth = 0): number | null {
  const base = product.unitType
  if (!entryUnit || sameUnit(entryUnit, base)) return 1
  if (depth > MAX_CHAIN) return null
  const own = product.unitConversions?.find((c) => sameUnit(c.label, entryUnit))
  if (own && Number.isFinite(own.size) && own.size > 0 && (own.per === undefined || own.per > 0)) {
    const step = own.size / (own.per ?? 1)
    if (!own.of || sameUnit(own.of, base)) return step
    if (sameUnit(own.of, entryUnit)) return null
    const rest = resolveFactor(product, own.of, depth + 1)
    return rest === null ? null : step * rest
  }
  return standardFactor(entryUnit, base)
}

/**
 * A base quantity said in the product's larger units, largest first: 320 EA with a Carton
 * of 12 Pack and a Pack of 25 EA reads "1 Carton 0 Pack 20 EA" → "1 Carton 20 EA". Only
 * whole counts of each unit are taken; the remainder stays in the base unit. Units whose
 * rate is under one base unit (a piece of a kilo) are not used — they would never fit
 * whole in front of the base. Empty when the product has no usable larger unit.
 */
export function breakdown(qtyBase: number, product: UnitBearer, fmt: (n: number) => string = String): string {
  const rows = (product.unitConversions ?? [])
    .map((c) => ({ label: c.label, factor: resolveFactor(product, c.label) }))
    .filter((r): r is { label: string; factor: number } => r.factor !== null && r.factor > 1)
    .sort((a, b) => b.factor - a.factor)
  if (rows.length === 0 || !(qtyBase > 0)) return ''
  const parts: string[] = []
  let rest = qtyBase
  for (const r of rows) {
    const n = Math.floor(rest / r.factor + 1e-9)
    if (n <= 0) continue
    parts.push(`${fmt(n)} ${r.label}`)
    rest = roundQty(rest - n * r.factor)
  }
  if (parts.length === 0) return ''
  if (rest > 0) parts.push(`${fmt(rest)} ${product.unitType}`)
  return parts.join(' ')
}

/**
 * Whether a base quantity is a whole number of a counting unit. A count unit (EA, Pack,
 * Carton, Lot — anything that is not a standard measure) cannot really hold 0.368 of
 * itself; the screens warn when a conversion lands there, and let the person decide.
 */
export function isCountUnit(unit: string): boolean {
  return measureOf(unit) === null
}

export function toBase(entryQty: number, factor: number): number {
  return roundQty(entryQty * factor)
}

/** The rate a filed row was converted at — the row's own truth, whatever the product says now. */
export function factorOf(m: { qty: number; entryQty?: number }): number {
  return m.entryQty && m.entryQty > 0 ? m.qty / m.entryQty : 1
}

/**
 * A row filed under the old rule: keyed in another unit and never converted, so it sits
 * on its own `#Unit` balance until the migration tool converts it. Such a row has an
 * `entryUnit` and no `entryQty`.
 */
export function isLegacyUnitRow(x: { entryUnit?: string; entryQty?: number }): boolean {
  return !!(x.entryUnit ?? '').trim() && x.entryQty === undefined
}

/**
 * A quantity as people should read it: "1 Carton (= 500 EA)" for a converted row,
 * "500 EA" for one keyed in the base unit, "10 Pack" for a legacy row still on its own
 * balance. `fmt` formats numbers the app's way.
 */
export function describeQty(
  x: { qty: number; entryQty?: number; entryUnit?: string; unit: string },
  fmt: (n: number) => string = String,
): string {
  const unit = (x.entryUnit ?? '').trim()
  if (!unit || sameUnit(unit, x.unit)) return `${fmt(x.qty)} ${x.unit}`
  if (x.entryQty === undefined) return `${fmt(x.qty)} ${unit}`
  return `${fmt(x.entryQty)} ${unit} (= ${fmt(x.qty)} ${x.unit})`
}
