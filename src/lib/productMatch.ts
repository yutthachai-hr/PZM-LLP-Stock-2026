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

/** Weights and volumes, as the workbook writes them after a number. */
const UNIT_WORDS = new Set(['KG', 'G', 'GR', 'GRAM', 'GRAMS', 'ML', 'L', 'LT', 'LTR'])

/**
 * A key with the unit word after a number dropped: "MOZZARELLA WHOLE MILK 2.72 kg*8" in the
 * workbook against "2.72*8" in the catalogue (owner, 2 Oct 2026: it was in the system and
 * still came up as unknown). Only the word goes — every number stays — so a different size,
 * 4.05 against 4.10, or a pack size the catalogue does not write, still differs.
 */
export function looseKey(key: string): string {
  const out: string[] = []
  for (const t of key.split(' ')) {
    if (UNIT_WORDS.has(t) && out.length > 0 && /^\d+(\.\d+)?$/.test(out[out.length - 1])) continue
    out.push(t)
  }
  return out.join(' ')
}

/**
 * What a name says in brackets — in the workbook that is usually the supplier: "SMOKED
 * BACON (TGM)" and "SMOKED BACON (เบทาโก)" are two companies' bacon. normaliseName() drops it,
 * so this is kept beside the key wherever the difference matters.
 */
export function bracketOf(raw: string): string {
  return [...raw.matchAll(/\(([^()]*)\)/g)]
    .map((m) => m[1].trim().toUpperCase().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' ')
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
  /** The same, by looseKey(): the name with the unit words after numbers dropped. */
  byLoose: Map<string, Product[]>
  bySku: Map<string, Product>
  aliasByKey: Map<string, { productId: string; bracket: string }>
  keyed: { product: Product; key: string }[]
}

export function buildMatchIndex(
  products: readonly Product[],
  aliases: readonly ProductAlias[],
): MatchIndex {
  const byKey = new Map<string, Product[]>()
  const byLoose = new Map<string, Product[]>()
  const bySku = new Map<string, Product>()
  const keyed: { product: Product; key: string }[] = []
  for (const p of products) {
    const key = normaliseName(p.name)
    keyed.push({ product: p, key })
    byKey.set(key, [...(byKey.get(key) ?? []), p])
    const loose = looseKey(key)
    byLoose.set(loose, [...(byLoose.get(loose) ?? []), p])
    bySku.set(p.sku.trim().toUpperCase(), p)
  }
  const aliasByKey = new Map<string, { productId: string; bracket: string }>()
  for (const a of aliases) aliasByKey.set(a.key, { productId: a.productId, bracket: bracketOf(a.sourceName) })
  return { byKey, byLoose, bySku, aliasByKey, keyed }
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

  // A spelling somebody confirmed — unless the brackets name someone else. Confirming
  // "SMOKED BACON(TGM)" must not quietly settle "SMOKED BACON(เบทาโก)" on TGM's bacon (owner's
  // workbook, 2 Oct 2026): that row is asked about instead.
  const alias = index.aliasByKey.get(key)
  if (alias) {
    const p = index.keyed.find((k) => k.product.id === alias.productId)?.product
    const said = bracketOf(rawName)
    if (p && (!said || !alias.bracket || said === alias.bracket)) return { kind: 'alias', key, product: p, candidates: [] }
  }

  const same = (index.byKey.get(key) ?? []).filter((p) => p.active)
  if (same.length === 1) return { kind: 'exact', key, product: same[0], candidates: [] }
  if (same.length > 1) {
    return { kind: 'ambiguous', key, candidates: same.map((product) => ({ product, score: 1 })) }
  }
  // The same name but for a unit word after a number ("2.72 kg*8" against "2.72*8").
  const loose = (index.byLoose.get(looseKey(key)) ?? []).filter((p) => p.active)
  if (loose.length === 1) return { kind: 'exact', key, product: loose[0], candidates: [] }
  if (loose.length > 1) {
    return { kind: 'ambiguous', key, candidates: loose.map((product) => ({ product, score: 1 })) }
  }

  const scored: MatchCandidate[] = []
  for (const { product, key: pk } of index.keyed) {
    const score = similarity(key, pk)
    if (score >= CANDIDATE_FLOOR) scored.push({ product, score })
  }
  scored.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
  return none(scored.slice(0, MAX_CANDIDATES))
}
