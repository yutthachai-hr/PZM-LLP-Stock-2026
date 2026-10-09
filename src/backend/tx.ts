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

/**
 * Marker for "add `by` to this number", applied atomically by Firestore (`increment`) and in
 * place by the local backends. Used for entity versions (G25), where a read-modify-write would
 * itself be a race.
 */
export class Increment {
  readonly by: number
  constructor(by: number) {
    this.by = by
  }
}
export const increment = (by = 1) => new Increment(by)

/**
 * G25 — entities with an optimistic-concurrency `version` (owner, 7 Oct 2026). Every write
 * moves it: an update by exactly one (the backends add it, so no writer can forget), a
 * create starts at 1. A writer that edited from a copy it loaded states the version it saw
 * (`expectedVersion`) and its transaction refuses the write when the document has moved on —
 * so a stale tab, or an AI proposal computed from old data, cannot overwrite a newer change.
 * The rules require the +1 on every non-admin update.
 */
export const VERSIONED: ReadonlySet<string> = new Set(['products', 'purchaseOrders'])

const baseCollection = (c: string) => (c.includes('__') ? c.split('__')[1] : c)

/** An update patch with its version bump, for a versioned collection. A patch that states a version keeps it. */
export function withVersionBump(collection: string, patch: Record<string, unknown>): Record<string, unknown> {
  return VERSIONED.has(baseCollection(collection)) && !('version' in patch) ? { ...patch, version: increment(1) } : patch
}

/** A whole document as written by set/add: a versioned one without a version starts at 1. */
export function withInitialVersion(collection: string, data: Record<string, unknown>): Record<string, unknown> {
  return VERSIONED.has(baseCollection(collection)) && !('version' in data) ? { ...data, version: 1 } : data
}

/** What a field holds after an increment, the way Firestore defines it: missing or not a number counts as 0. */
export function applyIncrement(current: unknown, inc: Increment): number {
  return (typeof current === 'number' && Number.isFinite(current) ? current : 0) + inc.by
}

export interface TxContext {
  get<T = Record<string, unknown>>(collection: string, id: string): Promise<T | null>
  set(collection: string, id: string, data: Record<string, unknown>): void
  update(collection: string, id: string, patch: Record<string, unknown>): void
  delete(collection: string, id: string): void
}
