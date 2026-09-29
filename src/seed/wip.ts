import type { UnitConversion } from '../lib/units'
import { WIP_CATEGORY } from '../lib/wipCode'

export { WIP_CATEGORY }

/**
 * Work-in-process items — what the kitchen makes from raw materials and the branches stock
 * and sell (owner, 29 Sep 2026). They had no item codes: the closing-stock workbook lists
 * them in its "Work in Progress" blocks with a running number instead. The owner asked for
 * the codes to be numbered here, in order (30 Sep 2026: "รันตามลำดับ"):
 *
 *   PZM:  WIP-001, WIP-002 …      LLP:  WIP-LL-001 …      (lib/wipCode.ts)
 *
 * PZM 1–20 are the workbook's own numbers in "Work in Progress - Sukhumvit 23"; the cookie
 * block follows as 21–24. A WIP item added later takes the next number by itself.
 *
 * Names are the workbook's own (the "- Sukhumvit 23" production-site suffix dropped), so a
 * later import of the same workbook finds them by name. The unit is the one the workbook
 * counts them in; the tray a dough ball comes on is a rate. Nothing here is written by
 * itself — an admin reviews the list and adds it (products/WipCatalogModal).
 */
export interface WipItem {
  sku: string
  name: string
  /** Display name of the unit. */
  unit: string
  unitType: string
  unitConversions?: UnitConversion[]
  /** Where it came from in the workbook, for anyone checking. */
  source: string
}

export const WIP_ITEMS: Record<'PZM' | 'LLP', WipItem[]> = {
  PZM: [
    { sku: 'WIP-001', name: 'Pizza Dough Pizza 12"', unit: 'ลูก', unitType: 'ลูก', unitConversions: [{ label: 'ถาด', size: 12 }], source: 'PZM แถว 247 · 1ถาด/12ลูก' },
    { sku: 'WIP-002', name: 'Pizza Dough Pizza 18"', unit: 'ลูก', unitType: 'ลูก', unitConversions: [{ label: 'ถาด', size: 4 }], source: 'PZM แถว 248 · 1ถาด/4ลูก' },
    { sku: 'WIP-003', name: 'Pizza Dough Pizza 12"NY', unit: 'ลูก', unitType: 'ลูก', unitConversions: [{ label: 'ถาด', size: 6 }], source: 'PZM แถว 249 · 1ถาด/6ลูก' },
    { sku: 'WIP-004', name: 'Pomodoro Sauce 74', unit: 'ถุง', unitType: 'EA', source: 'PZM แถว 250' },
    { sku: 'WIP-005', name: 'Arrabita Sauce 70', unit: 'ถุง', unitType: 'EA', source: 'PZM แถว 251' },
    { sku: 'WIP-006', name: 'Bolonese Sauce 88', unit: 'ถุง', unitType: 'EA', source: 'PZM แถว 252' },
    { sku: 'WIP-007', name: 'House Italian', unit: 'กระปุก 80G', unitType: 'EA', source: 'PZM แถว 253' },
    { sku: 'WIP-008', name: 'Caesar Dressing', unit: 'กระปุก 80G', unitType: 'EA', source: 'PZM แถว 254' },
    { sku: 'WIP-009', name: 'Olive Oil Dressing', unit: 'กระปุก 80G', unitType: 'EA', source: 'PZM แถว 255' },
    { sku: 'WIP-010', name: 'GARLIC BUTTER', unit: 'กระปุก 80G', unitType: 'EA', source: 'PZM แถว 256' },
    { sku: 'WIP-011', name: 'RANCH DRESSING', unit: 'กระปุก 80G', unitType: 'EA', source: 'PZM แถว 257' },
    { sku: 'WIP-012', name: 'BLUE CHEESE DRESSING', unit: 'กระปุก 80G', unitType: 'EA', source: 'PZM แถว 258' },
    { sku: 'WIP-013', name: 'MAYONAISE', unit: 'กระปุก 80G', unitType: 'EA', source: 'PZM แถว 259' },
    { sku: 'WIP-014', name: 'CREAMY HOUSE VINAIGRETTE', unit: 'กระปุก 80G', unitType: 'EA', source: 'PZM แถว 260' },
    { sku: 'WIP-015', name: 'SPICY MARINARA', unit: 'กระปุก 80G', unitType: 'EA', source: 'PZM แถว 261' },
    { sku: 'WIP-016', name: 'SIRACHA MAYONAISE', unit: 'กระปุก 80G', unitType: 'EA', source: 'PZM แถว 262' },
    { sku: 'WIP-017', name: 'SHRIMP-SQUID (KT)', unit: 'Pack', unitType: 'PACK', source: 'PZM แถว 263' },
    { sku: 'WIP-018', name: 'Pizza Sauce truffes', unit: 'ถุง', unitType: 'ถุง', source: 'PZM แถว 264' },
    { sku: 'WIP-019', name: 'CHEESE TRUFFES', unit: 'ถุง', unitType: 'ถุง', source: 'PZM แถว 265' },
    { sku: 'WIP-020', name: 'CHICKEN BREAST (KT) ย่าง', unit: 'ชิ้น', unitType: 'EA', source: 'PZM แถว 266' },
    { sku: 'WIP-021', name: 'THE YUMMY', unit: 'ชิ้น 70g', unitType: 'ชิ้น', source: 'PZM แถว 290 · Work in Progress - Cookie' },
    { sku: 'WIP-022', name: 'THE NEW-YORKER', unit: 'ชิ้น 70g', unitType: 'ชิ้น', source: 'PZM แถว 291 · Work in Progress - Cookie' },
    { sku: 'WIP-023', name: 'THE PEANUT CRUSH', unit: 'ชิ้น 70g', unitType: 'ชิ้น', source: 'PZM แถว 292 · Work in Progress - Cookie' },
    { sku: 'WIP-024', name: "THE COOKIES'N'CREAM", unit: 'ชิ้น 70g', unitType: 'ชิ้น', source: 'PZM แถว 293 · Work in Progress - Cookie' },
  ],
  LLP: [
    { sku: 'WIP-LL-001', name: 'COOKIE', unit: 'ชิ้น', unitType: 'EA', source: 'LLP แถว 146 · Work in Progress - Sarasin' },
    { sku: 'WIP-LL-002', name: 'BROWNIES', unit: 'ชิ้น', unitType: 'EA', source: 'LLP แถว 147 · Work in Progress - Sarasin' },
    { sku: 'WIP-LL-003', name: 'FALAFEL', unit: 'ชิ้น', unitType: 'EA', source: 'LLP แถว 149 · Work in Progress - Sarasin' },
    { sku: 'WIP-LL-004', name: 'MAYONES Sauce', unit: 'กระปุก', unitType: 'EA', source: 'LLP แถว 166 · WIP' },
    { sku: 'WIP-LL-005', name: 'Tzatziki Sauce', unit: 'กระปุก', unitType: 'EA', source: 'LLP แถว 167 · WIP' },
  ],
}

/** The listed items a catalogue does not have yet, matched by code. */
export function missingWip(items: readonly WipItem[], products: readonly { sku: string }[]): WipItem[] {
  const have = new Set(products.map((p) => p.sku.trim().toUpperCase()))
  return items.filter((i) => !have.has(i.sku.toUpperCase()))
}
