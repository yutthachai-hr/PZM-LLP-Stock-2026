import type { PurchaseOrder } from '../types'

/** A revised order that has not gone out again since: the supplier still holds the old sheet. */
export function needsResend(order: PurchaseOrder): boolean {
  const last = order.revisions?.[order.revisions.length - 1]
  if (!last || order.status !== 'ordered') return false
  return order.shareStatus === 'sent' && (order.sentAt ?? 0) < last.at
}
