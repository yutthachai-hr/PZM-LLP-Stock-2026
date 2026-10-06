import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { getFirebaseConfig } from '../firebase/config'
import type { RangePersist } from './rangeCache'

/**
 * A session range cache kept on the device too (release hardening: Firestore reads): the
 * key is per project and brand, and only in cloud mode — the demo backend costs nothing to
 * read. `updatedAt` is the field every write of these documents sets.
 */
export function persistRanges<T extends { updatedAt?: number }>(name: string, collection: string): RangePersist<T> {
  return {
    key: () => (backend.mode === 'cloud' ? `${getFirebaseConfig()?.projectId ?? 'none'}:${getBrand()}:range:${name}` : null),
    updatedAtOf: (row) => row.updatedAt ?? 0,
    fetchChanged: (since) => backend.forBrand(getBrand()).getRange<T>(collection, 'updatedAt', since, Number.MAX_SAFE_INTEGER),
  }
}
