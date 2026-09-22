import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { DELETE_FIELD } from '../backend/types'
import { AppError } from '../i18n/AppError'
import { COL, type Product, type ProductImage, type StockLevel } from '../types'
import { QTY_MAX } from '../lib/validate'
import { normaliseConversions, sameUnit, type UnitConversion } from '../lib/units'

export interface ProductInput {
  /** Who we buy it from. Empty means nobody has said yet. */
  supplierId?: string
  /** Other suppliers it can come from. See the field on Product. */
  alternateSupplierIds?: string[]
  sku: string
  name: string
  /** The number on the box. Empty clears it; it has to be unique within the brand. */
  barcode?: string
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

/**
 * Refuse a barcode another product already carries.
 *
 * Checked here rather than in the rules, which cannot query a collection. One equality
 * read per save, and only when a barcode was actually typed or scanned.
 */
export async function checkBarcodeFree(barcode: string, exceptProductId?: string): Promise<void> {
  const code = barcode.trim()
  if (!code) return
  const db = backend.forBrand(getBrand())
  const clash = (await db.getBy<Product>(COL.products, 'barcode', code)).find((p) => p.id !== exceptProductId)
  if (clash) {
    throw new AppError('บาร์โค้ดนี้ใช้กับ "{name}" อยู่แล้ว', { name: clash.name })
  }
}

export async function createProduct(input: ProductInput): Promise<string> {
  checkNumbers(input)
  const barcode = input.barcode?.trim() ?? ''
  await checkBarcodeFree(barcode)
  const now = Date.now()
  // Optional fields are omitted rather than written empty: the rules pin the shape with
  // hasOnly, and a blank string is still a present key.
  const { unitConversions, supplierId, alternateSupplierIds, barcode: _typed, ...rest } = input
  void _typed
  const conversions = unitConversions ? normaliseConversions(unitConversions, input.unitType) : []
  const alternates = normaliseAlternates(alternateSupplierIds, supplierId)
  return backend.add(COL.products, {
    ...rest,
    ...(barcode ? { barcode } : {}),
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
  const { cost, unitConversions, supplierId, alternateSupplierIds, barcode, ...rest } = patch
  const write: Record<string, unknown> = { ...rest, updatedAt: Date.now() }
  // The number on the box: cleared it is an absent key, and a new one has to be free.
  if ('barcode' in patch) {
    const code = barcode?.trim() ?? ''
    if (code) await checkBarcodeFree(code, id)
    write.barcode = code ? code : DELETE_FIELD
  }
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
    const conversions = unitConversions ? normaliseConversions(unitConversions, patch.unitType) : []
    write.unitConversions = conversions.length ? conversions : DELETE_FIELD
  }
  await backend.update(COL.products, id, write)
}

/**
 * State the rate for one unit of this product — "1 Carton = 500 EA" — the first time
 * somebody keys that unit (owner, 20 Sep 2026). Anyone active may do this; the rules let
 * staff touch nothing else on a product. Replaces an existing rate for the same label,
 * so the product page can correct one through the same call.
 */
export async function addConversion(
  product: Pick<Product, 'id' | 'unitType' | 'unitConversions'>,
  label: string,
  size: number,
  /** "`per` label = `size` of `of`" — `of` another of the product's units, or its own when absent. */
  opts: { per?: number; of?: string } = {},
): Promise<UnitConversion[]> {
  const clean = label.trim()
  if (!clean) throw new AppError('กรุณาระบุหน่วย')
  if (sameUnit(clean, product.unitType)) throw new AppError('หน่วยนี้คือหน่วยหลักของสินค้าอยู่แล้ว')
  if (!Number.isFinite(size) || size <= 0) throw new AppError('อัตราแปลงต้องเป็นตัวเลขมากกว่า 0')
  if (opts.per !== undefined && !(Number.isFinite(opts.per) && opts.per > 0)) throw new AppError('อัตราแปลงต้องเป็นตัวเลขมากกว่า 0')
  const kept = (product.unitConversions ?? []).filter((c) => !sameUnit(c.label, clean))
  const row: UnitConversion = { label: clean, size, ...(opts.per !== undefined ? { per: opts.per } : {}), ...(opts.of ? { of: opts.of } : {}) }
  const next = normaliseConversions([...kept, row], product.unitType)
  if (!next.some((c) => sameUnit(c.label, clean))) throw new AppError('อัตรานี้อ้างอิงหน่วยที่ยังไม่มีอัตรา — กำหนดหน่วยนั้นก่อน')
  await backend.update(COL.products, product.id, { unitConversions: next, updatedAt: Date.now() })
  return next
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
