// Backend abstraction. Two implementations:
//  - firestore.ts : real cloud, real-time across devices (Firebase Spark plan, free)
//  - local.ts     : localStorage + BroadcastChannel, real-time across tabs on one device
// The app talks ONLY to this interface, so business logic never depends on which is active.

import type { BrandId } from '../brand/brand'

/**
 * Marker for "remove this field", usable as a value in an update patch.
 *
 * Passing `undefined` does not do it: Firestore is initialised with
 * ignoreUndefinedProperties, so an undefined value is skipped and the old one survives —
 * clearing a product's cost saved successfully and left the cost exactly as it was. The
 * local backend, meanwhile, stored a literal undefined. One explicit marker, handled by
 * both, is the only way the two modes can agree on what clearing means.
 */
export const DELETE_FIELD = Symbol('delete-field')

export interface TxContext {
  get<T = Record<string, unknown>>(collection: string, id: string): Promise<T | null>
  set(collection: string, id: string, data: Record<string, unknown>): void
  update(collection: string, id: string, patch: Record<string, unknown>): void
  delete(collection: string, id: string): void
}

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
  /** Live subscription: fires immediately with current docs, then on every change. Returns unsubscribe. */
  subscribe<T>(collection: string, cb: (docs: T[]) => void, opts?: SubscribeOptions): () => void
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
