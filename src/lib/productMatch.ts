// Turning a name typed in the order workbook into a product in the catalogue.
//
// The workbook is kept by hand, week after week, by more than one person. Against the
// catalogue's "FRENCH FRIES  3/8 (PANFOOD)" it says "FRENCH FRIES  3/8 2.26KG" one week and
// "French Fries 3/8 2.26 kg" the next; against "SMOKED BACON SLICED 1 KG (TGM)" it says
// "SMOKED BACON (TGM)" or "SMOKED BACON (เบทาโก)" — which is a different supplier. Nobody is
// going to standardise the workbook, so the app has to read it the way a person does.
//
// The rule that matters more than any score: a guess is never an answer. Only the exact SKU,
// or an alias a person has already confirmed, is an answer (owner, 15 Oct 2026). Even a name
// spelled exactly like one product comes back as something to choose from. Ordering the wrong product from the wrong supplier is worse than asking.

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

/** Canonical composite spelling identity retaining supplier brackets. */
export function aliasIdentity(key: string, bracket = ''): string {
  return bracket ? `${key} (${bracket})` : key
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

/**
 * Words that describe a quantity or pack, not which product it is. Thai weights and volumes
 * are here and not in UNIT_WORDS, so they lower a ranking without widening the exact match.
 */
const MEASURE_WORDS = new Set([...UNIT_WORDS, 'PACK', 'PK', 'PCS', 'PC', 'EA', 'CTN', 'BOX', 'BAG', 'X', 'CAN', 'กก', 'กรัม', 'มล', 'ลิตร'])
const NUMBER = /^\d+(\.\d+)?$/

function parts(key: string): { name: string[]; sizes: Set<string> } {
  const name: string[] = []
  const sizes = new Set<string>()
  for (const t of key.split(' ')) {
    if (!t) continue
    if (NUMBER.test(t)) sizes.add(String(Number(t)))
    else if (!MEASURE_WORDS.has(t)) name.push(t)
  }
  return { name: [...new Set(name)], sizes }
}

/** One insertion, deletion, substitution or swap apart. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.slice(i + 1) === b.slice(i + 1)) return true
  if (a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i)) return true
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
}

/**
 * A typo of the same word: long alphabetic words, same first letter, one edit apart.
 * "MOZARELLA" is MOZZARELLA; "BRANCH" is not RANCH, because the first letters differ.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  return a.length >= 5 && b.length >= 5 && a[0] === b[0] && /^[A-Z]+$/.test(a) && /^[A-Z]+$/.test(b) && oneEditApart(a, b)
}

export interface ProductSimilarity {
  /** 0 when no word of the product's name is shared. */
  score: number
  /** Both names state a size and none of the numbers agree: 500 G against 1 KG. */
  sizeConflict: boolean
}

/**
 * How alike two normalised names are as products, for ranking the choices offered to a
 * person (owner, 15 Oct 2026: "RANCH 1 kg." offered MAYONNAISE 1KG first).
 *
 * The product's name words decide; sizes only break ties. Shared numbers and unit words are
 * never enough on their own, so a shared "1 KG" cannot make mayonnaise a ranch. A size both
 * names state and agree on lifts a candidate; one they disagree on lowers it and is flagged,
 * because a 500 G pack and a 1 KG pack are different products to order.
 */
export function productSimilarity(a: string, b: string): ProductSimilarity {
  const pa = parts(a)
  const pb = parts(b)
  if (!pa.name.length || !pb.name.length) return { score: 0, sizeConflict: false }
  let shared = 0
  const used = new Set<number>()
  for (const w of pa.name) {
    const j = pb.name.findIndex((v, k) => !used.has(k) && sameWord(w, v))
    if (j >= 0) {
      used.add(j)
      shared++
    }
  }
  if (!shared) return { score: 0, sizeConflict: false }
  const name = (2 * shared) / (pa.name.length + pb.name.length)
  const both = pa.sizes.size > 0 && pb.sizes.size > 0
  const agree = both && [...pa.sizes].some((s) => pb.sizes.has(s))
  const sizeConflict = both && !agree
  return { score: name + (agree ? 0.25 : 0) - (sizeConflict ? 0.5 : 0), sizeConflict }
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
  /** The name matches but the pack size differs: offered, never equivalent. */
  sizeConflict?: boolean
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
  aliasByKey: Map<string, { productId: string | null; bracket: string }>
  keyed: { product: Product; key: string }[]
}

