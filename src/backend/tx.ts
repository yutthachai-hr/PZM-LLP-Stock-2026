// Transaction-only contract. Safe in Pages/Worker code without importing browser backend
// configuration, brand localStorage or React types.
export interface TxContext {
  get<T = Record<string, unknown>>(collection: string, id: string): Promise<T | null>
  /** Optional REST batching; subsequent get calls retain the same read preconditions. */
  prefetch?(documents: readonly { collection: string; id: string }[]): Promise<void>
  set(collection: string, id: string, data: Record<string, unknown>): void
  update(collection: string, id: string, patch: Record<string, unknown>): void
  delete(collection: string, id: string): void
}
export interface Transactional {
  transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R>
}
