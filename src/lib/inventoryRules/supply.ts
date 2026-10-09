import type { PurchaseOrder, PurchaseRequest, Transfer } from '../../types'
import { resolveFactor, type UnitBearer } from '../uom'
import { remainingBaseQty } from './purchasing'

/**
 * Where a product stands at one location (plan E1), in its own unit:
 *
 *   on hand − reserved = available        incoming (placed orders) · planned inbound
 *
 * **Reserved** counts real outbound commitments only: stock promised away that is still on
 * this location's shelf. In this app an approved transfer moves its goods into transit at
 * the moment it is approved, so nothing approved is ever still on the shelf — reserved is
 * zero today, by construction, and the rule is here so a later "approve now, dispatch
 * tomorrow" step is counted the day it exists. A transfer *request* waiting for approval is
 * not a commitment: it is shown as `requestedOut`, never deducted.
 *
 * **Incoming** is what placed orders still owe (`ordered`, remainingBaseQty — the A2 rule).
 * **Planned inbound** is what is decided but not placed: approved purchase requests not yet
 * turned into orders, and draft orders waiting for a manager. For planning only — never
 * added to available, never counted as incoming.
 */
export interface SupplyPosition {
  onHand: number
  reserved: number
  available: number
  incoming: number
  plannedInbound: number
  /** Transfer requests waiting for approval that would take from here — information only. */
  requestedOut: number
  /** A line in another unit with no known rate: its quantity is left out, and said so. */
  unknownUnits: boolean
}

/** Transfer states in which goods are committed but still on the source's shelf. None today. */
export const RESERVING_STATUSES: readonly Transfer['status'][] = []

const round = (n: number) => Math.round(n * 1000) / 1000

export function supplyPosition(input: {
  productId: string
  locationId: string
  onHand: number
  product?: UnitBearer
  orders: readonly PurchaseOrder[]
  requests: readonly PurchaseRequest[]
  transfers: readonly Transfer[]
}): SupplyPosition {
  const { productId, locationId, product } = input
  let unknownUnits = false
  let incoming = 0
  let plannedInbound = 0
  for (const po of input.orders) {
    if (po.locationId !== locationId || (po.status !== 'ordered' && po.status !== 'draft')) continue
    for (const l of po.lines) {
      if (l.productId !== productId) continue
      const r = remainingBaseQty(l, product)
      if (r.unknown) unknownUnits = true
      if (po.status === 'ordered') incoming += r.qty
      else plannedInbound += r.qty
    }
  }
  for (const pr of input.requests) {
    if (pr.status !== 'approved' || pr.locationId !== locationId) continue
    for (const i of pr.items) {
      if (i.productId !== productId || i.removed) continue
      const qty = i.approvedQty ?? i.requestedQty ?? 0
      if (!(qty > 0)) continue
      const factor = !i.entryUnit ? 1 : product ? resolveFactor(product, i.entryUnit) : null
      if (factor === null) {
        unknownUnits = true
        continue
      }
      plannedInbound += qty * factor
    }
  }
  let reserved = 0
  let requestedOut = 0
  for (const tr of input.transfers) {
    if (tr.fromLocationId !== locationId) continue
    const committed = RESERVING_STATUSES.includes(tr.status)
    if (!committed && tr.status !== 'pendingApproval') continue
    for (const i of tr.items) {
      if (i.productId !== productId || i.removed) continue
      const qty = i.requestedQty ?? i.dispatchQty ?? 0
      if (committed) reserved += qty
      else requestedOut += qty
    }
  }
  return {
    onHand: round(input.onHand),
    reserved: round(reserved),
    available: round(input.onHand - reserved),
    incoming: round(incoming),
    plannedInbound: round(plannedInbound),
    requestedOut: round(requestedOut),
    unknownUnits,
  }
}
