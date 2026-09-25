import type { Recipe } from '../types'
import { roundQty } from './validate'

/**
 * The day's POS sales as stock used (Automation Plan Phase 3 — owner, 25 Sep 2026): a sales
 * export (CSV/Excel, one row per menu line) is summed per menu item, matched to its recipe,
 * and turned into ingredient totals that the Issue screen files as one consume document.
 *
 * No POS format is assumed — the owner's export was not seen when this was written — so the
 * person picks which column is the code, the name and the quantity, and the guesses below
 * only preselect them. Pure, so it is tested without a browser.
 */

export type Cell = string | number | boolean | null | undefined
export type Row = Cell[]

export interface ColumnMap {
  /** Row index of the header row. */
  header: number
  code: number | null
  name: number | null
  qty: number | null
}

const CODE_WORDS = /(^|\b)(code|item ?code|menu ?code|plu|sku|รหัส)/i // i18n-key
const NAME_WORDS = /(name|item|menu|product|description|ชื่อ|เมนู|รายการ|สินค้า)/i // i18n-key
const QTY_WORDS = /(qty|quantity|sold|count|units?|จำนวน|ขายได้|ชิ้น)/i // i18n-key

/** The first row that looks like headers, and the columns whose headers say what they are. */
export function guessColumns(rows: readonly Row[]): ColumnMap {
  const limit = Math.min(rows.length, 15)
  for (let r = 0; r < limit; r++) {
    const cells = rows[r].map((c) => String(c ?? '').trim())
    const find = (re: RegExp, not: number[] = []) => {
      const i = cells.findIndex((c, idx) => c !== '' && re.test(c) && !not.includes(idx))
      return i >= 0 ? i : null
    }
    const code = find(CODE_WORDS)
    const qty = find(QTY_WORDS, code !== null ? [code] : [])
    const name = find(NAME_WORDS, [code, qty].filter((x): x is number => x !== null))
    if (qty !== null && (code !== null || name !== null)) return { header: r, code, name, qty }
  }
  return { header: 0, code: null, name: null, qty: null }
}

function num(c: Cell): number {
  if (typeof c === 'number') return c
  const n = Number(String(c ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : NaN
}

/** How a code or name is compared: case, spacing and punctuation do not count. */
export function saleKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9฀-๿]/g, '') // i18n-key
}

/** "045" and "45" are the same POS code. */
function codeKey(s: string): string {
  const k = saleKey(s)
  return /^\d+$/.test(k) ? String(Number(k)) : k
}

export interface SaleLine {
  code: string
  name: string
  qty: number
}

/**
 * The rows under the header, summed per item. A row with no quantity, or a total/void row
 * (quantity not a positive number), is skipped — a refund in a sales export is its own
 * story, not stock used.
 */
export function readSales(rows: readonly Row[], map: ColumnMap): SaleLine[] {
  if (map.qty === null || (map.code === null && map.name === null)) return []
  const by = new Map<string, SaleLine>()
  for (const row of rows.slice(map.header + 1)) {
    const qty = num(row[map.qty])
    if (!(qty > 0)) continue
    const code = map.code !== null ? String(row[map.code] ?? '').trim() : ''
    const name = map.name !== null ? String(row[map.name] ?? '').trim() : ''
    if (!code && !name) continue
    if (/^(total|รวม|grand total|ยอดรวม)/i.test(code || name)) continue // i18n-key
    const key = code ? `c:${codeKey(code)}` : `n:${saleKey(name)}`
    const cur = by.get(key)
    if (cur) cur.qty = roundQty(cur.qty + qty)
    else by.set(key, { code, name, qty: roundQty(qty) })
  }
  return [...by.values()]
}

export interface MatchedSale {
  sale: SaleLine
  recipe: Recipe
}

export interface IngredientUse {
  productId: string
  productName: string
  unit: string
  qty: number
  /** Which menu items it came from, for the preview. */
  from: string[]
}

export interface PosResult {
  matched: MatchedSale[]
  unmatched: SaleLine[]
  /** Matched, but the recipe has no ingredients yet. */
  empty: MatchedSale[]
  usage: IngredientUse[]
}

/** Sales matched to recipes by code first, then by name or alias; the ingredients summed. */
export function matchSales(sales: readonly SaleLine[], recipes: readonly Recipe[]): PosResult {
  const active = recipes.filter((r) => r.active !== false)
  const byCode = new Map(active.filter((r) => r.code).map((r) => [codeKey(r.code), r]))
  const byName = new Map<string, Recipe>()
  for (const r of active) {
    byName.set(saleKey(r.name), r)
    for (const a of r.aliases ?? []) byName.set(saleKey(a), r)
  }
  const matched: MatchedSale[] = []
  const unmatched: SaleLine[] = []
  const empty: MatchedSale[] = []
  const use = new Map<string, IngredientUse>()
  for (const sale of sales) {
    const recipe = (sale.code && byCode.get(codeKey(sale.code))) || (sale.name && byName.get(saleKey(sale.name))) || undefined
    if (!recipe) {
      unmatched.push(sale)
      continue
    }
    if (recipe.lines.length === 0) {
      empty.push({ sale, recipe })
      continue
    }
    matched.push({ sale, recipe })
    for (const l of recipe.lines) {
      const u = use.get(l.productId) ?? { productId: l.productId, productName: l.productName, unit: l.unit, qty: 0, from: [] }
      u.qty = roundQty(u.qty + l.qty * sale.qty)
      if (!u.from.includes(recipe.name)) u.from.push(recipe.name)
      use.set(l.productId, u)
    }
  }
  return {
    matched,
    unmatched,
    empty,
    usage: [...use.values()].filter((u) => u.qty > 0).sort((a, b) => a.productName.localeCompare(b.productName)),
  }
}
