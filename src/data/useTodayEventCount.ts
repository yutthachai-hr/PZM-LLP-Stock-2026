import { useCallback, useEffect, useState } from 'react'
import { dayBounds } from '../services/events'
import { fetchRange, peekRange, subscribeCache } from './eventCache'

/**
 * How many things are scheduled for today — for the badge in the menu.
 *
 * One query per session, for one day, typically a handful of documents. It goes through
 * the same range cache the calendar uses, so opening the calendar afterwards does not pay
 * for today twice, and a badge shown on every screen still costs one read.
 *
 * Deliberately not a subscription. A live count on every screen for every device would be
 * billed on every cold start, and the shared tablets cold-start almost every session.
 * A number that is a few minutes stale is the right trade for a number that is free.
 */
export function useTodayEventCount(enabled: boolean): number {
  const [count, setCount] = useState(0)

  // Cancelled work is not work waiting to be done.
  const recount = useCallback(() => {
    const { from, to } = dayBounds(Date.now())
    const rows = peekRange(from, to) ?? []
    setCount(rows.filter((e) => e.status === 'upcoming' || e.status === 'inProgress').length)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const { from, to } = dayBounds(Date.now())
    // Recount on every cache change, so scheduling something for today moves the badge
    // without a second query.
    const off = subscribeCache(recount)
    fetchRange(from, to)
      .then(recount)
      .catch(() => {
        /* a badge is a courtesy; a failure here must not surface as an error */
      })
    return off
  }, [enabled, recount])

  return count
}
