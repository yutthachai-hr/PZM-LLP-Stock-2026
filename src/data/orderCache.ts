import { listOrdersInRange } from '../services/purchaseOrders'
import type { PurchaseOrder } from '../types'
import { createRangeCache } from './rangeCache'
import { persistRanges } from './persistKey'
import { COL } from '../types'

/**
 * Purchase orders by the day they were placed, for the calendar's receiving entries. The
 * window a screen asks for reaches back further than it looks (an order placed six weeks
 * ago may still be due), so one wide read serves every narrower view after it.
 */
export const orderCache = createRangeCache<PurchaseOrder>({
  fetch: listOrdersInRange,
  persist: persistRanges('orders', COL.purchaseOrders),
  atOf: (o) => o.orderedAt,
})
