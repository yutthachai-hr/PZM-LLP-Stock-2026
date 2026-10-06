import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { assessAll, type DeliveryRisk } from '../lib/deliveryRisk'
import { shortageRisks, type ShortageRisk } from '../lib/inventoryRisk'
import { bkkDayEnd, bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { usageIndex } from '../lib/inventoryRules/usage'
import { useScheduleConfig } from '../services/schedules'
import { useSuppliers } from '../services/suppliers'
import type { PurchaseOrder, Transfer } from '../types'
import { useData } from './DataContext'
import { orderCache } from './orderCache'
import { transferCache } from './transferCache'

/**
 * Delivery risk and stock-out warnings for the screens that show them — dashboard, order
 * sheet, calendar (5 Oct 2026). Reads only through the session caches (orders by placing
 * day, transfers by creation day), so a screen opening it after another costs nothing; and
 * it re-reads what the caches hold whenever a write (or a supplier's answer arriving as a
 * notification, see useSupplierRefresh) patches them.
 *
 * The rules are pure (lib/deliveryRisk, lib/inventoryRisk); this only gathers inputs.
 */

/** History the risk rules look at (90 days) plus orders placed earlier still open. */
export const INTEL_ORDER_DAYS = 120
const TRANSFER_DAYS = 30

export interface SupplierIntel {
  ready: boolean
  /**
   * The orders or transfers could not be read (plan C1). Then there is no verdict at all —
   * an empty list here would read as "no risk", which is the one thing it does not mean.
   */
  failed: boolean
  retry: () => void
  orders: PurchaseOrder[]
  risks: Map<string, DeliveryRisk>
  shortages: ShortageRisk[]
}

/**
 * Worked out once for the whole app (plan D2'), and only while a screen that shows it is
 * open: the dashboard's risk panel, the calendar and the order sheet used to each read and
 * compute it separately — three runs of the shortage rules over every product on one page.
 */
const IntelCtx = createContext<{ intel: SupplierIntel; use: () => () => void } | null>(null)

export function SupplierIntelProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState(0)
  const intel = useIntelState(users > 0)
  const use = useCallback(() => {
    setUsers((n) => n + 1)
    return () => setUsers((n) => n - 1)
  }, [])
  const value = useMemo(() => ({ intel, use }), [intel, use])
  return createElement(IntelCtx.Provider, { value }, children)
}

const IDLE: SupplierIntel = { ready: false, failed: false, retry: () => {}, orders: [], risks: new Map(), shortages: [] }

export function useSupplierIntel(): SupplierIntel {
  const ctx = useContext(IntelCtx)
  const use = ctx?.use
  useEffect(() => use?.(), [use])
  return ctx?.intel ?? IDLE
}

function useIntelState(enabled: boolean): SupplierIntel {
  // One clock per screen, moved every five minutes: "overdue" and "runs out tomorrow"
  // change with time even when no data does — but not on every render.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5 * 60_000)
    return () => clearInterval(id)
  }, [])
  const data = useData()
  const suppliers = useSuppliers()
  const { settings } = useScheduleConfig()
  const today = bkkDayStart(now)
  const from = today - INTEL_ORDER_DAYS * DAY_MS
  const to = bkkDayEnd(now) + DAY_MS
  const tFrom = today - TRANSFER_DAYS * DAY_MS
  const [rows, setRows] = useState<{ orders: PurchaseOrder[]; transfers: Transfer[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    if (!enabled) return
    let alive = true
    Promise.all([orderCache.fetchRange(from, to), transferCache.fetchRange(tFrom, to)])
      .then(([orders, transfers]) => {
        if (!alive) return
        setFailed(false)
        setRows({ orders, transfers })
      })
      .catch((e) => {
        console.error('[intel] cannot read orders or transfers', e)
        if (alive) setFailed(true)
      })
    const refresh = () => {
      const orders = orderCache.peekRange(from, to)
      const transfers = transferCache.peekRange(tFrom, to)
      if (orders && transfers) {
        setFailed(false)
        setRows({ orders, transfers })
      }
    }
    const offs = [orderCache.subscribe(refresh), transferCache.subscribe(refresh)]
    return () => {
      alive = false
      offs.forEach((off) => off())
    }
  }, [from, to, tFrom, attempt, enabled])

  const risks = useMemo(() => (rows ? assessAll(rows.orders, now, suppliers) : new Map<string, DeliveryRisk>()), [rows, now, suppliers])

  const shortages = useMemo(() => {
    if (!rows) return []
    return shortageRisks({
      products: data.products,
      locations: data.locations,
      qtyAt: data.qtyAt,
      minFor: data.minFor,
      tracksProduct: data.tracksProduct,
      usage: usageIndex(data.movements, now, settings.usageWindowDays),
      orders: rows.orders,
      transfers: rows.transfers,
      risks,
      leadTimeOf: (id) => suppliers.find((s) => s.id === id)?.leadTimeDays,
      now,
    })
  }, [rows, data.products, data.locations, data.qtyAt, data.minFor, data.tracksProduct, data.movements, settings.usageWindowDays, risks, suppliers, now])

  return useMemo(() => ({ ready: !!rows && !failed, failed, retry, orders: rows?.orders ?? [], risks, shortages }), [rows, failed, retry, risks, shortages])
}
