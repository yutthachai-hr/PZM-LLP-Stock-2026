import type { PurchaseOrder } from '../../types'
import type { SharePatch } from '../../services/purchaseOrders'

/**
 * The newest supplier event on a copy of the order. Every supplier activity is stamped by
 * the server (link issued, opened, answered, decided), so two copies compared by it never
 * mix clocks. `updatedAt` cannot be used: the share writes are stamped by this device.
 */
const supplierClock = (o: PurchaseOrder) =>
  (o.supplierActivity ?? []).reduce((latest, a) => Math.max(latest, a.at), -1)

/**
 * The order as the send wizard last knew it, so a recorded outcome lands on the right copy.
 *
 * The share fields always come from what was just written. Everything else comes from the
 * copy with the later supplier event; on a tie the one seen later wins, because the wizard
 * sees copies in the order things happened (the link is read after "opened" was written).
 */
export function createOutcomeTracker() {
  const seen = new Map<string, PurchaseOrder>()
  const newer = (earlier: PurchaseOrder | undefined, later: PurchaseOrder | undefined) =>
    !earlier ? later : !later ? earlier : supplierClock(later) >= supplierClock(earlier) ? later : earlier
  return {
    /** A copy of an order the wizard learned about while sending it. */
    observe(order: PurchaseOrder) {
      seen.set(order.id, newer(seen.get(order.id), order)!)
    },
    /** The order as it stands once `written` has landed on it. `held` is the device cache's
     *  row: it wins ties, so a receipt or cancellation filed elsewhere is not overwritten. */
    afterWrite(order: PurchaseOrder, written: SharePatch, held?: PurchaseOrder): PurchaseOrder {
      const next = { ...newer(newer(order, seen.get(order.id)), held)!, ...written }
      seen.set(order.id, next)
      return next
    },
  }
}

/**
 * Merges patched orders or share patches into the wizard's order list so summary and
 * badges reflect recent outcomes without waiting for parent re-render.
 */
export function mergeWizardOrders(
  orders: readonly PurchaseOrder[],
  patches: Readonly<Record<string, PurchaseOrder | SharePatch>>,
): PurchaseOrder[] {
  return orders.map((o) => {
    const patch = patches[o.id]
    return patch ? ({ ...o, ...patch } as PurchaseOrder) : o
  })
}

