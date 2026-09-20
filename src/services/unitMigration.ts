import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { describeQty, isLegacyUnitRow, resolveFactor, toBase } from '../lib/uom'
import { COL, type Product, type StockLevel, type StockMovement } from '../types'
import { rebuildProductLevels } from './stock'

/**
 * Folding the old per-unit balances into the product's own unit.
 *
 * Under the rule of 13–20 Sep 2026 a row keyed as "10 Pack" was filed on its own Pack
 * balance (`loc__prod#Pack`). Under the rule since, every row is converted into the
 * product's own unit. This tool brings the old rows across, one product at a time, once
 * the owner has stated the rate for each unit involved: each legacy movement gets
 * `entryQty` (what was keyed) and a base `qty`, signed in the migrator's name, and the
 * product's balances are rebuilt from its ledger — the `#Unit` rows go to zero.
 *
 * Nothing is guessed: a product whose legacy unit has no rate is listed as blocked until
 * the rate exists. Safe to run again: a row already carrying `entryQty` is skipped, so a
 * run that stopped halfway resumes where it was.
 */

const MAX_ROWS = 1000

export interface UnitMigrationCandidate {
  productId: string
  productName: string
  unitType: string
  /** The legacy balances still standing, as the books show them. */
  rows: { locationId: string; unit: string; qty: number }[]
  /** Legacy movements that would be converted. */
  legacyMovements: number
  /** The rate known for each legacy unit, or null when the owner has not stated one. */
  factors: Record<string, number | null>
  blockedUnits: string[]
}

function scoped() {
  return backend.forBrand(getBrand())
}

/** Every product with a legacy per-unit balance or an unconverted legacy row. */
export async function listUnitMigration(): Promise<UnitMigrationCandidate[]> {
  const db = scoped()
  const [levels, products] = await Promise.all([db.getAll<StockLevel>(COL.stockLevels), db.getAll<Product>(COL.products)])
  const byProduct = new Map(products.map((p) => [p.id, p]))
  const ids = new Set(levels.filter((l) => l.unit).map((l) => l.productId))
  const out: UnitMigrationCandidate[] = []
  for (const productId of ids) {
    const product = byProduct.get(productId)
    if (!product) continue
    const mine = await db.getBy<StockMovement>(COL.movements, 'productId', productId)
    const legacy = mine.filter((m) => !m.voided && isLegacyUnitRow(m))
    const rows = levels
      .filter((l) => l.productId === productId && l.unit && l.qty !== 0)
      .map((l) => ({ locationId: l.locationId, unit: l.unit!, qty: l.qty }))
    if (legacy.length === 0 && rows.length === 0) continue
    const units = [...new Set([...legacy.map((m) => m.entryUnit!.trim()), ...rows.map((r) => r.unit)])]
    const factors: Record<string, number | null> = {}
    for (const u of units) factors[u] = resolveFactor(product, u)
    out.push({
      productId,
      productName: product.name,
      unitType: product.unitType,
      rows,
      legacyMovements: legacy.length,
      factors,
      blockedUnits: units.filter((u) => factors[u] === null),
    })
  }
  return out.sort((a, b) => a.productName.localeCompare(b.productName))
}

/** Convert one product's legacy rows and rebuild its balances. Returns how many rows moved. */
export async function migrateProductUnits(params: { productId: string; actor: { id: string; name: string } }): Promise<{ converted: number }> {
  const { productId, actor } = params
  const db = scoped()
  const product = await db.getOne<Product>(COL.products, productId)
  if (!product) throw new AppError('ไม่พบสินค้า')
  const mine = await db.getBy<StockMovement>(COL.movements, 'productId', productId)
  if (mine.length > MAX_ROWS) {
    throw new AppError('สินค้านี้มีประวัติ {count} รายการ มากเกินกว่าจะแปลงทั้งหมดได้', { count: mine.length })
  }
  const legacy = mine.filter((m) => isLegacyUnitRow(m))
  const missing = [...new Set(legacy.map((m) => m.entryUnit!.trim()).filter((u) => resolveFactor(product, u) === null))]
  if (missing.length > 0) {
    throw new AppError('ยังไม่ได้กำหนดอัตราแปลง "{unit}" ของ "{name}" — กำหนดที่หน้าสินค้าก่อน', { unit: missing.join(', '), name: product.name })
  }

  const now = Date.now()
  const converted: StockMovement[] = []
  for (const m of mine) {
    if (!isLegacyUnitRow(m)) {
      converted.push(m)
      continue
    }
    const factor = resolveFactor(product, m.entryUnit)!
    const next: StockMovement = { ...m, entryQty: m.qty, qty: toBase(m.qty, factor) }
    // One write per row, idempotent: a row already carrying entryQty is never touched again.
    await db.update(COL.movements, m.id, {
      entryQty: next.entryQty,
      qty: next.qty,
      edits: [
        ...(m.edits ?? []),
        {
          by: actor.id,
          byName: actor.name,
          at: now,
          changed: ['หน่วย', 'จำนวน'], // i18n-key
          changes: [{ field: 'entryQty', from: describeQty(m), to: describeQty(next) }],
        },
      ],
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: now,
    })
    converted.push(next)
  }

  await rebuildProductLevels(db, productId, converted, actor, now)
  return { converted: legacy.length }
}
