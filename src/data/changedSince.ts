import { backend } from '../backend'

/** Rows of a collection changed at or after `since` — the range caches' cheap refresh. */
export function changedSince<T>(collection: string, label: string) {
  return (since: number): Promise<T[]> => backend.getRange<T>(collection, 'updatedAt', since, Number.MAX_SAFE_INTEGER, { label })
}
