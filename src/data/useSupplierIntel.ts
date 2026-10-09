import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { assessAll, type DeliveryRisk } from '../lib/deliveryRisk'
import { shortageRisks, type ShortageRisk } from '../lib/inventoryRisk'
import { bkkDayEnd, bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { usageIndex } from '../lib/inventoryRules/usage'
import { useScheduleConfig } from '../services/schedules'
import { useSuppliers } from '../services/suppliers'
import type { PurchaseOrder, Transfer } from '../types'
import { stockoutIntel, type StockoutIntel } from '../intel/stockout'
import { supplierIntel, deliveryRiskIntel, type SupplierIntel as SupplierIntelResult } from '../intel/supplier'
import { deliverySnapshot, stockoutSnapshot } from '../intel/shadow'
import { INTEL_VERSIONS } from '../intel/meta'
import { deliveryOutcome } from '../lib/deliveryMetrics'
import { recordShadow } from '../services/intelShadow'
import { useAuth } from '../auth/AuthContext'
import type { UsageIndex } from '../lib/inventoryRules/usage'
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
  /** Phase G2: per SKU × location, with confidence and reasons (only those at risk). */
  stockouts: StockoutIntel[]
  /** Phase G1: per supplier, from the orders held. */
  supplierIntel: Map<string, SupplierIntelResult>
  transfers: Transfer[]
  usage: UsageIndex
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

const IDLE: SupplierIntel = { ready: false, failed: false, retry: () => {}, orders: [], risks: new Map(), shortages: [], stockouts: [], supplierIntel: new Map(), transfers: [], usage: new Map() }

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

  const usage = useMemo(() => usageIndex(data.movements, now, settings.usageWindowDays), [data.movements, now, settings.usageWindowDays])

  const supplierIntelMap = useMemo(() => {
    const m = new Map<string, SupplierIntelResult>()
    if (!rows) return m
    for (const sup of suppliers) m.set(sup.id, supplierIntel({ supplier: sup, orders: rows.orders, now }))
    return m
  }, [rows, suppliers, now])

  const stockouts = useMemo(() => {
    if (!rows) return []
    return stockoutIntel({
      products: data.products,
      locations: data.locations,
      qtyAt: data.qtyAt,
      tracksProduct: data.tracksProduct,
      usage,
      orders: rows.orders,
      transfers: rows.transfers,
      risks,
      p90DelayOf: (id) => supplierIntelMap.get(id)?.stats.delay.p90,
      leadTimeOf: (id) => suppliers.find((s) => s.id === id)?.leadTimeDays,
      now,
    })
  }, [rows, data.products, data.locations, data.qtyAt, data.tracksProduct, usage, risks, supplierIntelMap, suppliers, now])

  useShadowRecorder(rows, risks, stockouts, suppliers, now)

  const shortages = useMemo(() => {
    if (!rows) return []
    return shortageRisks({
      products: data.products,
      locations: data.locations,
      qtyAt: data.qtyAt,
      minFor: data.minFor,
      tracksProduct: data.tracksProduct,
      usage,
      orders: rows.orders,
      transfers: rows.transfers,
      risks,
      leadTimeOf: (id) => suppliers.find((s) => s.id === id)?.leadTimeDays,
      now,
    })
  }, [rows, data.products, data.locations, data.qtyAt, data.minFor, data.tracksProduct, usage, risks, suppliers, now])

  return useMemo(
    () => ({ ready: !!rows && !failed, failed, retry, orders: rows?.orders ?? [], risks, shortages, stockouts, supplierIntel: supplierIntelMap, transfers: rows?.transfers ?? [], usage }),
    [rows, failed, retry, risks, shortages, stockouts, supplierIntelMap, usage],
  )
}

/**
 * Phase G9, shadow mode: on a manager's or admin's device, keep each new order's delivery
 * risk (placed within the last day) and, once a day, the stock-out predictions. Writes only
 * `intelShadow`, best-effort; never anything that acts.
 */
function useShadowRecorder(
  rows: { orders: PurchaseOrder[] } | null,
  risks: Map<string, DeliveryRisk>,
  stockouts: StockoutIntel[],
  suppliers: { id: string; leadTimeDays?: number }[],
  now: number,
) {
  const { user } = useAuth()
  const manager = user?.role === 'manager' || user?.role === 'admin'
  useEffect(() => {
    if (!rows || !manager || !user) return
    const history = rows.orders.filter((o) => o.status === 'received' || o.status === 'cancelled').map(deliveryOutcome)
    for (const o of rows.orders) {
      if (o.status !== 'ordered' || now - o.orderedAt > 86_400_000 || !risks.has(o.id)) continue
      const r = deliveryRiskIntel(o, { now, history, supplier: suppliers.find((s) => s.id === o.supplierId) })
      if (r) void recordShadow(deliverySnapshot(r, user.id))
    }
    if (stockouts.length) void recordShadow(stockoutSnapshot(stockouts, now, user.id, INTEL_VERSIONS.stockout))
  }, [rows, risks, stockouts, suppliers, now, manager, user])
}
