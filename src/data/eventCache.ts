import { listEventsInRange } from '../services/events'
import type { StockEvent } from '../types'
import { createRangeCache } from './rangeCache'

/**
 * The calendar's tasks by date range, remembered for the session — see rangeCache.ts for
 * the reasoning, and services/events.ts for why nothing is subscribed. The names below are
 * the ones the calendar and the sidebar badge have always imported.
 */
const cache = createRangeCache<StockEvent>({
  fetch: listEventsInRange,
  atOf: (e) => e.startAt,
  compare: (a, b) => a.title.localeCompare(b.title),
})

export const fetchRange = cache.fetchRange
export const peekRange = cache.peekRange
export const hasRange = cache.hasRange
export const patchEvent = cache.patch
export const removeEvent = cache.remove
export const subscribeCache = cache.subscribe
/** Used by tests, and by anything that has reason to distrust what is held. */
export const clearEventCache = cache.clear
