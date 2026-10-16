// The product picker's search: what a person types into the request form, ranked.

import { normaliseName, productSimilarity, similarity } from './productMatch'
import { foldSearch, looseMatch, looseScore } from './search'
import type { Product } from '../types'

const MAX_RESULTS = 40

/** Name or code, the way the person types it: a code prefix wins, then closest name. */
export function searchProducts(q: string, products: readonly Product[]): Product[] {
  const raw = q.trim()
  if (!raw) return []
  const key = normaliseName(raw)
  const upper = raw.toUpperCase()
  const hasFold = foldSearch(raw).length > 0
  return products
    .map((p) => {
      const sku = p.sku.toUpperCase()
      const name = normaliseName(p.name)
      let score = 0
      if (sku === upper) score = 3
      else if (sku.startsWith(upper)) score = 2.5
      else if (hasFold) {
        if (key && name.includes(key)) score = 2 + similarity(key, name) / 10
        // Spacing and word order forgiven: "siamfood salad" finds "SALAD (SIAM FOOD)". Pieces of
        // words found anywhere ("ranch" inside BRANCH, a stray "1") rank below a name that shares
        // a whole word, so "RANCH 1 KG" does not put GAS 48 KG Branch 1 above RANCH.
        else if (looseMatch([p.name, p.sku], raw))
          score = (key && productSimilarity(key, name).score > 0 ? 1.5 : 0.5) + looseScore([p.name, p.sku], raw) / 100
        // Ranked as the order import ranks it: a shared "1 KG" never outranks the name.
        else if (key) score = productSimilarity(key, name).score
      }
      return { p, score }
    })
    .filter((x) => x.score >= 0.4)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, MAX_RESULTS)
    .map((x) => x.p)
}
