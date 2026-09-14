// Turning a name typed in the order workbook into a product in the catalogue.
//
// The workbook is kept by hand, week after week, by more than one person. Against the
// catalogue's "FRENCH FRIES  3/8 (PANFOOD)" it says "FRENCH FRIES  3/8 2.26KG" one week and
// "French Fries 3/8 2.26 kg" the next; against "SMOKED BACON SLICED 1 KG (TGM)" it says
// "SMOKED BACON (TGM)" or "SMOKED BACON (เบทาโก)" — which is a different supplier. Nobody is
// going to standardise the workbook, so the app has to read it the way a person does.
//
// The rule that matters more than any score: a guess is never an answer. Anything short of
// an exact match, or an alias a person has already confirmed, comes back as something to
// choose from. Ordering the wrong product from the wrong supplier is worse than asking.

import type { Product } from '../types'

/** A workbook spelling somebody has confirmed as one product, so it is not asked again. */
export interface ProductAlias {
  id: string
  /** normaliseName() of the spelling. */
  key: string
  productId: string
  /** The spelling as it appeared, for the person reading the alias list later. */
  sourceName: string
  createdBy: string
  createdByName: string
  createdAt: number
}

/**
 * One spelling of a name, so that the workbook's and the catalogue's can be compared.
 *
 * Every rule here comes from a real pair in the sample workbook, not from what names ought
 * to look like:
 *   - Brackets go: the catalogue writes its supplier there ("(TGM)"), sometimes a pack size
 *     ("(8KG/PC)"), and the workbook writes neither — or writes a different supplier.
 *   - Digits and letters are split apart: "2.26KG" and "2.26 KG" are one size.
 *   - "kg." loses its dot; "*" and "×" between numbers become a space ("2.72 kg*8" against
 *     "2.72*8").
 *   - Quote marks and stray punctuation are dropped ('PIZZA BOX 18.5" 1PACK=25PCS').
 *   - Thai is kept as it is; a Thai name only ever matches through an alias.
 */
export function normaliseName(raw: string): string {
  return (
    raw
      .toUpperCase()
      .replace(/\([^()]*\)/g, ' ')
      .replace(/["'`”“’]/g, '')
      .replace(/[*×]/g, ' ')
      // "1 kg." / "2.26 kg" / "18.5\"" — separate a number from the unit glued onto it.
      .replace(/(\d)([A-Z])/g, '$1 $2')
      .replace(/([A-Z])(\d)/g, '$1 $2')
      // A dot that ends a token ("KG.", "1 kg.") is punctuation; one inside a number is not.
      .replace(/\.(?=\s|$)/g, ' ')
      .replace(/[,;:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function tokens(key: string): Set<string> {
  return new Set(key.split(' ').filter(Boolean))
}

/** Sørensen–Dice over token sets: 0 = nothing shared, 1 = the same words. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return (2 * shared) / (ta.size + tb.size)
}

export type MatchKind =
  /** One product has exactly this name, or the text is its SKU. */
  | 'exact'
  /** Somebody confirmed this spelling before. */
  | 'alias'
  /** Several products share the name — the same cheese from two suppliers. Somebody picks. */
  | 'ambiguous'
  /** Nothing matched outright; the candidates are ordered best first, for a person to pick. */
  | 'none'

export interface MatchCandidate {
  product: Product
  score: number
}

export interface ProductMatch {
  kind: MatchKind
  key: string
  /** Set for exact and alias only. */
  product?: Product
  /** What to offer when a person has to choose. Empty for exact and alias. */
  candidates: MatchCandidate[]
}

/** Below this a candidate is not worth showing; it shares a word or two, nothing more. */
const CANDIDATE_FLOOR = 0.4
const MAX_CANDIDATES = 5

/**
 * Everything the matcher needs to know about the catalogue, built once per workbook rather
 * than once per row — 300 rows against 288 products is not much, but normalising every
 * catalogue name for every row would be.
 */
export interface MatchIndex {
  byKey: Map<string, Product[]>
  bySku: Map<string, Product>
  aliasByKey: Map<string, string>
  keyed: { product: Product; key: string }[]
}

export function buildMatchIndex(
  products: readonly Product[],
  aliases: readonly ProductAlias[],
): MatchIndex {
  const byKey = new Map<string, Product[]>()
  const bySku = new Map<string, Product>()
  const keyed: { product: Product; key: string }[] = []
  for (const p of products) {
    const key = normaliseName(p.name)
    keyed.push({ product: p, key })
    byKey.set(key, [...(byKey.get(key) ?? []), p])
    bySku.set(p.sku.trim().toUpperCase(), p)
  }
  const aliasByKey = new Map<string, string>()
  for (const a of aliases) aliasByKey.set(a.key, a.productId)
  return { byKey, bySku, aliasByKey, keyed }
}

/**
 * The product a workbook name means, if that can be said without guessing.
 *
 * In order: the text is a SKU; an alias somebody confirmed (checked before the exact name,
 * because an alias is also how a person settles which of two same-named products the
 * workbook means); exactly one product with the same normalised name; otherwise a list to
 * choose from. Hidden products are never matched silently — they show up as candidates, so
 * the person sees that the thing they typed exists but was hidden.
 */
export function matchProduct(rawName: string, index: MatchIndex): ProductMatch {
  const key = normaliseName(rawName)
  const none = (candidates: MatchCandidate[] = []): ProductMatch => ({ kind: 'none', key, candidates })
  if (!key) return none()

  const bySku = index.bySku.get(rawName.trim().toUpperCase())
  if (bySku && bySku.active) return { kind: 'exact', key, product: bySku, candidates: [] }

  const aliasTarget = index.aliasByKey.get(key)
  if (aliasTarget) {
    const p = index.keyed.find((k) => k.product.id === aliasTarget)?.product
    if (p) return { kind: 'alias', key, product: p, candidates: [] }
  }

  const same = (index.byKey.get(key) ?? []).filter((p) => p.active)
  if (same.length === 1) return { kind: 'exact', key, product: same[0], candidates: [] }
  if (same.length > 1) {
    return { kind: 'ambiguous', key, candidates: same.map((product) => ({ product, score: 1 })) }
  }

  const scored: MatchCandidate[] = []
  for (const { product, key: pk } of index.keyed) {
    const score = similarity(key, pk)
    if (score >= CANDIDATE_FLOOR) scored.push({ product, score })
  }
  scored.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
  return none(scored.slice(0, MAX_CANDIDATES))
}
