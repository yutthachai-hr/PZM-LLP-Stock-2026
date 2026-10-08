import type { Product } from '../types'

/**
 * The closest catalogue products for a name read off a file (6 Oct 2026) — a suggestion
 * for a person to tap, never a match filed on its own (that stays lib/billOcr's sure match).
 *
 * People write "Feta cheese." or "Plain yoghurt" where the catalogue says
 * "FETA CHEESE 500G (HOMEMADE CHEESE)" or "YOGHURT PLAIN 1 KG": the words are there, in
 * another order, with sizes and brackets around them. So the comparison is word by word:
 * how many of the read words start a word in the product's name or code, order ignored.
 */

/** Words that say nothing about which product: sizes, units, filler. */
const NOISE = new Set(['kg', 'g', 'gr', 'gm', 'ml', 'l', 'lt', 'ltr', 'pcs', 'pc', 'ea', 'pack', 'pk', 'ctn', 'box', 'bag', 'x', 'and', 'the', 'of', 'กก', 'กรัม', 'ถุง', 'แพ็ค', 'ชิ้น', 'กล่อง'])

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[()[\]{}.,;:!?"'`/\\|*+_-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !/^\d+([.,]\d+)?[a-z]*$/.test(w) && !/^x\d+$/.test(w) && !NOISE.has(w))
}

export interface Suggestion {
  product: Product
  /** Share of the read words found in the product, 0–1. */
  score: number
}

export function suggestProducts(readName: string, products: readonly Product[], limit = 3): Suggestion[] {
  const read = [...new Set(words(readName))]
  if (!read.length) return []
  const out: Suggestion[] = []
  for (const p of products) {
    if (p.active === false) continue
    const have = words(`${p.name} ${p.sku ?? ''}`)
    let hit = 0
    for (const w of read) if (have.some((h) => h.startsWith(w) || (w.length >= 4 && w.startsWith(h) && h.length >= 4))) hit++
    const score = hit / read.length
    if (score >= 0.5) out.push({ product: p, score })
  }
  // Most words first; among equals, the shorter name (fewer extra words) — the plainer product.
  return out.sort((a, b) => b.score - a.score || a.product.name.length - b.product.name.length).slice(0, limit)
}
