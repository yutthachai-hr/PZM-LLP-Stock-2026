import { BACKEND_MODE } from '../backend'
import { getBrand } from '../brand/brand'
import { orderCache } from '../data/orderCache'
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
  try {
    const res = await fetch('/api/supplier-po/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ brand: getBrand(), poId: order.id }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { url: string; order: PurchaseOrder }
    orderCache.patch(body.order)
    return body
  } catch {
    return null
  }
}

/** A หัวหน้า/admin approves or refuses a date beyond the range. Throws the server's error code. */
export async function decideSupplierDate(
  order: PurchaseOrder,
  changeId: string,
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<PurchaseOrder> {
  const res = await fetch('/api/supplier-po/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ brand: getBrand(), poId: order.id, changeId, decision, reason }),
  })
  const body = (await res.json().catch(() => ({}))) as { order?: PurchaseOrder; error?: string }
  if (!res.ok || !body.order) throw new Error(body.error ?? `http_${res.status}`)
  orderCache.patch(body.order)
  return body.order
}
