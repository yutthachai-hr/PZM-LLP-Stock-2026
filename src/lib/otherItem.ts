/**
 * Smart "Other" item (R&D, owner brief of 8 Oct 2026): a person types what they want to buy
 * instead of picking the category's catch-all "(OTHER)" product, and the app finds the
 * product it already is — or, when nothing is, proposes a new one with its own code.
 *
 * Product identity is the internal product id, never a name. This file only DECIDES what
 * to offer; it reads nothing (the device already holds the brand's products and aliases,
 * so typing costs no Firestore reads) and writes nothing (a new item is created on the
 * server, commands/proposeItem.ts).
 *
 * Matching, in the brief's order, on top of lib/productMatch (one matcher for the app):
 *   1. the text is a verified product's SKU, barcode or id                 → `use`
 *   2. a spelling somebody confirmed (product alias)                       → `use`
 *   3. exactly one product with the same normalised name AND a compatible
 *      unit and spec                                                       → `use`
 *   4. the same name with a different unit or spec, several same-named
 *      products, or only similar names                                     → `choose` (never automatic)
 *   5. nothing close                                                       → `create`
 * A product still pending review is offered but never matched automatically: two people
 * proposing the same thing on the same day should be put in front of each other's item,
 * not silently merged into it.
 */
import { buildMatchIndex, matchProduct, normaliseName, type MatchIndex, type ProductAlias } from './productMatch'
import { sameUnit } from './units'
import type { Product } from '../types'

/** Where a product stands: a reviewed catalogue item, or one proposed through "Other". */
export type ItemReview = 'verified' | 'pending'
export const reviewOf = (p: Pick<Product, 'review'>): ItemReview => (p.review === 'pending' ? 'pending' : 'verified')

/** A catch-all product: the category's "(OTHER)" placeholder (R&D catalogue, main 476fa35). */
export function isOtherPlaceholder(p: Pick<Product, 'name'>): boolean {
  return /\(\s*other\s*\)\s*$/i.test(p.name.trim()) || /-\s*\(other\)/i.test(p.name)
}

export interface OtherInput {
  name: string
  /** Free text the person wrote about it (size, grade, pack). Compared, normalised, when both sides have one. */
  spec?: string
  /** The unit they buy it in; compared with the product's own unit when both are known. */
  unit?: string
}

export type OtherDecision =
  | { kind: 'use'; product: Product; why: 'code' | 'alias' | 'name' }
  | { kind: 'choose'; candidates: { product: Product; why: 'same-name-other-spec' | 'same-name' | 'similar' | 'pending'; score: number }[] }
  | { kind: 'create'; candidates: { product: Product; why: 'similar'; score: number }[] }
  | { kind: 'empty' }

/** Spec text as a comparable key: case, spacing and punctuation do not matter; numbers do. */
export function specKey(spec: string | undefined): string {
  return normaliseName(spec ?? '')
}

/** The key a new item is claimed under, so two sessions proposing it get ONE product. */
export function itemKey(input: OtherInput): string {
  return `${normaliseName(input.name)}|${specKey(input.spec)}|${(input.unit ?? '').trim().toLowerCase()}`
}

function unitCompatible(p: Product, unit: string | undefined): boolean {
  if (!unit || !unit.trim() || !p.unitType) return true // nothing to compare: the person confirms
  return sameUnit(unit, p.unitType) || sameUnit(unit, p.unit) || (p.unitConversions ?? []).some((c) => sameUnit(c.label, unit))
}
function specCompatible(p: Product, spec: string | undefined): boolean {
  const mine = specKey(spec)
  const theirs = specKey(p.spec)
  return !mine || !theirs || mine === theirs
}

/** Build once per catalogue change (not per keystroke). Placeholders never match anything. */
export function otherIndex(products: readonly Product[], aliases: readonly ProductAlias[]): { index: MatchIndex; products: readonly Product[] } {
  const real = products.filter((p) => p.active !== false && !isOtherPlaceholder(p))
  return { index: buildMatchIndex(real, aliases), products: real }
}

export function decideOther(input: OtherInput, idx: { index: MatchIndex; products: readonly Product[] }): OtherDecision {
  const raw = input.name.trim()
  if (normaliseName(raw).length < 2) return { kind: 'empty' }

  // 1. A code: SKU (matchProduct), barcode or the id itself — verified products only.
  const code = raw.toUpperCase()
  const byCode = idx.products.find((p) => (p.barcode && p.barcode.trim().toUpperCase() === code) || p.id.toUpperCase() === code)
  const m = matchProduct(raw, idx.index)
  const coded = byCode ?? (m.kind === 'exact' && m.product && m.product.sku.trim().toUpperCase() === code ? m.product : undefined)
  if (coded && reviewOf(coded) === 'verified') return { kind: 'use', product: coded, why: 'code' }

  // 2.–3. An alias, or one product of exactly that name — if its unit and spec agree.
  if ((m.kind === 'alias' || m.kind === 'exact') && m.product) {
    const p = m.product
    if (reviewOf(p) === 'pending') return { kind: 'choose', candidates: [{ product: p, why: 'pending', score: 1 }] }
    if (unitCompatible(p, input.unit) && specCompatible(p, input.spec)) return { kind: 'use', product: p, why: m.kind === 'alias' ? 'alias' : 'name' }
    return { kind: 'choose', candidates: [{ product: p, why: 'same-name-other-spec', score: 1 }] }
  }
  // 4. Several of that name, or only similar ones: a person picks (or creates).
  if (m.kind === 'ambiguous') {
    return { kind: 'choose', candidates: m.candidates.map((c) => ({ product: c.product, why: reviewOf(c.product) === 'pending' ? 'pending' : 'same-name', score: c.score })) }
  }
  const similar = m.candidates.map((c) => ({ product: c.product, why: 'similar' as const, score: c.score }))
  // 5. Nothing close enough to be the same thing: create, showing the near ones beside it.
  return { kind: 'create', candidates: similar }
}

/** R&D's provisional codes: RND-000001 … (server-allocated, never reused). */
export const OTHER_SKU_PREFIX = 'RND-'
export const makeOtherSku = (seq: number) => `${OTHER_SKU_PREFIX}${String(seq).padStart(6, '0')}`
/** The brands the feature is on for (first phase: R&D only). */
export const OTHER_ITEM_BRANDS = ['rnd'] as const
export const otherItemOn = (brand: string, env: Record<string, string | undefined>) =>
  (OTHER_ITEM_BRANDS as readonly string[]).includes(brand) && env.VITE_OTHER_ITEM !== 'off'
