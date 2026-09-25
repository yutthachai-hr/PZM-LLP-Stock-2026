import { useEffect, useSyncExternalStore } from 'react'
import { backend } from '../backend'
import { getBrand, onBrandChange } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { roundQty } from '../lib/validate'
import { saleKey } from '../lib/posImport'
import { COL, type Product, type Recipe, type RecipeLine, type Role } from '../types'

/**
 * Recipes: what one sale of a POS menu item takes from stock (Automation Plan Phase 3 —
 * owner, 25 Sep 2026). A handful of documents per brand, read once per session and held,
 * like the supplier list. Written by a หัวหน้า or admin; nothing is deleted — a recipe no
 * longer on the menu is switched off, so an old import still explains itself.
 */

export const MAX_RECIPE_LINES = 60

function scoped() {
  return backend.forBrand(getBrand())
}

let cached: Recipe[] | null = null
let inflight: Promise<Recipe[]> | null = null
const listeners = new Set<() => void>()
const NONE: Recipe[] = []
const announce = () => listeners.forEach((fn) => fn())

const byCode = (a: Recipe, b: Recipe) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name)

export async function loadRecipes(force = false): Promise<Recipe[]> {
  if (cached && !force) return cached
  if (inflight) return inflight
  inflight = scoped()
    .getAll<Recipe>(COL.recipes)
    .then((rows) => {
      cached = [...rows].sort(byCode)
      announce()
      return cached
    })
    .catch(() => {
      cached = NONE
      announce()
      return NONE
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

onBrandChange(() => {
  cached = null
  announce()
})

function patch(row: Recipe) {
  if (!cached) return
  cached = [...cached.filter((r) => r.id !== row.id), row].sort(byCode)
  announce()
}

/** Every recipe of the brand, fetched the first time a screen asks. */
export function useRecipes(): Recipe[] {
  const rows = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => cached,
    () => cached,
  )
  useEffect(() => {
    void loadRecipes()
  }, [])
  return rows ?? NONE
}

export interface RecipeInput {
  id?: string
  code: string
  name: string
  aliases?: string[]
  lines: { productId: string; qty: number }[]
}

function requireManager(role: Role) {
  if (role !== 'admin' && role !== 'manager') throw new AppError('ต้องเป็นหัวหน้าหรือผู้ดูแลระบบ')
}

/**
 * Create or change a recipe. The code is the POS code and must not clash with another
 * recipe's (compared as the import compares it: "045" is 45). Lines take the product's
 * name and unit from the catalogue, so a recipe always reads in the product's own unit.
 */
export async function saveRecipe(
  input: RecipeInput,
  ctx: { products: readonly Product[]; existing: readonly Recipe[] },
  actor: { id: string; name: string; role: Role },
): Promise<Recipe> {
  requireManager(actor.role)
  const code = input.code.trim()
  const name = input.name.trim()
  if (!code) throw new AppError('กรุณาใส่รหัสเมนู')
  if (!name) throw new AppError('กรุณาใส่ชื่อเมนู')
  const key = (s: string) => {
    const k = saleKey(s)
    return /^\d+$/.test(k) ? String(Number(k)) : k
  }
  const clash = ctx.existing.find((r) => r.id !== input.id && key(r.code) === key(code))
  if (clash) throw new AppError('รหัสเมนู {code} ใช้กับ "{name}" อยู่แล้ว', { code, name: clash.name })
  if (input.lines.length > MAX_RECIPE_LINES) throw new AppError('ส่วนผสมเกิน {n} รายการ', { n: MAX_RECIPE_LINES })

  const seen = new Set<string>()
  const lines: RecipeLine[] = input.lines.map((l) => {
    const p = ctx.products.find((x) => x.id === l.productId)
    if (!p) throw new AppError('ไม่พบสินค้า')
    if (seen.has(p.id)) throw new AppError('"{name}" อยู่ในสูตรนี้มากกว่า 1 บรรทัด', { name: p.name })
    seen.add(p.id)
    const qty = roundQty(Number(l.qty))
    if (!(qty > 0)) throw new AppError('ปริมาณของ "{name}" ต้องมากกว่า 0', { name: p.name })
    return { productId: p.id, productName: p.name, unit: p.unitType, qty }
  })
  const aliases = [...new Set((input.aliases ?? []).map((a) => a.trim()).filter(Boolean))].slice(0, 10)
  const now = Date.now()
  const prev = input.id ? ctx.existing.find((r) => r.id === input.id) : undefined
  const row: Recipe = prev
    ? { ...prev, code, name, lines, active: prev.active, updatedAt: now, updatedBy: actor.id, updatedByName: actor.name, ...(aliases.length ? { aliases } : {}) }
    : {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        code,
        name,
        lines,
        active: true,
        createdBy: actor.id,
        createdByName: actor.name,
        createdAt: now,
        updatedAt: now,
        ...(aliases.length ? { aliases } : {}),
      }
  if (prev && !aliases.length) delete (row as Partial<Recipe>).aliases
  const { id, ...data } = row
  await scoped().set(COL.recipes, id, data)
  patch(row)
  return row
}

/** On or off the menu. Never deleted: past imports name it. */
export async function setRecipeActive(recipe: Recipe, active: boolean, actor: { id: string; name: string; role: Role }): Promise<Recipe> {
  requireManager(actor.role)
  const row: Recipe = { ...recipe, active, updatedAt: Date.now(), updatedBy: actor.id, updatedByName: actor.name }
  const { id, ...data } = row
  await scoped().set(COL.recipes, id, data)
  patch(row)
  return row
}

/**
 * Start the list from the menu codes (lib/menuCodes.ts): one recipe per code not already
 * there, with no ingredients yet — the POS import then names exactly what still needs
 * filling in. Safe to press twice.
 */
export async function addMissingMenu(
  menu: readonly (readonly [string, string])[],
  ctx: { products: readonly Product[]; existing: readonly Recipe[] },
  actor: { id: string; name: string; role: Role },
): Promise<number> {
  requireManager(actor.role)
  let existing = [...ctx.existing]
  let added = 0
  for (const [code, name] of menu) {
    const k = saleKey(code)
    const key = /^\d+$/.test(k) ? String(Number(k)) : k
    if (existing.some((r) => {
      const rk = saleKey(r.code)
      return (/^\d+$/.test(rk) ? String(Number(rk)) : rk) === key
    })) continue
    const row = await saveRecipe({ code, name, lines: [] }, { products: ctx.products, existing }, actor)
    existing = [...existing, row]
    added++
  }
  return added
}
