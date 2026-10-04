import type { StockLocation } from '../types'

/**
 * The tint a site is shown in wherever figures are listed per location: the main
 * warehouse (Sukhumvit) red, Sarasin orange, On Nut light purple. Matched by name, in
 * Thai or English, then by type; a site added later takes the next unused tint.
 */
const TONES = [
  'bg-site-a-soft text-site-a',
  'bg-site-b-soft text-site-b',
  'bg-site-c-soft text-site-c',
] as const

function slot(l: Pick<StockLocation, 'name' | 'nameEn' | 'type'>): number | null {
  const n = `${l.name} ${l.nameEn ?? ''}`.toLowerCase()
  if (n.includes('สุขุมวิท') || n.includes('sukhumvit')) return 0
  if (n.includes('สารสิน') || n.includes('sarasin')) return 1
  if (n.includes('อ่อนนุช') || n.includes('on nut') || n.includes('onnut')) return 2
  if (l.type === 'warehouse') return 0
  return null
}

/**
 * A site's number as the company says it (owner, 4 Oct 2026: "สารสินคือสาขา 2 ส่วนอ่อนนุชคือ
 * สาขา 3"): Sukhumvit 1, Sarasin 2, On Nut 3 — the same order as the tints. Null for a site
 * the names do not cover.
 */
export function siteNumber(l: Pick<StockLocation, 'name' | 'nameEn' | 'type'>): number | null {
  const s = slot(l)
  return s === null ? null : s + 1
}

/** A site's name without "สาขา" in front, for a short label: "สาขาสารสิน" → "สารสิน". */
export function shortSiteName(name: string): string {
  return name.replace(/^สาขา\s*/, '').trim() || name
}

export function siteTones(locations: readonly Pick<StockLocation, 'id' | 'name' | 'nameEn' | 'type'>[]): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<number>()
  for (const l of locations) {
    const s = slot(l)
    if (s !== null && !used.has(s)) {
      out.set(l.id, TONES[s])
      used.add(s)
    }
  }
  let next = 0
  for (const l of locations) {
    if (out.has(l.id)) continue
    while (used.has(next % TONES.length) && used.size < TONES.length) next++
    out.set(l.id, TONES[next % TONES.length])
    used.add(next % TONES.length)
    next++
  }
  return out
}
