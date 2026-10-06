import { listMovementsInRange } from '../services/stock'
import type { StockMovement } from '../types'
import { createRangeCache } from './rangeCache'
import { changedSince } from './changedSince'
import { COL } from '../types'

/** Historical movements by date, cached for the session so repeated range queries don't re-read. */
export const movementCache = createRangeCache<StockMovement>({
  fetch: listMovementsInRange,
  atOf: (m) => m.date,
  // Corrections to old rows (edit, void) stamp updatedAt; new rows land in the live week.
  changedSince: changedSince<StockMovement>(COL.movements, 'movements.delta'),
})
