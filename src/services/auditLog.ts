import { backend } from '../backend'
import { DELETE_FIELD, type TxContext } from '../backend/types'
import { COL, type AppUser, type AuditEntityType, type AuditEntry, type Role } from '../types'

import { assertVersion } from '../lib/concurrency'

/**
 * B2 — the audit log (owner approved, 6 Oct 2026): one append-only record of every change
 * to the things that shape the stock rather than move it — products, locations, suppliers,
 * unit conversions, users and roles, settings and thresholds, maintenance, archive and
 * deactivation, and sensitive corrections.
 *
 * Append-only by the rules: anyone active may add an entry in their own name, nobody may
 * change or delete one, and only an admin may read them — page by page (at most 50), never
 * with a live listener (firestore.rules `auditLog`).
 *
 * A single-document change is written in the SAME transaction as its entry (`auditedUpdate`),
 * so one cannot exist without the other. Changes that take several steps (a delete that
 * clears balances, a migration, a restore) record their entry when they finish; if that
 * write fails it is queued on the device and sent with the next one, and it never undoes
 * or fails the change the person already made.
 */

export interface AuditActor {
  id: string
  name: string
  role: Role
}

let actor: AuditActor | null = null

/** Set by AuthProvider whenever the signed-in profile changes. */
export function setAuditActor(user: Pick<AppUser, 'id' | 'name' | 'role'> | null): void {
  actor = user ? { id: user.id, name: user.name, role: user.role } : null
}

export interface AuditInput {
  action: string
  entityType: AuditEntityType
  entityId: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  reason?: string
  /** Ties together the entries one operation writes (a supplier delete and its products). */
  operationId?: string
}

/** One value as stored: big values are summarised, never stored whole (images, long lists). */
const VALUE_MAX = 1_000
const KEYS_MAX = 40
function storable(v: unknown): unknown {
  if (v === DELETE_FIELD || v === undefined) return null
  if (typeof v === 'string' && v.startsWith('data:')) return `[data ${v.length} chars]`
  const json = JSON.stringify(v)
  if (json !== undefined && json.length > VALUE_MAX) return `[${json.length} chars]`
  return v
}
export function snapshot(doc: Record<string, unknown> | null | undefined, keys?: readonly string[]): Record<string, unknown> | null {
  if (!doc) return null
  const out: Record<string, unknown> = {}
  const pick = (keys ?? Object.keys(doc)).filter((k) => k !== 'id').slice(0, KEYS_MAX)
  for (const k of pick) out[k] = storable(doc[k])
  return out
}

export function newOperationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function auditId(now: number): string {
  // Sorts by time as text too; the random tail keeps two entries in one millisecond apart.
  return `${now.toString().padStart(14, '0')}_${Math.random().toString(36).slice(2, 10)}`
}

export function buildAuditEntry(input: AuditInput, who: AuditActor, now: number): AuditEntry {
  return {
    id: auditId(now),
    actorId: who.id,
    actorName: who.name.slice(0, 120),
    actorRole: who.role,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId.slice(0, 200),
    before: input.before ?? null,
    after: input.after ?? null,
    ...(input.reason?.trim() ? { reason: input.reason.trim().slice(0, 500) } : {}),
    operationId: input.operationId ?? newOperationId(),
    createdAt: now,
  }
}

const OUTBOX = 'pzm-audit-outbox'
const OUTBOX_MAX = 200

function readOutbox(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX)
    return raw ? (JSON.parse(raw) as AuditEntry[]) : []
  } catch {
    return []
  }
}
function writeOutbox(rows: AuditEntry[]): void {
  try {
    if (rows.length) localStorage.setItem(OUTBOX, JSON.stringify(rows.slice(-OUTBOX_MAX)))
    else localStorage.removeItem(OUTBOX)
  } catch {
    /* no storage: nothing to keep it in */
  }
}

async function send(entry: AuditEntry): Promise<boolean> {
  try {
    await backend.set(COL.auditLog, entry.id, entry as unknown as Record<string, unknown>)
    return true
  } catch {
    return false
  }
}

/** Entries that could not be written earlier, tried again (only the signed-in person's own). */
export async function flushAuditOutbox(): Promise<void> {
  const rows = readOutbox()
  if (!rows.length || !actor) return
  const left: AuditEntry[] = []
  for (const r of rows) if (r.actorId !== actor.id || !(await send(r))) left.push(r)
  writeOutbox(left)
}

/**
 * Record a change that already happened. Never throws: the change stands either way, and an
 * entry that cannot be written now waits on the device for the next one.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  if (!actor) return
  const entry = buildAuditEntry(input, actor, Date.now())
  if (!(await send(entry))) {
    writeOutbox([...readOutbox(), entry])
    return
  }
  await flushAuditOutbox()
}

/** Add the entry to a transaction that is making the change. */
export function auditInTx(tx: TxContext, input: AuditInput): void {
  if (!actor) return
  const entry = buildAuditEntry(input, actor, Date.now())
  tx.set(COL.auditLog, entry.id, entry as unknown as Record<string, unknown>)
}

/**
 * Update one document and record what changed, in one transaction. `before` is the changed
 * fields as they were, `after` as they are now. Throws whatever the update throws.
 */
export async function auditedUpdate(
  collection: string,
  id: string,
  patch: Record<string, unknown>,
  meta: Omit<AuditInput, 'entityId' | 'before' | 'after'> & { entityId?: string; expectedVersion?: number },
): Promise<void> {
  const keys = Object.keys(patch).filter((k) => k !== 'updatedAt' && k !== 'updatedBy')
  await backend.transaction(async (tx) => {
    const cur = await tx.get<Record<string, unknown>>(collection, id)
    // G25: an edit made from a loaded copy is refused if the document has moved on since.
    assertVersion(cur, meta.expectedVersion)
    const { expectedVersion: _v, ...auditMeta } = meta
    void _v
    tx.update(collection, id, patch)
    auditInTx(tx, { ...auditMeta, entityId: meta.entityId ?? id, before: snapshot(cur, keys), after: snapshot(patch, keys) })
  })
  void flushAuditOutbox()
}

// ---------------------------------------------------------------- reading ----

export const AUDIT_PAGE = 50

/** One page, newest first, older than `before` (a createdAt) when given. Admin only. */
export async function loadAuditPage(before?: number): Promise<{ rows: AuditEntry[]; more: boolean }> {
  const rows = await backend.page<AuditEntry>(COL.auditLog, 'createdAt', { limit: AUDIT_PAGE, before })
  return { rows, more: rows.length === AUDIT_PAGE }
}
