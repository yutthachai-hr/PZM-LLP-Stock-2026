import type { Transfer, TransferStatus } from '../types'
import { liveItems } from './transferStatus'
import { isSameBkkDay } from './inventoryRules/time'

/**
 * The numbers the logistics screens show, worked out from the documents themselves. Each
 * one is something the database can actually answer — nothing here is an estimate.
 *
 *   on hand          the source's balance (the caller passes it; already less what left
 *                    for transit, because approval moves it out)
 *   waiting approval what other submitted requests ask of the same source, not yet
 *                    deducted — advice, not a reservation
 *   on the road      what documents from the source still have in transit
 */
export interface SourceFigures {
  onHand: number
  waitingApproval: number
  onTheRoad: number
}

const ON_THE_ROAD: TransferStatus[] = ['inTransit', 'receiving', 'discrepancy', 'pendingDiscrepancyApproval', 'resolved']

export function sourceFigures(
  transfers: readonly Transfer[],
  fromLocationId: string,
  productId: string,
  onHand: number,
  excludeId?: string,
): SourceFigures {
  let waitingApproval = 0
  let onTheRoad = 0
  for (const t of transfers) {
    if (t.id === excludeId || t.fromLocationId !== fromLocationId) continue
    for (const i of liveItems(t.items)) {
      if (i.productId !== productId) continue
      if (t.status === 'pendingApproval') waitingApproval += i.dispatchQty ?? i.requestedQty ?? 0
      else if (ON_THE_ROAD.includes(t.status)) onTheRoad += i.inTransitQty ?? 0
    }
  }
  return { onHand, waitingApproval, onTheRoad }
}

export type ArrivalCard = 'coming' | 'receiving' | 'problem' | 'received'

/**
 * The "today's deliveries" cards for the sites a person works at (all sites when they have
 * none assigned). A document is in the problem card at its destination, and also at the
 * branch where some of its goods turned up, until a manager decides.
 */
export function arrivalsFor(
  transfers: readonly Transfer[],
  sites: readonly string[] | null,
  now = Date.now(),
): Record<ArrivalCard, Transfer[]> {
  const mine = (loc: string) => !sites || sites.length === 0 || sites.includes(loc)
  const out: Record<ArrivalCard, Transfer[]> = { coming: [], receiving: [], problem: [], received: [] }
  for (const t of transfers) {
    const foundHere = t.items.some((i) => (i.misroutes ?? []).some((m) => !m.resolution && mine(m.actualCustodyLocationId)))
    if (mine(t.toLocationId)) {
      if (t.status === 'inTransit') out.coming.push(t)
      else if (t.status === 'receiving') out.receiving.push(t)
      else if (t.status === 'discrepancy' || t.status === 'pendingDiscrepancyApproval') out.problem.push(t)
      else if ((t.status === 'completed' || t.status === 'resolved') && t.receivedAt && isSameBkkDay(t.receivedAt, now)) out.received.push(t)
      if (foundHere && !out.problem.includes(t)) out.problem.push(t)
    } else if (foundHere) {
      out.problem.push(t)
    }
  }
  return out
}
