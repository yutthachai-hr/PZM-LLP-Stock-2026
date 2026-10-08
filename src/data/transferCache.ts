import { listTransfersInRange } from '../services/transfers'
import type { Transfer } from '../types'
import { createRangeCache } from './rangeCache'
import { changedSince } from './changedSince'
import { COL } from '../types'

/** Transfers by the day they were created, shared across screens without burning Firestore reads. */
export const transferCache = createRangeCache<Transfer>({
  fetch: listTransfersInRange,
  atOf: (t) => t.createdAt,
  changedSince: changedSince<Transfer>(COL.transfers, 'transfers.delta'),
  persist: COL.transfers,
})
