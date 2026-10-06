import { useEffect, useMemo, useState } from 'react'
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
  orders: PurchaseOrder[]
  risks: Map<string, DeliveryRisk>
  shortages: ShortageRisk[]
}

export function useSupplierIntel(): SupplierIntel {
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

  useEffect(() => {
    let alive = true
    Promise.all([orderCache.fetchRange(from, to), transferCache.fetchRange(tFrom, to)])
      .then(([orders, transfers]) => alive && setRows({ orders, transfers }))
      .catch(() => alive && setRows({ orders: [], transfers: [] }))
    const refresh = () => {
      const orders = orderCache.peekRange(from, to)
      const transfers = transferCache.peekRange(tFrom, to)
      if (orders && transfers) setRows({ orders, transfers })
    }
    const offs = [orderCache.subscribe(refresh), transferCache.subscribe(refresh)]
    return () => {
      alive = false
      offs.forEach((off) => off())
    }
  }, [from, to, tFrom])

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

  return { ready: !!rows, orders: rows?.orders ?? [], risks, shortages }
}
