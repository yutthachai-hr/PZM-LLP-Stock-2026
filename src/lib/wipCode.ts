/**
 * Work-in-process item codes (owner, 30 Sep 2026): one running number per brand —
 * WIP-001, WIP-002 … for Pizza Mania, WIP-LL-001 … for Le Lapin — and a new WIP item takes
 * the next number by itself: "ถ้าเกิดอนาคตมี WIP ตัวใหม่ เลขต้องรันเองอัตโนมัติต่อทันที ชั้นไม่ต้อง
 * ไปไล่เองว่าถึงลำดับไหนแล้ว".
 *
 * The next number follows the highest one the catalogue holds, retired items included, so a
 * code is never handed out twice while its product is still on record.
 */

export const WIP_CATEGORY = 'WIP'

export type WipBrand = 'PZM' | 'LLP'

const PREFIX: Record<WipBrand, string> = { PZM: 'WIP-', LLP: 'WIP-LL-' }
const DIGITS = 3

/** Whether a category names the work-in-process one, however it was typed. */
export function isWipCategory(category: string | undefined): boolean {
  return (category ?? '').trim().toUpperCase() === WIP_CATEGORY
}

/** The running number of a code in this brand's series, or null for any other code. */
export function wipSeq(sku: string, brand: WipBrand): number | null {
  const m = new RegExp(`^${PREFIX[brand]}(\\d+)$`).exec(sku.trim().toUpperCase())
  return m ? Number(m[1]) : null
}

/** The code with this running number: WIP-007, WIP-LL-012. */
export function wipCode(seq: number, brand: WipBrand): string {
  return `${PREFIX[brand]}${String(seq).padStart(DIGITS, '0')}`
}

/** The code a new WIP item of this brand gets: one past the highest already in the catalogue. */
export function nextWipCode(products: readonly { sku: string }[], brand: WipBrand): string {
  let top = 0
  for (const p of products) {
    const n = wipSeq(p.sku, brand)
    if (n !== null && n > top) top = n
  }
  return wipCode(top + 1, brand)
}
