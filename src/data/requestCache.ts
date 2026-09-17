import { listRequestsInRange } from '../services/purchaseRequests'
import type { PurchaseRequest } from '../types'
import { createRangeCache } from './rangeCache'

/** Purchase requests by the day they were opened, shared by the calendar and the dashboard widget. */
export const requestCache = createRangeCache<PurchaseRequest>({
  fetch: listRequestsInRange,
  atOf: (r) => r.createdAt,
})
