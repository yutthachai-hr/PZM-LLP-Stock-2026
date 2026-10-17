import type { PurchaseOrder } from '../../types'
import type { SharePatch } from '../../services/purchaseOrders'

/**
 * The order as the send wizard last knew it, so a recorded outcome lands on the right copy.
 *
 * Copies are compared by `updatedAt`; on a tie the one seen later wins, because the wizard
 * sees them in the order things happened (the link is read after "opened" was written).
 */
export function createOutcomeTracker() {
  const seen = new Map<string, PurchaseOrder>()
  const newer = (earlier: PurchaseOrder | undefined, later: PurchaseOrder | undefined) =>
    !earlier ? later : !later ? earlier : later.updatedAt >= earlier.updatedAt ? later : earlier
  return {
    /** A copy of an order the wizard learned about while sending it. */
    observe(order: PurchaseOrder) {
      seen.set(order.id, newer(seen.get(order.id), order)!)
    },
    /** The order as it stands once `written` has landed on it. */
    afterWrite(order: PurchaseOrder, written: SharePatch): PurchaseOrder {
      const next = { ...newer(order, seen.get(order.id))!, ...written }
      seen.set(order.id, next)
      return next
    },
  }
}
