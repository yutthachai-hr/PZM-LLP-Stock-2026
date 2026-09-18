import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildFeed } from '../lib/inventoryRules/calendarFeed'
import { DAY_MS } from '../lib/inventoryRules/time'
import type { CalendarItem } from '../lib/inventoryRules/types'
import { useSuppliers } from '../services/suppliers'
import { useScheduleConfig } from '../services/schedules'
import { inventoryInsights } from '../lib/inventoryRules/insights'
import type { PurchaseOrder, PurchaseRequest, StockEvent } from '../types'
import { useData } from './DataContext'
import * as events from './eventCache'
import { orderCache } from './orderCache'
import { requestCache } from './requestCache'

/**
 * The calendar's items for a window, and the reads behind them.
 *
 * Three range reads — tasks, orders, requests — each through its session cache, so the
 * calendar and the dashboard share them and paging back to a month costs nothing. The
 * orders window reaches back six weeks and the requests window one month from the
 * start of what is shown: an order placed then may still be due now.
 *
 * Everything else the feed needs (balances, minimums, suppliers) is already in memory.
 */

/** How far before the shown window orders and requests are read. */
export const ORDER_LOOKBACK_DAYS = 45
export const REQUEST_LOOKBACK_DAYS = 30

export interface CalendarFeed {
  items: CalendarItem[]
  /** The records the items were built from, for lookups such as "is this already on order". */
  orders: PurchaseOrder[]
  requests: PurchaseRequest[]
  loading: boolean
  error: unknown
  reload: () => Promise<void>
  /** Fold a changed task into the cache and the list without a read. */
  patchTask: (e: StockEvent) => void
  removeTask: (id: string) => void
  patchOrder: (o: PurchaseOrder) => void
  patchRequest: (r: PurchaseRequest) => void
}

export function useCalendarFeed(range: { from: number; to: number }, now: number): CalendarFeed {
  const data = useData()
  const suppliers = useSuppliers()
  const config = useScheduleConfig()
  const [rows, setRows] = useState<{
    events: StockEvent[]
    orders: PurchaseOrder[]
    requests: PurchaseRequest[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const ordersFrom = range.from - ORDER_LOOKBACK_DAYS * DAY_MS
  const requestsFrom = range.from - REQUEST_LOOKBACK_DAYS * DAY_MS

  const load = useCallback(
    async (force = false) => {
      const cached =
        !force && events.hasRange(range.from, range.to) && orderCache.hasRange(ordersFrom, range.to) && requestCache.hasRange(requestsFrom, range.to)
      if (!cached) setLoading(true)
      try {
        const [ev, or, rq] = await Promise.all([
          events.fetchRange(range.from, range.to, { force }),
          orderCache.fetchRange(ordersFrom, range.to, { force }),
          requestCache.fetchRange(requestsFrom, range.to, { force }),
        ])
        setRows({ events: ev, orders: or, requests: rq })
        setError(null)
      } catch (e) {
        setError(e)
      } finally {
        setLoading(false)
      }
    },
    [range.from, range.to, ordersFrom, requestsFrom],
  )

  useEffect(() => {
    void load()
  }, [load])

  // A write anywhere patches the caches; re-read what they now hold for this window.
  useEffect(() => {
    const refresh = () => {
      const ev = events.peekRange(range.from, range.to)
      const or = orderCache.peekRange(ordersFrom, range.to)
      const rq = requestCache.peekRange(requestsFrom, range.to)
      if (ev && or && rq) setRows({ events: ev, orders: or, requests: rq })
    }
    const offs = [events.subscribeCache(refresh), orderCache.subscribe(refresh), requestCache.subscribe(refresh)]
    return () => offs.forEach((off) => off())
  }, [range.from, range.to, ordersFrom, requestsFrom])

  // Reorder suggestions, estimated stock-outs and big adjustments — all from memory: the
  // 30-day ledger, balances, and the orders and requests read above.
  const insights = useMemo(() => {
    if (!rows) return undefined
    return inventoryInsights({
      products: data.products,
      locations: data.locations,
      qtyAt: data.qtyAt,
      minFor: data.minFor,
      tracksProduct: data.tracksProduct,
      movements: data.movements,
      orders: rows.orders,
      requests: rows.requests,
      suppliers,
      settings: config.settings,
      snoozes: config.snoozes,
      now,
      adjustmentsSince: range.from,
    })
  }, [rows, data.products, data.locations, data.qtyAt, data.minFor, data.tracksProduct, data.movements, suppliers, config.settings, config.snoozes, now, range.from])

  const items = useMemo(() => {
    if (!rows) return []
    return buildFeed({
      events: rows.events,
      orders: rows.orders,
      requests: rows.requests,
      suppliers,
      products: data.products,
      locations: data.locations,
      qtyAt: data.qtyAt,
      minFor: data.minFor,
      tracksProduct: data.tracksProduct,
      range,
      now,
      insights,
    })
  }, [rows, suppliers, data.products, data.locations, data.qtyAt, data.minFor, data.tracksProduct, range, now, insights])

  return {
    items,
    orders: rows?.orders ?? [],
    requests: rows?.requests ?? [],
    loading: loading && !rows,
    error,
    reload: () => load(true),
    patchTask: events.patchEvent,
    removeTask: events.removeEvent,
    patchOrder: orderCache.patch,
    patchRequest: requestCache.patch,
  }
}