export function buildMatchIndex(
  products: readonly Product[],
  aliases: readonly ProductAlias[],
): MatchIndex {
  const byKey = new Map<string, Product[]>()
  const byLoose = new Map<string, Product[]>()
  const keyed: { product: Product; key: string }[] = []
  for (const p of products) {
    const key = normaliseName(p.name)
    keyed.push({ product: p, key })
    byKey.set(key, [...(byKey.get(key) ?? []), p])
    const loose = looseKey(key)
    byLoose.set(loose, [...(byLoose.get(loose) ?? []), p])
  }
  const aliasByKey = new Map<string, { productId: string | null; bracket: string }>()
  for (const a of aliases) {
    // Only a spelling a person confirmed, filed under its own key, may answer for a product.
    if (!a.createdBy?.trim() || a.key !== normaliseName(a.sourceName)) continue
    const bracket = bracketOf(a.sourceName)
    const fullKey = aliasIdentity(a.key, bracket)
    const existing = aliasByKey.get(fullKey)
    if (existing) {
      // Fail closed if two records for same full identity authorize distinct products.
      if (existing.productId !== a.productId) {
        aliasByKey.set(fullKey, { productId: null, bracket })
      }
    } else {
      aliasByKey.set(fullKey, { productId: a.productId, bracket })
    }
  }
  return { byKey, byLoose, aliasByKey, keyed }
}

/**
 * The product a workbook name means, if that can be said without guessing.
 *
 * In order: the text is a SKU; an alias somebody confirmed (checked before the exact name,
 * because an alias is also how a person settles which of two same-named products the
 * workbook means); otherwise a list to choose from — even when exactly one product has the
 * same normalised name, since a name is a suggestion, never an answer (owner, 15 Oct 2026). Hidden products are never matched silently — they show up as candidates, so
 * the person sees that the thing they typed exists but was hidden.
 */
export function matchProduct(rawName: string, index: MatchIndex): ProductMatch {
  const key = normaliseName(rawName)
  const none = (candidates: MatchCandidate[] = []): ProductMatch => ({ kind: 'none', key, candidates })
  if (!key) return none()

  // A SKU shared by two products (a catalogue mistake) answers for neither.
  const sku = rawName.trim().toUpperCase()
  const bySku = index.keyed.filter(({ product }) => product.active && product.sku.trim().toUpperCase() === sku)
  if (bySku.length === 1) return { kind: 'exact', key, product: bySku[0].product, candidates: [] }

  // A spelling somebody confirmed — exact bracket identity only (owner, 16 Oct 2026). Confirming
  // "SMOKED BACON(TGM)" must not settle bare "SMOKED BACON" or "SMOKED BACON(เบทาโก)".
  const said = bracketOf(rawName)
  const fullKey = aliasIdentity(key, said)
  const alias = index.aliasByKey.get(fullKey)
  if (alias && alias.productId) {
    const p = index.keyed.find((k) => k.product.id === alias.productId)?.product
    if (p?.active && said === alias.bracket) {
      return { kind: 'alias', key, product: p, candidates: [] }
    }
  }

  const same = (index.byKey.get(key) ?? []).filter((p) => p.active)
  if (same.length === 1) return none([{ product: same[0], score: 1 }])
  if (same.length > 1) {
    return { kind: 'ambiguous', key, candidates: same.map((product) => ({ product, score: 1 })) }
  }
  // The same name but for a unit word after a number ("2.72 kg*8" against "2.72*8").
  const loose = (index.byLoose.get(looseKey(key)) ?? []).filter((p) => p.active)
  if (loose.length === 1) return none([{ product: loose[0], score: 1 }])
  if (loose.length > 1) {
    return { kind: 'ambiguous', key, candidates: loose.map((product) => ({ product, score: 1 })) }
  }

  const scored: MatchCandidate[] = []
  for (const { product, key: pk } of index.keyed) {
    const sim = productSimilarity(key, pk)
    if (sim.score > 0 && sim.score + (sim.sizeConflict ? 0.5 : 0) >= CANDIDATE_FLOOR)
      scored.push({ product, score: sim.score, ...(sim.sizeConflict ? { sizeConflict: true } : {}) })
  }
  scored.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
  return none(scored.slice(0, MAX_CANDIDATES))
}

/**
 * The one candidate worth showing beside an unmatched row as a hint: the best that is in use
 * and the same pack size. Nothing rather than a different pack or a hidden product, because a
 * hint is read as "this is probably it". Still only a hint: the row stays for a person to settle.
 */
export function safeSuggestion(m: ProductMatch): Product | undefined {
  return m.candidates.find((c) => c.product.active && !c.sizeConflict)?.product
}
