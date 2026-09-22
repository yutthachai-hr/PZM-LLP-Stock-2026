import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { orderCache } from '../../data/orderCache'
import { requestCache } from '../../data/requestCache'
import { bkkDayEnd, bkkDayStart, DAY_MS } from '../../lib/inventoryRules/time'
import { shortages, type StockShortage } from '../../lib/inventoryRules/lowStock'
import { dailyActivity, docsOnDay, isTransfer, valueAsOf } from '../../lib/stats/periodCompare'
import type { PurchaseOrder, PurchaseRequest, StockLocation } from '../../types'

/**
 * Every figure on the desk dashboard (spec §2.1), from what is already in memory plus two
 * range reads that the calendar and the request widget share through their caches — the
 * request window is the same day-aligned 30 days RequestWidget asks for, so whichever
 * opens first pays and the other is free.
 */
export interface BranchRow {
  location: StockLocation
  /** Products with stock on hand here. */
  stocked: number
  low: number
  value: number
}

const VALUE_LOOKBACK_DAYS = 30

export function useDashboardFigures(now: number) {
  const { user } = useAuth()
  const { products, locations, qtyAt, minFor, tracksProduct, movements, movementsFrom } = useData()
  const [requests, setRequests] = useState<PurchaseRequest[] | null>(null)
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null)

  useEffect(() => {
    let alive = true
    const start = bkkDayStart(now)
    requestCache
      .fetchRange(start - 30 * DAY_MS, bkkDayEnd(now) + DAY_MS)
      .then((r) => alive && setRequests(r))
      .catch(() => alive && setRequests([]))
    orderCache
      .fetchRange(start - 7 * DAY_MS, bkkDayEnd(now))
      .then((o) => alive && setOrders(o))
      .catch(() => alive && setOrders([]))
    return () => {
      alive = false
    }
  }, [now, user?.id])

  return useMemo(() => {
    const today = bkkDayStart(now)
    const yesterday = today - DAY_MS
    const costs = new Map(products.map((p) => [p.id, p.cost ?? 0]))
    const costOf = (id: string) => costs.get(id) ?? 0

    const receivedToday = docsOnDay(movements, today, (m) => m.type === 'receive')
    const receivedYesterday = docsOnDay(movements, yesterday, (m) => m.type === 'receive')
    const transfersToday = docsOnDay(movements, today, isTransfer)
    const transfersYesterday = docsOnDay(movements, yesterday, isTransfer)

    const low: StockShortage[] = shortages({ products, locations, qtyAt, minFor, tracksProduct }).sort(
      (a, b) => a.qty / a.min - b.qty / b.min,
    )
    const outCount = low.filter((s) => s.out).length

    const branches: BranchRow[] = locations
      .filter((l) => l.active !== false)
      .map((location) => {
        let stocked = 0
        let value = 0
        for (const p of products) {
          if (p.active === false) continue
          const q = qtyAt(location.id, p.id)
          if (q > 0) stocked++
          value += Math.max(0, q) * (p.cost ?? 0)
        }
        return { location, stocked, low: low.filter((s) => s.location.id === location.id).length, value }
      })
    const value = branches.reduce((s, b) => s + b.value, 0)
    const valueBefore = valueAsOf(value, movements, today - VALUE_LOOKBACK_DAYS * DAY_MS, movementsFrom, costOf)

    const pendingRequests = requests?.filter((r) => r.status === 'pendingApproval').length ?? null

    return {
      receivedToday,
      receivedYesterday,
      transfersToday,
      transfersYesterday,
      low,
      outCount,
      branches,
      value,
      valueBefore,
      pendingRequests,
      weekly: dailyActivity(movements, today, 7),
      requests: requests ?? [],
      orders: orders ?? [],
    }
  }, [now, products, locations, qtyAt, minFor, tracksProduct, movements, movementsFrom, requests, orders])
}
