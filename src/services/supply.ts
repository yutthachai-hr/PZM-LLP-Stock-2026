import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { COL, type PurchaseOrder, type PurchaseRequest, type Transfer } from '../types'

/**
 * What a product's supply position (plan E1) is worked out from: placed and draft orders,
 * approved requests not yet ordered, and transfer requests waiting for approval. Open
 * records only, by status — read when the stock card opens, not subscribed.
 */
export async function loadSupplyInputs(): Promise<{ orders: PurchaseOrder[]; requests: PurchaseRequest[]; transfers: Transfer[] }> {
  const db = backend.forBrand(getBrand())
  const [ordered, drafts, requests, transfers] = await Promise.all([
    db.getBy<PurchaseOrder>(COL.purchaseOrders, 'status', 'ordered'),
    db.getBy<PurchaseOrder>(COL.purchaseOrders, 'status', 'draft'),
    db.getBy<PurchaseRequest>(COL.purchaseRequests, 'status', 'approved'),
    db.getBy<Transfer>(COL.transfers, 'status', 'pendingApproval'),
  ])
  return { orders: [...ordered, ...drafts], requests, transfers }
}
