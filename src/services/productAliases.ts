import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import { normaliseName, type ProductAlias } from '../lib/productMatch'
import { COL } from '../types'

/**
 * Workbook spellings a person has already matched to a product.
 *
 * Read once when an order workbook is imported — a few dozen documents — and never
 * subscribed. Written by whoever resolves a row on the review screen, which is everyday
 * work and so is staff-writable in the rules; the product itself is not, which is why these
 * are not a field on the product.
 *
 * Keyed by the normalised spelling, so confirming the same spelling twice overwrites rather
 * than accumulates, and a later confirmation wins — the way a person would expect.
 */

function scoped() {
  return backend.forBrand(getBrand())
}

/** A document id that is the same for the same spelling and safe for a document path. */
export function aliasId(key: string): string {
  // FNV-1a, 32-bit, twice with different seeds: not cryptographic, just stable and short.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0
  }
  return `alias-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export async function listAliases(): Promise<ProductAlias[]> {
  return scoped().getAll<ProductAlias>(COL.productAliases)
}

export async function saveAlias(params: {
  sourceName: string
  productId: string
  actor: { id: string; name: string }
}): Promise<ProductAlias> {
  const sourceName = params.sourceName.trim().slice(0, 300)
  const key = normaliseName(sourceName)
  if (!key) throw new AppError('ไม่มีชื่อให้จับคู่')
  if (!params.productId) throw new AppError('กรุณาเลือกสินค้า')
  const alias: ProductAlias = {
    id: aliasId(key),
    key,
    productId: params.productId,
    sourceName,
    createdBy: params.actor.id,
    createdByName: params.actor.name,
    createdAt: Date.now(),
  }
  const { id, ...data } = alias
  await scoped().set(COL.productAliases, id, data)
  return alias
}

export async function removeAlias(id: string): Promise<void> {
  await scoped().remove(COL.productAliases, id)
}
