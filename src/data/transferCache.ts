import { listTransfersInRange } from '../services/transfers'
import type { Transfer } from '../types'
import { createRangeCache } from './rangeCache'
import { persistRanges } from './persistKey'
import { COL } from '../types'

/** Transfers by the day they were created, shared across screens without burning Firestore reads. */
export const transferCache = createRangeCache<Transfer>({
  fetch: listTransfersInRange,
  persist: persistRanges('transfers', COL.transfers),
  atOf: (t) => t.createdAt,
})
