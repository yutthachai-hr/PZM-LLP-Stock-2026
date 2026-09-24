import type { TxContext } from '../backend/types'
import { BKK_OFFSET_MS } from '../lib/inventoryRules/time'
import { COL } from '../types'

/**
 * Document numbers for the modules that came after the first five.
 *
 * Purchase requests, orders, stock documents, import batches and supplier codes each count
 * in their own `counters/<id>` document, read and bumped inside the same transaction as the
 * document it numbers — which is what makes two people pressing at once get two numbers.
 * This is that pattern, once, for announcements and transfers; the older five are left as
 * they are (they work, and renumbering is the owner's decision, not a refactor's).
 *
 * `counters` is a brand-scoped collection, so Pizza Mania and Le Lapin never share a
 * sequence: the company separation comes from the namespace, not from the counter's name.
 */

export interface TakenSeq {
  seq: number
  /** Write the counter forward. Call it in the write phase — after every tx.get. */
  commit: () => void
}

/**
 * Read the next number of a sequence inside a transaction.
 *
 * A Firestore transaction reads everything before it writes anything, so this only reads;
 * the caller commits alongside its own writes. Firestore re-runs the transaction when the
 * counter moved underneath it, so two concurrent callers never both commit the same number
 * (and the rules refuse a counter that does not go forwards).
 */
export async function takeSeq(tx: TxContext, counterId: string): Promise<TakenSeq> {
  const cur = await tx.get<{ value: number }>(COL.counters, counterId)
  const seq = (cur?.value ?? 0) + 1
  return { seq, commit: () => tx.set(COL.counters, counterId, { value: seq }) }
}

export function padSeq(seq: number, width: number): string {
  return String(seq).padStart(width, '0')
}

/** The Buddhist year of the Bangkok day `ms` falls on — 2569 for any day of 2026. */
export function buddhistYear(ms: number): number {
  return new Date(ms + BKK_OFFSET_MS).getUTCFullYear() + 543
}

/**
 * The prefix a company chose, kept to what reads safely in a document number: letters and
 * digits, upper case, at most ten. "pzm " is PZM; an empty one falls back.
 */
export function cleanPrefix(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
  return cleaned || fallback
}
