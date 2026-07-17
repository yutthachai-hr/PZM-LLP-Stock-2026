// Backend abstraction. Two implementations:
//  - firestore.ts : real cloud, real-time across devices (Firebase Spark plan, free)
//  - local.ts     : localStorage + BroadcastChannel, real-time across tabs on one device
// The app talks ONLY to this interface, so business logic never depends on which is active.

export interface TxContext {
  get<T = Record<string, unknown>>(collection: string, id: string): Promise<T | null>
  set(collection: string, id: string, data: Record<string, unknown>): void
  update(collection: string, id: string, patch: Record<string, unknown>): void
  delete(collection: string, id: string): void
}

export interface Backend {
  readonly mode: 'cloud' | 'local'
  /** Live subscription: fires immediately with current docs, then on every change. Returns unsubscribe. */
  subscribe<T>(collection: string, cb: (docs: T[]) => void): () => void
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
