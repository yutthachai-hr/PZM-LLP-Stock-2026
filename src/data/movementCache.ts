import { listMovementsInRange } from '../services/stock'
import type { StockMovement } from '../types'
import { createRangeCache } from './rangeCache'

/** Historical movements by date, cached for the session so repeated range queries don't re-read. */
export const movementCache = createRangeCache<StockMovement>({
  fetch: listMovementsInRange,
  atOf: (m) => m.date,
})
