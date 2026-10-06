import { listRequestsInRange } from '../services/purchaseRequests'
import type { PurchaseRequest } from '../types'
import { createRangeCache } from './rangeCache'
import { changedSince } from './changedSince'
import { COL } from '../types'

/** Purchase requests by the day they were opened, shared by the calendar and the dashboard widget. */
export const requestCache = createRangeCache<PurchaseRequest>({
  fetch: listRequestsInRange,
  atOf: (r) => r.createdAt,
  changedSince: changedSince<PurchaseRequest>(COL.purchaseRequests, 'purchaseRequests.delta'),
  persist: COL.purchaseRequests,
})
