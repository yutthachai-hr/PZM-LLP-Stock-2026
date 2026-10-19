import { listMovementsInRange } from '../services/stock'
import type { StockMovement } from '../types'
import { createRangeCache } from './rangeCache'
import { changedSince } from './changedSince'
import { COL } from '../types'

/** Historical movements by date, cached for the session so repeated range queries don't re-read. */
export const movementCache = createRangeCache<StockMovement>({
  fetch: (from, to, brand) => listMovementsInRange(from, to, { brand, server: true }),
  atOf: (m) => m.date,
  // Backdated new rows need createdAt too: their business date may be outside the live week.
  changedSince: changedSince<StockMovement>(COL.movements, 'movements.delta', ['createdAt', 'updatedAt']),
})
