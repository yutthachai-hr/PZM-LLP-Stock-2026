import { backend } from '../backend'
import { DELETE_FIELD } from '../backend/types'
import { AppError } from '../i18n/AppError'
import { COL, type ProductImage, type StockLevel } from '../types'
import { QTY_MAX } from '../lib/validate'
import { normaliseConversions, type UnitConversion } from '../lib/units'

export interface ProductInput {
  /** Who we buy it from. Empty means nobody has said yet. */
  supplierId?: string
  /** Other suppliers it can come from. See the field on Product. */
  alternateSupplierIds?: string[]
  sku: string
  name: string
  category: string
  unit: string
  unitType: string
  minStock: number
  cost?: number
  /** Reference multipliers for the entry screens — see the field's comment in types.ts. */
  unitConversions?: UnitConversion[]
}

/**
 * Check the numbers on a product.
 *
 * The form marks these inputs `min=0`, but saving is a button's onClick rather than a form
 * submit, so the browser never validates them — a negative cost saved fine and turned the
 * stock valuation negative. HTML attributes are a hint to the person typing, not a rule.
 */
function checkNumbers(input: Partial<ProductInput>): void {
  const { minStock, cost } = input
  if (minStock !== undefined) {
    if (!Number.isFinite(minStock) || minStock < 0 || minStock > QTY_MAX) {
      throw new AppError('ขั้นต่ำต้องเป็นตัวเลขไม่ติดลบ')
    }
  }
  if (cost !== undefined) {
    if (!Number.isFinite(cost) || cost < 0 || cost > QTY_MAX) {
      throw new AppError('ต้นทุนต้องเป็นตัวเลขไม่ติดลบ')
    }
  }
}

/** At most this many fallbacks; a product bought from more places than this is a category. */
const MAX_ALTERNATES = 10

/**
 * The alternates as they will be stored: trimmed, no blanks, no repeats, never the primary
 * supplier (it is not an alternative to itself), and bounded. The rules bound the list too;
 * this is the half that keeps the dialog honest about what will be saved.
 */
export function normaliseAlternates(
  raw: readonly string[] | undefined,
  primary: string | undefined,
): string[] {
  const out: string[] = []
  for (const id of raw ?? []) {
    const clean = id.trim()
    if (!clean || clean === primary || out.includes(clean)) continue
    out.push(clean)
    if (out.length >= MAX_ALTERNATES) break
  }
  return out
}

export async function createProduct(input: ProductInput): Promise<string> {
  checkNumbers(input)
  const now = Date.now()
  // Optional fields are omitted rather than written empty: the rules pin the shape with
  // hasOnly, and a blank string is still a present key.
  const { unitConversions, supplierId, alternateSupplierIds, ...rest } = input
  const conversions = unitConversions ? normaliseConversions(unitConversions) : []
  const alternates = normaliseAlternates(alternateSupplierIds, supplierId)
  return backend.add(COL.products, {
    ...rest,
    ...(conversions.length ? { unitConversions: conversions } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(alternates.length ? { alternateSupplierIds: alternates } : {}),
    hasImage: false,
    active: true,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateProduct(
  id: string,
  patch: Partial<ProductInput> & { active?: boolean },
): Promise<void> {
  checkNumbers(patch)
  // An empty cost box means "no cost recorded", which has to remove the field rather than
  // send undefined — Firestore skips undefined values, so clearing a cost of 100 used to
  // save happily and leave the 100 in place, still counted in the stock valuation.
  const { cost, unitConversions, supplierId, alternateSupplierIds, ...rest } = patch
  const write: Record<string, unknown> = { ...rest, updatedAt: Date.now() }
  if ('alternateSupplierIds' in patch) {
    const alternates = normaliseAlternates(alternateSupplierIds, supplierId)
    write.alternateSupplierIds = alternates.length ? alternates : DELETE_FIELD
  }
  if ('cost' in patch) write.cost = cost === undefined ? DELETE_FIELD : cost
  // "No supplier" has to remove the key: the validator pins the shape with hasOnly, and an
  // empty string would be a present field pointing at nothing.
  if ('supplierId' in patch) write.supplierId = supplierId ? supplierId : DELETE_FIELD
  // Clearing the last row has to remove the key too, for the same reason.
  if ('unitConversions' in patch) {
    const conversions = unitConversions ? normaliseConversions(unitConversions) : []
    write.unitConversions = conversions.length ? conversions : DELETE_FIELD
  }
  await backend.update(COL.products, id, write)
}

export async function deleteProduct(id: string): Promise<void> {
  // Remove product + image + cached balances. Movements keep denormalised names for history.
  const levels = await backend.getAll<StockLevel>(COL.stockLevels)
  await Promise.all(
    levels.filter((l) => l.productId === id).map((l) => backend.remove(COL.stockLevels, l.id)),
  )
  await backend.remove(COL.productImages, id).catch(() => {})
  await backend.remove(COL.products, id)
}

export async function setProductImage(id: string, dataUrl: string): Promise<void> {
  await backend.set(COL.productImages, id, { dataUrl })
  await backend.update(COL.products, id, { hasImage: true, updatedAt: Date.now() })
}

export async function removeProductImage(id: string): Promise<void> {
  await backend.remove(COL.productImages, id).catch(() => {})
  await backend.update(COL.products, id, { hasImage: false, updatedAt: Date.now() })
}

export async function getProductImage(id: string): Promise<string | null> {
  const img = await backend.getOne<ProductImage>(COL.productImages, id)
  return img?.dataUrl ?? null
}
