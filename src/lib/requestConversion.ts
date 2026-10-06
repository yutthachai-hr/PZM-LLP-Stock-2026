import type { PurchaseOrder, PurchaseRequest, PurchaseRequestItem } from '../types'
import { liveItems } from './purchaseRequestStatus'

/**
 * Turning an approved request into orders (plan A6, 6 Oct 2026): the parts that need no
 * database, shared by the conversion, the auditor and the admin's repair tool.
 */

/**
 * The id of the order a request becomes for one supplier.
 *
 * Fixed by the request and the supplier, so pressing the button twice, or on two tabs,
 * lands on the same document instead of a second set of orders (audit D4).
 */
export function conversionOrderId(requestId: string, supplierId: string): string {
  return `po_${requestId}_${supplierId}`
}

export interface OrderGroup {
  supplierId: string
  supplierName: string
  items: PurchaseRequestItem[]
}

/** The lines an approved request would turn into orders, grouped by supplier. */
export function orderGroups(pr: Pick<PurchaseRequest, 'items'>): OrderGroup[] {
  const by = new Map<string, OrderGroup>()
  for (const i of liveItems(pr.items)) {
    if (!((i.approvedQty ?? 0) > 0)) continue
    const g = by.get(i.supplierId) ?? { supplierId: i.supplierId, supplierName: i.supplierName, items: [] }
    g.items.push(i)
    by.set(i.supplierId, g)
  }
  return [...by.values()]
}

/**
 * A request left halfway by the conversion before A6: it still reads "approved", yet
 * orders already point at it. Converting it again would order the same goods twice.
 */
export interface StuckConversion {
  request: PurchaseRequest
  /** The orders that point at it, cancelled ones left out. */
  orders: PurchaseOrder[]
}

export function stuckConversions(requests: readonly PurchaseRequest[], orders: readonly PurchaseOrder[]): StuckConversion[] {
  const approved = new Map(requests.filter((r) => r.status === 'approved').map((r) => [r.id, r]))
  const by = new Map<string, PurchaseOrder[]>()
  for (const o of orders) {
    if (!o.requestId || o.status === 'cancelled' || !approved.has(o.requestId)) continue
    by.set(o.requestId, [...(by.get(o.requestId) ?? []), o])
  }
  return [...by].map(([id, list]) => ({ request: approved.get(id)!, orders: list }))
}

export type RepairBlocker =
  /** Two live orders for one supplier: one of them is the duplicate and must be cancelled. */
  | { kind: 'duplicate'; supplierName: string; docNos: string[] }
  /** An order for a supplier the request no longer has: it must be cancelled. */
  | { kind: 'notInRequest'; supplierName: string; docNo: string }

export interface RepairPlan {
  /** Supplier id → the existing order to take over as that supplier's order. */
  adopt: Record<string, string>
  /** Suppliers the request still needs an order for; the repair creates them. */
  missing: OrderGroup[]
  /** Why the existing orders cannot simply be linked. Empty = linking is possible. */
  blockers: RepairBlocker[]
}

/**
 * What linking a stuck request's orders to it would do. Nothing here is decided for the
 * admin: the tool shows this and waits for the button, request by request.
 */
export function repairPlan(stuck: StuckConversion): RepairPlan {
  const groups = orderGroups(stuck.request)
  const wanted = new Map(groups.map((g) => [g.supplierId, g]))
  const bySupplier = new Map<string, PurchaseOrder[]>()
  for (const o of stuck.orders) bySupplier.set(o.supplierId, [...(bySupplier.get(o.supplierId) ?? []), o])
  const adopt: Record<string, string> = {}
  const blockers: RepairBlocker[] = []
  for (const [supplierId, list] of bySupplier) {
    if (!wanted.has(supplierId)) {
      for (const o of list) blockers.push({ kind: 'notInRequest', supplierName: o.supplierName, docNo: o.docNo })
    } else if (list.length > 1) {
      blockers.push({ kind: 'duplicate', supplierName: list[0].supplierName, docNos: list.map((o) => o.docNo) })
    } else {
      adopt[supplierId] = list[0].id
    }
  }
  return { adopt, missing: groups.filter((g) => !(g.supplierId in adopt)), blockers }
}
