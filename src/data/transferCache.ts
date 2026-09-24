import { listTransfersInRange } from '../services/transfers'
import type { Transfer } from '../types'
import { createRangeCache } from './rangeCache'

/** Transfers by the day they were created, shared across screens without burning Firestore reads. */
export const transferCache = createRangeCache<Transfer>({
  fetch: listTransfersInRange,
  atOf: (t) => t.createdAt,
})
