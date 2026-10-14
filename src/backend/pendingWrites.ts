import type { Backend } from './types'

/**
 * How many database writes this tab has started and not yet seen finish.
 *
 * The brand switcher asks before it changes brand (owner, 9 Oct 2026): a write that is still
 * on its way when the brand changes must not have the rest of its work — a retry, a follow-up
 * write, a cache update — resolved against the other brand. Counting at the backend covers
 * every screen without each one having to remember to say it is busy.
 *
 * Only counts; never changes what a write does or when it runs.
 */
let inFlight = 0
const listeners = new Set<() => void>()

function announce(): void {
  for (const fn of listeners) fn()
}

export function trackWrite<T>(work: Promise<T>): Promise<T> {
  inFlight++
  announce()
  return work.finally(() => {
    inFlight--
    announce()
  })
}

export function pendingWriteCount(): number {
  return inFlight
}

export function onPendingWrites(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Resolves true once nothing is in flight, or false if that has not happened by `timeoutMs`. */
export function whenWritesSettle(timeoutMs: number): Promise<boolean> {
  if (inFlight === 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off()
      resolve(inFlight === 0)
    }, timeoutMs)
    const off = onPendingWrites(() => {
      if (inFlight !== 0) return
      clearTimeout(timer)
      off()
      resolve(true)
    })
  })
}

/** The same backend, with its writes counted (including any copy pinned with forBrand). */
export function withWriteTracking(b: Backend): Backend {
  return {
    ...b,
    mode: b.mode,
    forBrand: (brand) => withWriteTracking(b.forBrand(brand)),
    add: (collection, data) => trackWrite(b.add(collection, data)),
    set: (collection, id, data) => trackWrite(b.set(collection, id, data)),
    update: (collection, id, patch) => trackWrite(b.update(collection, id, patch)),
    remove: (collection, id) => trackWrite(b.remove(collection, id)),
    transaction: (fn) => trackWrite(b.transaction(fn)),
  }
}
