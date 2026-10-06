/**
 * What this visit has cost in document reads — by label, by kind of read, by collection.
 *
 * Firestore bills per document handed to the client, and the free plan allows 50,000 a
 * day. The limit has been reached four times (14, 22, 23 Sep; 6 Oct 2026 at ~203k), and
 * each time "what is reading so much?" was answered by estimating from code. This counts
 * every read primitive as it happens so the answer can be read off a screen (Settings ›
 * การอ่านข้อมูล) or from `window.__pzmReads` in a test.
 *
 * Two numbers per row:
 *   - `docs`: documents the app received;
 *   - `billed`: an estimate of what Firestore charges for them. A snapshot served from the
 *     device's own cache costs nothing; a query that finds nothing still costs one read; a
 *     listener that comes back after more than 30 minutes away is charged its whole result
 *     again even though the SDK only reports what changed (`noteResume`).
 *
 * No document contents are recorded — only labels, collection names and counts.
 */

export type ReadKind =
  /** First server answer of a realtime listener: its whole result. */
  | 'listen.bootstrap'
  /** Later changes a listener delivers. */
  | 'listen.update'
  /** A listener back after >30 min away: billed as a fresh query. */
  | 'listen.resume'
  /** One-shot reads. */
  | 'range'
  | 'all'
  | 'by'
  | 'one'
  | 'page'
  /** Reads inside a transaction (billed like any read). */
  | 'tx'

export interface ReadStat {
  label: string
  collection: string
  kind: ReadKind
  /** Queries or listener deliveries. */
  queries: number
  docs: number
  billed: number
}

export interface ReadTally {
  /** Billed reads by collection name (already brand-resolved). Kept for older screens. */
  byCollection: Record<string, number>
  /** One row per label × kind. */
  stats: ReadStat[]
  /** Estimated billed reads in total. */
  total: number
  /** Documents received in total, billed or not. */
  docs: number
  listeners: { active: number; bootstraps: number; updates: number; resumes: number }
  /** When this tally started — the page load, or the last reset. */
  since: number
}

interface State {
  stats: Map<string, ReadStat>
  byCollection: Record<string, number>
  total: number
  docs: number
  active: number
  bootstraps: number
  updates: number
  resumes: number
  since: number
}

const fresh = (): State => ({
  stats: new Map(),
  byCollection: {},
  total: 0,
  docs: 0,
  active: 0,
  bootstraps: 0,
  updates: 0,
  resumes: 0,
  since: Date.now(),
})

let state = fresh()
const listeners = new Set<() => void>()

function changed(): void {
  for (const fn of listeners) fn()
}

/**
 * Firestore's charge for one read of this kind: a changed document per document; a single
 * document read (alone or in a transaction) one, found or not; any query at least one,
 * even when it finds nothing.
 */
export function estimateBilled(kind: ReadKind, docs: number): number {
  if (kind === 'listen.update') return docs
  if (kind === 'one' || kind === 'tx') return 1
  return Math.max(1, docs)
}

/**
 * Record one read.
 *
 * `docs` is what arrived; `fromCache` marks a delivery the device served itself (not billed);
 * `billed` overrides the estimate when the caller knows better (a resumed listener).
 */
export function noteReadOp(op: {
  label: string
  collection: string
  kind: ReadKind
  docs: number
  fromCache?: boolean
  billed?: number
}): void {
  const billed = op.fromCache ? 0 : (op.billed ?? estimateBilled(op.kind, op.docs))
  const key = `${op.label}|${op.kind}`
  const row = state.stats.get(key) ?? { label: op.label, collection: op.collection, kind: op.kind, queries: 0, docs: 0, billed: 0 }
  row.queries += 1
  row.docs += op.docs
  row.billed += billed
  state.stats.set(key, row)
  if (billed > 0) state.byCollection[op.collection] = (state.byCollection[op.collection] ?? 0) + billed
  state.total += billed
  state.docs += op.docs
  if (op.kind === 'listen.bootstrap') state.bootstraps += 1
  if (op.kind === 'listen.update') state.updates += 1
  if (op.kind === 'listen.resume') state.resumes += 1
  changed()
}

/** Older call shape: `docs` billed reads from a collection, labelled by the collection. */
export function noteRead(collection: string, docs: number): void {
  if (docs <= 0) return
  noteReadOp({ label: collection, collection, kind: 'all', docs })
}

/** A realtime listener opened (+1) or closed (−1) — runaway subscriptions show here. */
export function noteListener(delta: 1 | -1): void {
  state.active += delta
  changed()
}

export function readTally(): ReadTally {
  return {
    byCollection: { ...state.byCollection },
    stats: [...state.stats.values()].map((s) => ({ ...s })).sort((a, b) => b.billed - a.billed),
    total: state.total,
    docs: state.docs,
    listeners: { active: state.active, bootstraps: state.bootstraps, updates: state.updates, resumes: state.resumes },
    since: state.since,
  }
}

/**
 * Start counting again from zero — for measuring one thing at a time ("open the orders
 * screen and see what that alone costs"). Listeners still open stay counted as open.
 */
export function resetReadTally(): void {
  const active = state.active
  state = fresh()
  state.active = active
  changed()
}

export function subscribeReadTally(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ---------------------------------------------------------------- away detection ----

/**
 * Firestore keeps a listener's resume token for 30 minutes. A tab hidden longer than that
 * — a phone in a pocket, the PWA in the background — is charged its listeners' whole
 * results again when it comes back, while the SDK reports only what changed. This tracks
 * how long the page was away so the listener can count that charge honestly.
 */
export const RESUME_TOKEN_MS = 30 * 60_000

let hiddenAt: number | null = null
let resumeEpoch = 0
const returnListeners = new Set<() => void>()

let returning = false

function longAbsenceEnded(): void {
  resumeEpoch += 1
  returning = true
  try {
    for (const fn of returnListeners) fn()
  } finally {
    returning = false
  }
}

/**
 * True while listeners are being restarted after a long absence: a listener closed now has
 * NOT been in touch with the server lately, so its close must not count as contact.
 */
export function isReturningFromAbsence(): boolean {
  return returning
}

/**
 * Called when the page comes back from more than 30 minutes away — before Firestore resumes
 * its listeners. A "changed since" listener re-created here with a fresh cursor is charged
 * what changed while away; left alone it is charged everything it matched since it opened.
 */
export function onReturnFromLongAbsence(fn: () => void): () => void {
  returnListeners.add(fn)
  return () => returnListeners.delete(fn)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else if (hiddenAt !== null) {
      if (Date.now() - hiddenAt > RESUME_TOKEN_MS) longAbsenceEnded()
      hiddenAt = null
    }
  })
}

/** Bumps each time the page returns from an absence long enough to cost a full re-read. */
export function currentResumeEpoch(): number {
  return resumeEpoch
}

/** For tests: pretend the page just came back from a long absence. */
export function markLongAbsence(): void {
  longAbsenceEnded()
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { __pzmReads?: unknown }).__pzmReads = { tally: readTally, reset: resetReadTally, markLongAbsence }
}
