import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { COL, type MonthlyCount, type PurchaseOrder, type PurchaseRequest } from '../types'
import { listOpenTransfers } from './transfers'

/**
 * What the Exception Inbox (plan C3) looks at: every record still open, whatever its
 * age — read by `status`, one equality query each, when the page opens. No listener.
 * A record that is finished is never read, so the cost follows the open work, not the
 * history.
 */
export async function loadInbox() {
  const db = backend.forBrand(getBrand())
  const [ordered, drafts, requests, transfers, recorded, posting] = await Promise.all([
    db.getBy<PurchaseOrder>(COL.purchaseOrders, 'status', 'ordered'),
    db.getBy<PurchaseOrder>(COL.purchaseOrders, 'status', 'draft'),
    db.getBy<PurchaseRequest>(COL.purchaseRequests, 'status', 'pendingApproval'),
    listOpenTransfers(),
    db.getBy<MonthlyCount>(COL.monthlyCounts, 'status', 'recorded'),
    db.getBy<MonthlyCount>(COL.monthlyCounts, 'status', 'posting'),
  ])
  return { orders: [...ordered, ...drafts], requests, transfers, counts: [...recorded, ...posting] }
}
