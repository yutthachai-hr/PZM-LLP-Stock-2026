import { backend } from '../backend'
import { DELETE_FIELD } from '../backend/types'
import { AppError } from '../i18n/AppError'
import { COL, type ProductImage, type StockLevel } from '../types'
import { QTY_MAX } from '../lib/validate'

export interface ProductInput {
  sku: string
  name: string
  category: string
  unit: string
  unitType: string
  minStock: number
  cost?: number
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

export async function createProduct(input: ProductInput): Promise<string> {
  checkNumbers(input)
  const now = Date.now()
  return backend.add(COL.products, {
    ...input,
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
  const { cost, ...rest } = patch
  const write: Record<string, unknown> = { ...rest, updatedAt: Date.now() }
  if ('cost' in patch) write.cost = cost === undefined ? DELETE_FIELD : cost
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
