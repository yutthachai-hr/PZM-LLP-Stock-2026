import type { StockMovement } from '../types'
import { sameUnit } from './units'
import { resolveFactor, type UnitBearer } from './inventoryRules/uom'

/**
 * The unit a product is usually keyed in (owner, 29 Sep 2026: "ระบบจับเองว่า หน่วยไหนของ
 * รายการสินค้านี้ใช้บ่อยที่สุด"). Counted from the movements the app already holds — no read.
 *
 * Per direction, because goods tend to arrive in one unit and leave in another: a carton
 * comes in, packs go out to the branches. A product with no history that way falls back to
 * every movement it has.
 */
export type UnitDirection = 'in' | 'out'

export interface UnitUsage {
  /** productId → unit as keyed → how many lines used it. */
  byDirection: Record<UnitDirection, Map<string, Map<string, number>>>
  all: Map<string, Map<string, number>>
  /** productId → lines of any kind, for ranking search matches. */
  lines: Map<string, number>
}

const DIRECTION: Record<StockMovement['type'], UnitDirection | null> = {
  receive: 'in',
  issue: 'out',
  consume: 'out',
  adjust: null,
}

function bump(map: Map<string, Map<string, number>>, productId: string, unit: string) {
  let units = map.get(productId)
  if (!units) map.set(productId, (units = new Map()))
  units.set(unit, (units.get(unit) ?? 0) + 1)
}

export function unitUsage(movements: readonly StockMovement[]): UnitUsage {
  const usage: UnitUsage = { byDirection: { in: new Map(), out: new Map() }, all: new Map(), lines: new Map() }
  for (const m of movements) {
    if (m.voided) continue
    // A row filed under the old rule (entryUnit with no entryQty) sits on its own balance; it
    // says nothing reliable about the unit people pick today.
    if (m.entryUnit && m.entryQty === undefined) continue
    const unit = m.entryUnit ?? m.unit
    usage.lines.set(m.productId, (usage.lines.get(m.productId) ?? 0) + 1)
    bump(usage.all, m.productId, unit)
    const dir = DIRECTION[m.type]
    if (dir) bump(usage.byDirection[dir], m.productId, unit)
  }
  return usage
}

/**
 * The unit to put on a new line for this product, or undefined for its own unit.
 *
 * Only a unit the product can convert — one with a known rate — is ever proposed, so the
 * line it starts is a real quantity. On a tie the product's own unit wins.
 */
export function usualUnit(product: UnitBearer & { id: string }, usage: UnitUsage, direction: UnitDirection): string | undefined {
  const counts = usage.byDirection[direction].get(product.id) ?? usage.all.get(product.id)
  if (!counts) return undefined
  let best: string | undefined
  let bestN = 0
  let baseN = 0
  for (const [unit, n] of counts) {
    if (sameUnit(unit, product.unitType)) {
      baseN += n
      continue
    }
    if (resolveFactor(product, unit) === null) continue
    if (n > bestN) {
      best = unit
      bestN = n
    }
  }
  return best && bestN > baseN ? best : undefined
}
