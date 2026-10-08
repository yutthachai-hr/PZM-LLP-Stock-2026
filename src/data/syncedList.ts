import { backend } from '../backend'
import { getBrand, resolveCollection } from '../brand/brand'
import { FULL_EVERY_MS, readCopy, SKEW_MS, writeCopy } from './deviceStore'
import { mergeDelta, newestStamp } from './syncedCollection'

/**
 * A small collection read once (no listener), kept on the device between sessions and
 * refreshed by what changed (perf/firestore-read-budget, 6 Oct 2026). The supplier list was
 * read whole on every open and again on the Suppliers screen — 86 documents, twice.
 *
 * Every write to it sets `updatedAt`; a day-old copy is read whole again, which also drops
 * documents deleted meanwhile.
 */

interface Copy<T> {
  v: 1
  fullAt: number
  docs: T[]
}

const inflight = new Map<string, Promise<unknown>>()

export function loadSyncedList<T extends { id: string; updatedAt?: number }>(collection: string, label: string): Promise<T[]> {
  const brand = getBrand()
  const key = `list:${resolveCollection(collection, brand)}`
  const running = inflight.get(key) as Promise<T[]> | undefined
  if (running) return running
  const db = backend.forBrand(brand)
  const job = (async () => {
    const copy = backend.mode === 'cloud' ? await readCopy<Copy<T>>(key) : null
    if (copy && copy.v === 1 && Date.now() - copy.fullAt < FULL_EVERY_MS) {
      const held = new Map(copy.docs.map((d) => [d.id, d]))
      const since = Math.max(0, newestStamp(held.values()) - SKEW_MS)
      const changed = await db.getRange<T>(collection, 'updatedAt', since, Number.MAX_SAFE_INTEGER, { label: `${label}.delta` })
      mergeDelta(held, new Set(), changed)
      const docs = [...held.values()]
      void writeCopy<Copy<T>>(key, { v: 1, fullAt: copy.fullAt, docs })
      return docs
    }
    const docs = await db.getAll<T>(collection, { label: `${label}.full` })
    if (backend.mode === 'cloud') void writeCopy<Copy<T>>(key, { v: 1, fullAt: Date.now(), docs })
    return docs
  })()
  inflight.set(key, job)
  return job.finally(() => inflight.delete(key))
}
