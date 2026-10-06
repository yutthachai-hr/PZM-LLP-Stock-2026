// What a transaction body sees — shared by the app's backends and the server's (ADR-001).
// Nothing here may import browser-only code: functions/_lib/serverTx.ts builds on it.

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
