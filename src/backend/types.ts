// Backend abstraction. Two implementations:
//  - firestore.ts : real cloud, real-time across devices (Firebase Spark plan, free)
//  - local.ts     : localStorage + BroadcastChannel, real-time across tabs on one device
// The app talks ONLY to this interface, so business logic never depends on which is active.

import type { BrandId } from '../brand/brand'

// The transaction surface lives on its own so code that runs on the server too (the stock
// commands, ADR-001) can use it without pulling in anything browser-only.
import type { TxContext } from './tx'
export { DELETE_FIELD, type TxContext } from './tx'

/**
 * Restricts a subscription to documents whose numeric `field` is at or after `value`.
 *
 * The ledger grows forever, and a subscription without this re-reads every movement each
 * time the app cold-starts on a device — which is charged per document and would eventually
 * exhaust a day's whole read quota in one load.
 */
export interface SinceFilter {
  field: string
  value: number
}

export interface SubscribeOptions {
  since?: SinceFilter
}

export interface Backend {
  readonly mode: 'cloud' | 'local'
  /**
   * The same backend, permanently pointed at one brand.
   *
   * Anything that takes more than a single call — a transaction, a backup, a multi-step
   * service — should take this once at the start and use it throughout, so that switching
   * brand halfway through cannot split the work across two namespaces.
   */
  forBrand(brand: BrandId): Backend
  /**
   * Live subscription: fires immediately with current docs, then on every change. Returns
   * unsubscribe. `onError` hears a listener the database ended (refused by the rules, quota
   * spent) — after that it delivers nothing more, and the caller must subscribe again.
   */
  subscribe<T>(collection: string, cb: (docs: T[]) => void, opts?: SubscribeOptions, onError?: (e: unknown) => void): () => void
  /**
   * Live subscription to ONE document, reporting null while it does not exist.
   *
   * Needed for a document the reader is allowed to `get` but not to `list` — a staff member
   * watching their own profile, which is how a revoked account finds out it was revoked
   * instead of carrying on with whatever it had already loaded.
   */
  subscribeOne<T>(
    collection: string,
    id: string,
    cb: (doc: T | null) => void,
    onError?: (e: unknown) => void,
  ): () => void
  getAll<T>(collection: string): Promise<T[]>
  /**
   * Read a bounded slice of a collection, once, with no subscription.
   *
   * `subscribe` can bound a read with SinceFilter, but only from below and only by
   * staying live. The calendar needs neither: it wants one month at a time, and it wants
   * to stop costing anything the moment the screen is closed. Without this the only way
   * to show a month is getAll() — the whole collection, growing forever, on every visit.
   *
   * Two bounds on ONE field, which Firestore's automatic index already serves, so this
   * adds no composite index to deploy.
   */
  getRange<T>(collection: string, field: string, from: number, to: number): Promise<T[]>
  /**
   * Every document whose `field` equals `value`, once, with no subscription.
   *
   * One equality filter, which Firestore's automatic index already serves, so this adds no
   * composite index to deploy. It exists so a rare admin job — relabelling one product's
   * ledger — can read that product's rows instead of the whole ledger, which on a busy month
   * is thousands of documents against a 50,000-a-day allowance shared by both companies.
   */
  getBy<T>(collection: string, field: string, value: string | number | boolean): Promise<T[]>
  /**
   * One page of a collection, newest first by a number field, below `before` when given.
   * For history that is only ever browsed a page at a time (the audit log): never a
   * listener, never the whole collection. One field, so no composite index.
   */
  page<T>(collection: string, field: string, opts: { limit: number; before?: number }): Promise<T[]>
  getOne<T>(collection: string, id: string): Promise<T | null>
  /** Auto-generate id. Returns the new id (also written into the doc's `id` field). */
  add(collection: string, data: Record<string, unknown>): Promise<string>
  /** Create or replace a doc with an explicit id. */
  set(collection: string, id: string, data: Record<string, unknown>): Promise<void>
  update(collection: string, id: string, patch: Record<string, unknown>): Promise<void>
  remove(collection: string, id: string): Promise<void>
  /** Atomic multi-doc operation. Reads first, then writes (Firestore-compatible ordering). */
  transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R>
}
