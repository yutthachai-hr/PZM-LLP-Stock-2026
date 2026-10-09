/**
 * "Suggested A, the person chose B" — a data-quality signal, kept centrally in the approved
 * append-only audit log (owner, 7 Oct 2026) rather than a new collection: action
 * `supplierResolution.override`, entity the product. No update, no delete, no listener; an
 * admin reads it a page at a time like every audit entry. Never applied: one correction
 * changes no product and no preferred supplier (lib/supplierResolution.ts supplierIssues
 * turns repeats into "mapping may need review").
 *
 * Later replicated / derived into the Supabase `supplier_resolution_feedback` table.
 */
import type { AuditEntry } from '../types'
import type { Evidence, OverrideEvent } from './supplierResolution'

export const OVERRIDE_ACTION = 'supplierResolution.override'

export interface OverrideContext {
  productId: string
  suggestedSupplierId: string
  selectedSupplierId: string
  /** How the suggestion was made: the resolution kind and its strongest evidence. */
  resolution: 'AUTO' | 'SUGGEST'
  evidence: Evidence
  /** The receipt being keyed: where, which document, and its idempotency id once known. */
  toLocationId?: string
  invoiceNo?: string
  receiptOperationId?: string
}

/** The audit input for one override. Pure. Labels only: the heuristic has no probability to record. */
export function overrideAudit(c: OverrideContext, operationId?: string) {
  return {
    action: OVERRIDE_ACTION,
    entityType: 'product' as const,
    entityId: c.productId,
    before: { supplierId: c.suggestedSupplierId, resolution: c.resolution, evidence: c.evidence },
    after: {
      supplierId: c.selectedSupplierId,
      ...(c.toLocationId ? { toLocationId: c.toLocationId } : {}),
      ...(c.invoiceNo ? { invoiceNo: c.invoiceNo.slice(0, 80) } : {}),
      ...(c.receiptOperationId ? { receiptOperationId: c.receiptOperationId } : {}),
      context: 'receive.manual',
    },
    ...(operationId ? { operationId } : {}),
  }
}

/** Overrides back out of audit entries (an admin's pages), for supplierIssues. */
export function overridesFromAudit(entries: readonly AuditEntry[]): OverrideEvent[] {
  const out: OverrideEvent[] = []
  for (const e of entries) {
    if (e.action !== OVERRIDE_ACTION || e.entityType !== 'product') continue
    const suggested = e.before?.supplierId
    const chosen = e.after?.supplierId
    if (typeof suggested === 'string' && typeof chosen === 'string') out.push({ productId: e.entityId, suggested, chosen, at: e.createdAt })
  }
  return out
}
