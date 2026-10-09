/**
 * G25 — data freshness and optimistic concurrency (owner, 7 Oct 2026).
 *
 * Products and purchase orders carry a `version` that every write moves by one (the backends
 * add it; src/backend/tx.ts). An edit made from a copy the screen loaded states the version it
 * saw; inside the write's transaction `assertVersion` refuses it when the document has moved
 * on, and the rules refuse a non-admin update whose version is not the next one. A stale tab,
 * or an AI proposal computed from old data, therefore cannot overwrite a newer human or
 * system change.
 *
 * Pure: no imports from the backend or the app.
 */
import { AppError } from '../i18n/AppError'

/** The words of the refusal. */
export const STALE_WRITE = 'มีคนแก้ข้อมูลนี้ไปแล้วหลังจากที่คุณเปิดดู — โหลดใหม่แล้วตรวจอีกครั้ง' // i18n-key

/** The version as stored: a document never written since versions began counts as 0. */
export function versionOf(doc: { version?: unknown } | null | undefined): number {
  return typeof doc?.version === 'number' && Number.isFinite(doc.version) ? doc.version : 0
}

/** Throws STALE_WRITE when `expected` is given and the document is no longer at it. */
export function assertVersion(current: { version?: unknown } | null | undefined, expected: number | undefined): void {
  if (expected === undefined || !current) return
  if (versionOf(current) !== expected) throw new AppError(STALE_WRITE)
}

/**
 * How old the inputs of a decision that writes may be (G25): a proposal or recommendation
 * acted on later than this is recomputed first. The Business Guard's softer tolerance for
 * *proposals* is `DEFAULT_LIMITS.staleAfterMs` (src/agent/snapshot.ts); this one is for the
 * moment of execution (Phase H6), where a stale input must be refused, not reviewed.
 */
export const EXECUTION_MAX_AGE_MS = 5 * 60_000

export function isFresh(inputsAsOf: number, now: number, maxAgeMs = EXECUTION_MAX_AGE_MS): boolean {
  return Number.isFinite(inputsAsOf) && inputsAsOf <= now && now - inputsAsOf <= maxAgeMs
}

// ---------------------------------------------------------------- contract versions ----

/**
 * The versioned contracts (G25 schema versioning). A consumer checks the version it reads
 * against this table and fails safe — refuses, or leaves the record for a newer consumer —
 * on anything it does not know. Bump a version only together with the consumers.
 */
export const CONTRACTS = {
  ActionProposal: { field: 'schemaVersion', accepts: ['action-proposal/1'] },
  SafetyDecision: { field: 'schema', accepts: ['safety-decision/1'] },
  OutboxEvent: { field: 'schemaVersion', accepts: [1] },
  PredictionSnapshot: { field: 'schemaVersion', accepts: [1] },
  AuditEvent: { field: 'schemaVersion', accepts: [1] },
  IntegritySnapshot: { field: 'schema', accepts: ['pzm-integrity/1'] },
  LayaDecision: { field: 'schema', accepts: ['laya-decision/1'] },
} as const satisfies Record<string, { field: string; accepts: readonly (string | number)[] }>

export type Contract = keyof typeof CONTRACTS

/**
 * Whether a record is a version this code understands. A record with no version field at all
 * is accepted only where the contract says so (`legacy`): AuditEvent and PredictionSnapshot
 * rows written before versioning began.
 */
export function supported(contract: Contract, record: unknown, opts: { legacy?: boolean } = {}): boolean {
  if (!record || typeof record !== 'object') return false
  const c = CONTRACTS[contract]
  const v = (record as Record<string, unknown>)[c.field]
  if (v === undefined) return !!opts.legacy
  return (c.accepts as readonly unknown[]).includes(v)
}
