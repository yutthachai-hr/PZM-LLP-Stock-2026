import type { StockMovement } from '../types'
import { isLegacyUnitRow } from './uom'
import { roundQty } from './validate'

/**
 * How a stock balance is keyed, and what the ledger adds up to — no database here, so the
 * integrity auditor (lib/integrityAudit.ts) and its offline script can use the very same
 * rules the stock engine files by (moved out of services/stock.ts, 6 Oct 2026).
 */

/**
 * Which balance a movement belongs to.
 *
 * One balance per product per location, in the product's own unit, under the plain
 * `location__product` key (owner's rule of 20 Sep 2026 — see lib/uom.ts). A row keyed in
 * another unit is converted before it gets here, so it lands on that same balance.
 *
 * The `#Unit` rows are the legacy of the earlier rule (13–20 Sep 2026), under which a row
 * keyed as "10 Pack" was filed on its own Pack balance. A movement from that time carries
 * `entryUnit` and no `entryQty`; it keeps filing to its `#Unit` row until the migration
 * tool converts it, so voiding or editing an old row still finds the balance it moved.
 */
export function levelId(locationId: string, productId: string, unit?: string, baseUnit?: string): string {
  const base = `${locationId}__${productId}`
  const u = (unit ?? '').trim()
  return !u || u === (baseUnit ?? '').trim() ? base : `${base}${UNIT_SEP}${u}`
}

/**
 * Separator between the product key and the unit.
 *
 * Deliberately not `__`: the existing key is split on that, and a unit name containing one
 * would silently become part of the product id.
 */
export const UNIT_SEP = '#'

/**
 * The unit a row's balance is counted in: the product's own, except for a legacy row that
 * was never converted, which stays on the balance of the unit it was keyed in.
 */
export function filedUnit(l: { unit: string; entryUnit?: string; entryQty?: number }): string {
  return isLegacyUnitRow(l) ? l.entryUnit!.trim() : l.unit
}

/** The balance unit, but only when it is not the product's own — what a legacy `#Unit` row is stamped with. */
export function extraUnit(x: { unit: string; entryUnit?: string; entryQty?: number }): string | undefined {
  const filed = filedUnit(x)
  return filed === x.unit ? undefined : filed
}

/**
 * The balance row for one line or one movement, and the unit to stamp on it.
 *
 * Both shapes carry the product's own unit and, optionally, the one that was keyed, which is
 * why voiding a movement can find exactly the row it created without reading the product.
 */
export function levelRef(
  locationId: string,
  x: { productId: string; unit: string; entryUnit?: string; entryQty?: number },
): { id: string; unit?: string } {
  return {
    id: levelId(locationId, x.productId, filedUnit(x), x.unit),
    unit: extraUnit(x),
  }
}

/** Split a balance key back into its parts. The unit is absent for the product's own. */
export function parseLevelId(id: string): {
  locationId: string
  productId: string
  unit?: string
} {
  const hash = id.indexOf(UNIT_SEP)
  const head = hash === -1 ? id : id.slice(0, hash)
  const unit = hash === -1 ? undefined : id.slice(hash + 1)
  const cut = head.indexOf('__')
  return {
    locationId: cut === -1 ? head : head.slice(0, cut),
    productId: cut === -1 ? '' : head.slice(cut + 2),
    ...(unit ? { unit } : {}),
  }
}

/**
 * Every balance the ledger adds up to, keyed the way stockLevels is — one per product per
 * location per keyed unit. Exported for the restore, which used to keep its own copy that
 * only knew the product's own unit: a 10 Pack balance was zeroed by the restore meant to
 * save it, because the copy never produced a `#Pack` key for it to survive under.
 */
export function balancesFromLedger(movements: StockMovement[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of movements) {
    if (m.voided) continue
    if (m.fromLocationId) {
      const k = levelRef(m.fromLocationId, m).id
      map.set(k, roundQty((map.get(k) ?? 0) - m.qty))
    }
    if (m.toLocationId) {
      const k = levelRef(m.toLocationId, m).id
      map.set(k, roundQty((map.get(k) ?? 0) + m.qty))
    }
  }
  return map
}

