/**
 * What this visit has cost in document reads, by collection.
 *
 * Firestore bills per document handed to the client, and the free plan allows 50,000 a
 * day. Three times now that limit has been reached and the app has stopped working for
 * everyone, and each time the answer to "what is reading so much?" was an estimate arrived
 * at by reading code (14 Sep, 22 Sep, 23 Sep 2026). This counts the documents as they
 * arrive, so the question has an answer that can be read off a screen instead.
 *
 * Counting is the client's own tally, not a bill: a listener resuming from the offline
 * cache delivers documents that were never charged for. It is an upper bound, and the
 * shape of it — which collection, how many per open — is what the decisions need.
 */

export interface ReadTally {
  /** Documents delivered, by collection name (already brand-resolved). */
  byCollection: Record<string, number>
  /** Documents delivered in total. */
  total: number
  /** When this tally started — the moment the page loaded. */
  since: number
}

const tally: ReadTally = { byCollection: {}, total: 0, since: Date.now() }

const listeners = new Set<() => void>()

/** Called by the cloud backend for every document it hands to the app. */
export function noteRead(collection: string, docs: number): void {
  if (docs <= 0) return
  tally.byCollection[collection] = (tally.byCollection[collection] ?? 0) + docs
  tally.total += docs
  for (const fn of listeners) fn()
}

export function readTally(): ReadTally {
  return { byCollection: { ...tally.byCollection }, total: tally.total, since: tally.since }
}

/**
 * Start counting again from zero — for measuring one thing at a time ("open the orders
 * screen and see what that alone costs") rather than everything since the page loaded.
 */
export function resetReadTally(): void {
  tally.byCollection = {}
  tally.total = 0
  tally.since = Date.now()
  for (const fn of listeners) fn()
}

export function subscribeReadTally(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
