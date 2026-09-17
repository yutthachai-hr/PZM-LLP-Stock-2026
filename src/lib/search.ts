/**
 * Matching what people type against what the catalogue says.
 *
 * "SIAM FOOD" and "SIAMFOOD" are the same supplier to the person typing; "siam food"
 * is too. So both sides are folded: lower-cased, with spaces, punctuation and brackets
 * removed, before one is looked for inside the other — and a search of several words
 * matches when every word is found somewhere, in any order, so "salad ack" finds
 * "RED OAK SALAD (ACK)". Thai letters are kept as they are; the fold only drops what
 * separates words.
 */

const SEPARATORS = /[\s\-_.,/()[\]{}'"&+*#:;!?]+/g

export function foldSearch(s: string): string {
  return s.toLowerCase().replace(SEPARATORS, '')
}

/** True when `needle` (as typed) is found in `hay`, ignoring spacing, case and punctuation. */
export function looseIncludes(hay: string, needle: string): boolean {
  const n = foldSearch(needle)
  if (!n) return true
  const h = foldSearch(hay)
  if (h.includes(n)) return true
  // Every word somewhere, any order — but only when there is more than one word, so a
  // single word still has to appear as typed.
  const words = needle.toLowerCase().split(/\s+/).filter(Boolean)
  return words.length > 1 && words.every((w) => h.includes(foldSearch(w)))
}

/** `looseIncludes` over several fields of one record. */
export function looseMatch(fields: readonly (string | undefined)[], needle: string): boolean {
  if (!foldSearch(needle)) return true
  return fields.some((f) => !!f && looseIncludes(f, needle))
}

/**
 * How well a record matches, for ordering suggestions: a fold-exact start beats a start of
 * a word, which beats a match anywhere. Zero = no match.
 */
export function looseScore(fields: readonly (string | undefined)[], needle: string): number {
  const n = foldSearch(needle)
  if (!n) return 1
  let best = 0
  for (const f of fields) {
    if (!f) continue
    const h = foldSearch(f)
    if (h === n) return 100
    if (h.startsWith(n)) best = Math.max(best, 80)
    else if (h.includes(n)) best = Math.max(best, 50)
    else if (looseIncludes(f, needle)) best = Math.max(best, 30)
  }
  return best
}
