/**
 * What the jobs need from the database, and nothing more. The live implementation is
 * Firestore over REST (firestore.ts); the tests use an in-memory one. Batches, because a
 * free-plan Worker invocation may make at most 50 outgoing requests — one query is one
 * request however many documents it returns, and one batch write carries up to 500 writes.
 */

export type Op = '==' | '>=' | '<=' | '<' | '>' | 'in'

export interface Filter {
  field: string
  op: Op
  value: unknown
}

export type WriteOp =
  /** Only if no document has that id — the dedup: a second writer is simply refused. */
  | { type: 'create'; collection: string; id: string; doc: Record<string, unknown> }
  /** Replace the whole document. */
  | { type: 'set'; collection: string; id: string; doc: Record<string, unknown> }
  /** Change these fields of a document that exists. */
  | { type: 'patch'; collection: string; id: string; fields: Record<string, unknown> }
  | { type: 'delete'; collection: string; id: string }

export interface Store {
  query<T>(collection: string, filters?: Filter[], opts?: { limit?: number; orderBy?: string }): Promise<T[]>
  get<T>(collection: string, id: string): Promise<T | null>
  /** Each op's outcome, in order: true written, false refused (precondition). */
  write(ops: WriteOp[]): Promise<boolean[]>
}

/** The allow-list the tests pin: the Worker writes these collections and no others. */
export const WRITABLE = ['stockEvents', 'notifications', 'meta'] as const

export function assertWritable(collection: string): void {
  const base = collection.includes('__') ? collection.split('__')[1] : collection
  if (!(WRITABLE as readonly string[]).includes(base)) throw new Error(`worker may not write ${collection}`)
}
