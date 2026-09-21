import type { StockMovement } from '../types'

/**
 * Rows this device has just written, shown before the listener confirms them.
 *
 * The stock engine files every movement inside a transaction, and Firestore does not
 * echo a transaction into the local cache the way it does a plain write: the row appears
 * only when the server's snapshot comes back — a second on a good day, noticeably longer
 * on a shared tablet with several tabs open, where only one tab holds the connection and
 * the others learn of it through IndexedDB. The person keying a delivery note saw their
 * line vanish and come back "a while later" (owner, 21 Sep 2026) and could not tell
 * whether it had been saved right.
 *
 * So each write is noted here the moment its transaction commits, and the data context
 * lays these rows over the live list until the live list carries them itself. Nothing is
 * read; nothing is stored; a row is dropped as soon as the listener has it or after a few
 * minutes, whichever comes first.
 */

const TTL_MS = 5 * 60_000

type Listener = (rows: StockMovement[]) => void

let rows: (StockMovement & { notedAt: number })[] = []
const listeners = new Set<Listener>()

function emit() {
  const now = Date.now()
  rows = rows.filter((r) => now - r.notedAt < TTL_MS)
  const snapshot = rows.map(({ notedAt: _n, ...r }) => r as StockMovement)
  for (const l of listeners) l(snapshot)
}

/** Note rows that were just committed (created or changed). Later notes of an id win. */
export function noteWritten(written: readonly StockMovement[]): void {
  if (written.length === 0) return
  const now = Date.now()
  const ids = new Set(written.map((w) => w.id))
  rows = [...rows.filter((r) => !ids.has(r.id)), ...written.map((w) => ({ ...w, notedAt: now }))]
  emit()
}

export function subscribeRecentWrites(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/**
 * The live list with the noted rows laid over it. A noted row replaces the live one
 * while the live one is older (the listener has not caught up), and is dropped once the
 * live one is as new — so a note never masks a later change from another device.
 */
export function overlayRecent(live: readonly StockMovement[], recent: readonly StockMovement[]): StockMovement[] {
  if (recent.length === 0) return live as StockMovement[]
  const byId = new Map(live.map((m) => [m.id, m]))
  let changed = false
  const extra: StockMovement[] = []
  for (const r of recent) {
    const cur = byId.get(r.id)
    if (!cur) {
      extra.push(r)
      changed = true
    } else if ((cur.updatedAt ?? cur.createdAt) < (r.updatedAt ?? r.createdAt)) {
      byId.set(r.id, r)
      changed = true
    }
  }
  if (!changed) return live as StockMovement[]
  return [...byId.values(), ...extra]
}

/** For tests. */
export function resetRecentWrites(): void {
  rows = []
}
