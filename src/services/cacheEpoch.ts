import { backend } from '../backend'
import { getBrand, type BrandId } from '../brand/brand'
import { COL } from '../types'

/**
 * The device caches' epoch, per brand (release hardening: Firestore reads; data/cachedLive).
 *
 * A device keeps the products, balances, ledger window and notifications it has seen and
 * asks only for what changed. A change listener cannot see a document deleted, or an old
 * row rewritten without a newer timestamp — so every action that does either bumps the
 * collection's number here, and every device reads its set in full again. Admin actions
 * only (voids, edits, unit changes, restores, deletes); one small document per brand.
 */
export const cacheEpochId = (brand: BrandId = getBrand()) => `cacheEpoch_${brand}`

export type CachedCollection = 'products' | 'stockLevels' | 'stockMovements' | 'notifications' | 'productMinOverrides'

/** Best-effort: a failed bump leaves devices on their cache until it is a week old. */
export async function bumpCacheEpoch(collections: readonly CachedCollection[], brand: BrandId = getBrand()): Promise<void> {
  try {
    const id = cacheEpochId(brand)
    const now = Date.now()
    await backend.forBrand(brand).transaction(async (tx) => {
      const cur = (await tx.get<Record<string, number>>(COL.meta, id)) ?? {}
      const next: Record<string, number> = {}
      for (const [k, v] of Object.entries(cur)) if (k !== 'id' && typeof v === 'number') next[k] = v
      for (const c of collections) next[c] = Math.max(now, (next[c] ?? 0) + 1)
      tx.set(COL.meta, id, next)
    })
  } catch (e) {
    console.error('[cache] could not bump the cache epoch', e)
  }
}
