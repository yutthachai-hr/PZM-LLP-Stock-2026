import { useEffect, useRef } from 'react'
import { getPurchaseOrder } from '../services/purchaseOrders'
import { useData } from './DataContext'
import { orderCache } from './orderCache'
import type { PurchaseOrder } from '../types'

/** Fired with the fresh order when a supplier's answer changed it server-side. */
export const ORDER_UPDATED = 'pzm:order-updated'

/**
 * A supplier's answer is written by the server, which the calendar's order cache never
 * hears about. Its notification does arrive, on the listener the bell already holds — so
 * each new supplier notification re-reads its one order (one read) and patches the cache,
 * and the calendar moves without anyone reloading (5 Oct 2026). No new listener.
 */
export function useSupplierRefresh(enabled: boolean): void {
  const { notifications } = useData()
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!enabled) return
    const supplier = notifications.filter((n) => n.kind.startsWith('supplier'))
    // The first batch is history: what was true before this session is already in any
    // order the session reads. Only notifications that arrive afterwards trigger a read.
    if (seen.current === null) {
      seen.current = new Set(supplier.map((n) => n.id))
      return
    }
    for (const n of supplier) {
      if (seen.current.has(n.id)) continue
      seen.current.add(n.id)
      const poId = /^supplier\w+__(.+?)__/.exec(n.id)?.[1]
      if (!poId) continue
      void getPurchaseOrder(poId)
        .then((o) => {
          if (!o) return
          orderCache.patch(o)
          // Screens holding their own copy (the Orders list, an open order sheet) take it too.
          window.dispatchEvent(new CustomEvent<PurchaseOrder>(ORDER_UPDATED, { detail: o }))
        })
        .catch(() => {})
    }
  }, [enabled, notifications])
}
