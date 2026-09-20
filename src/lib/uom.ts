import { AppError } from '../i18n/AppError'
import { sameUnit } from './units'
import { resolveFactor, toBase, type UnitBearer } from './inventoryRules/uom'

// The app-side face of the unit rules: everything pure is in inventoryRules/uom.ts (shared
// with the Worker); this adds the one call that refuses in the app's own words.
export * from './inventoryRules/uom'

export interface QtyEntry {
  /** In the product's base unit — what the balance moves by. */
  qty: number
  /** As keyed. Equal to `qty` when keyed in the base unit. */
  entryQty: number
  /** The unit keyed, absent when it was the base unit. */
  entryUnit?: string
  factor: number
}

/** A keyed quantity converted for a product, or a refusal that names what is missing. */
export function entryFor(product: UnitBearer & { name?: string }, entryQty: number, entryUnit?: string): QtyEntry {
  const factor = resolveFactor(product, entryUnit)
  if (factor === null) {
    throw new AppError('ยังไม่ได้กำหนดอัตราแปลง "{unit}" ของ "{name}" — กำหนดที่หน้าสินค้าก่อน', {
      unit: entryUnit ?? '',
      name: product.name ?? product.unitType,
    })
  }
  const other = !!entryUnit && !sameUnit(entryUnit, product.unitType)
  return { qty: toBase(entryQty, factor), entryQty, ...(other ? { entryUnit: entryUnit!.trim() } : {}), factor }
}

