import { BACKEND_MODE } from '../backend'
import { getBrand } from '../brand/brand'
import { orderCache } from '../data/orderCache'
import { trackWrite } from '../backend/pendingWrites'
import type { PurchaseOrder } from '../types'
import { authHeader } from './poImages'

/**
 * The app's side of the supplier link (functions/api/supplier-po/*). The server is the only
 * writer of the supplier-answer fields; these calls ask it to, and copy the order it
 * returns into the calendar's cache.
 *
 * `null` from `supplierLink` means "no link this time" — local mode, the owner has not set
 * the secrets yet (503), or the network failed — and the sheet goes out exactly as before.
 */
export async function supplierLink(order: PurchaseOrder): Promise<{ url: string; order: PurchaseOrder } | null> {
  if (BACKEND_MODE === 'local' || order.status !== 'ordered') return null
  // A server write the brand switcher waits for; the order goes into the cache only if the
  // brand it belongs to is still the open one (the cache is per brand).
  const brand = getBrand()
  return trackWrite(
    (async () => {
      try {
        const res = await fetch('/api/supplier-po/link', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ brand, poId: order.id }),
        })
        if (!res.ok) return null
        const body = (await res.json()) as { url: string; order: PurchaseOrder }
        if (getBrand() === brand) orderCache.patch(body.order)
        return body
      } catch {
        return null
      }
    })(),
  )
}

/**
 * The sheet carrying link `version` went: the supplier is now asked (A2). Best effort like the
 * link itself — `null` leaves the order unasked (never falsely asked), and the supplier
 * opening the link records the ask on the server anyway.
 */
export async function markSupplierRequested(order: PurchaseOrder, version: number): Promise<PurchaseOrder | null> {
  if (BACKEND_MODE === 'local' || order.status !== 'ordered') return null
  const brand = getBrand()
  return trackWrite(
    (async () => {
      try {
        const res = await fetch('/api/supplier-po/requested', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ brand, poId: order.id, version }),
        })
        if (!res.ok) return null
        const body = (await res.json()) as { order: PurchaseOrder }
        if (getBrand() === brand) orderCache.patch(body.order)
        return body.order
      } catch {
        return null
      }
    })(),
  )
}

/** A หัวหน้า/admin takes a leaked link back; the order keeps its answer. Throws the server's error code. */
export async function revokeSupplierLink(order: PurchaseOrder): Promise<{ url: string; order: PurchaseOrder }> {
  const brand = getBrand()
  return trackWrite(
    (async () => {
      const res = await fetch('/api/supplier-po/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ brand, poId: order.id }),
      })
      const body = (await res.json().catch(() => ({}))) as { url?: string; order?: PurchaseOrder; error?: string }
      if (!res.ok || !body.order || !body.url) throw new Error(body.error ?? `http_${res.status}`)
      if (getBrand() === brand) orderCache.patch(body.order)
      return { url: body.url, order: body.order }
    })(),
  )
}

/** A หัวหน้า/admin approves or refuses a date beyond the range. Throws the server's error code. */
export async function decideSupplierDate(
  order: PurchaseOrder,
  changeId: string,
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<PurchaseOrder> {
  const brand = getBrand()
  return trackWrite(
    (async () => {
      const res = await fetch('/api/supplier-po/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ brand, poId: order.id, changeId, decision, reason }),
      })
      const body = (await res.json().catch(() => ({}))) as { order?: PurchaseOrder; error?: string }
      if (!res.ok || !body.order) throw new Error(body.error ?? `http_${res.status}`)
      if (getBrand() === brand) orderCache.patch(body.order)
      return body.order
    })(),
  )
}
