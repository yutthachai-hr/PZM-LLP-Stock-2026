import { listRequestsInRange } from '../services/purchaseRequests'
import type { PurchaseRequest } from '../types'
import { createRangeCache } from './rangeCache'
import { persistRanges } from './persistKey'
import { COL } from '../types'

/** Purchase requests by the day they were opened, shared by the calendar and the dashboard widget. */
export const requestCache = createRangeCache<PurchaseRequest>({
  fetch: listRequestsInRange,
  persist: persistRanges('requests', COL.purchaseRequests),
  atOf: (r) => r.createdAt,
})
