import { backend } from '../backend'
import type { BrandId } from '../brand/brand'
import { COL, type PurchaseOrder, type PurchaseRequest, type StockEvent, type StockMovement } from '../types'

/**
 * Action time is not business date. A backdated receipt can be filed today; an old document
 * can be amended today. Read records created/updated since the action window began, then
 * let buildActivityLog filter the individual audit events. Updates AFTER the window must
 * be included too: those documents may still contain an action INSIDE the requested window.
 * No arbitrary 30/60-day document-age cap, full-collection query, or permanent listener.
 */
export async function readActivitySources(from: number, to: number, brand: BrandId) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw new Error('Invalid activity range')
  const db = backend.forBrand(brand)
  const changed = async <T extends { id: string }>(collection: string, dates?: [string, number, number]) => {
    const read = (field: string, a: number, b: number) => db.getRange<T>(collection, field, a, b, { server: true, label: `activity.${collection}.${field}` })
    const parts = await Promise.all([
      read('createdAt', from, to),
      read('updatedAt', from, Number.MAX_SAFE_INTEGER),
      ...(dates ? [read(...dates)] : []),
    ])
    return [...new Map(parts.flat().map(row => [row.id, row])).values()]
  }
  const [movements, orders, requests, events] = await Promise.all([
    changed<StockMovement>(COL.movements, ['date', from, to]),
    changed<PurchaseOrder>(COL.purchaseOrders),
    changed<PurchaseRequest>(COL.purchaseRequests),
    changed<StockEvent>(COL.events),
  ])
  return { movements, orders, requests, events }
}
