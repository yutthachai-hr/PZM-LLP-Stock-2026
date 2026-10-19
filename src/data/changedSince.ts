import { backend } from '../backend'
import { getBrand, type BrandId } from '../brand/brand'

/** Rows of a collection changed at or after `since` — the range caches' cheap refresh. */
export function changedSince<T extends { id: string }>(collection: string, label: string, fields = ['updatedAt']) {
  return async (since: number, brand: BrandId = getBrand()): Promise<T[]> => {
    const db = backend.forBrand(brand)
    const parts = await Promise.all(fields.map(field => db.getRange<T>(collection, field, since, Number.MAX_SAFE_INTEGER, { label: fields.length > 1 ? `${label}.${field}` : label, server: true })))
    return [...new Map(parts.flat().map(row => [row.id, row])).values()]
  }
}
