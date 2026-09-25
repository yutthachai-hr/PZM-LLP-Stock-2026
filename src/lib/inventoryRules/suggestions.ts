import type { Product, StockLocation, Transfer, TransferStatus } from '../../types'
import type { ReorderInsight } from './insights'
import { recommend } from './reorder'

/**
 * The day's suggestions as documents to draft (Master Automation Plan, Phase 1 — owner,
 * 25 Sep 2026): everything the warehouse should buy as one purchase request, and what each
 * branch should be sent from the warehouse as one transfer request.
 *
 * Built from the same `inventoryInsights().reorders` the calendar draws one by one, so the
 * dashboard card and the calendar never disagree about a number. Nothing here writes: the
 * card drafts a document only when a หัวหน้า presses its button.
 */

/**
 * How long a branch waits for goods from the warehouse. A branch is not supplied by the
 * supplier, so its reorder point uses this instead of the supplier's lead time. A constant
 * for now, and said so on the card; a setting would need a rules change.
 */
export const TRANSFER_LEAD_DAYS = 1

/** A transfer still in flight for its branch: nothing drafted, reviewed, or on the road twice. */
const OPEN_TRANSFER: readonly TransferStatus[] = [
  'draft',
  'pendingApproval',
  'returned',
  'inTransit',
  'receiving',
  'discrepancy',
  'pendingDiscrepancyApproval',
]

/** Drafted or under review, not yet sent: the goods are still counted in the warehouse. */
const NOT_YET_SENT: readonly TransferStatus[] = ['draft', 'pendingApproval', 'returned']

export interface InProgress {
  kind: 'pr' | 'po' | 'transfer'
  id: string
  docNo: string
}

export interface SuggestionLine {
  product: Product
  /** In the product's own unit. */
  qty: number
  onHand: number
  basis: 'usage' | 'minStock'
  avgDaily: number | null
  supplierId?: string
  supplierName?: string
  /** Already covered by an open document — shown, not ticked. */
  inProgress: InProgress | null
  /** A branch line cut down to what the warehouse holds (0 = none there at all). */
  limitedTo?: number
}

export interface PurchaseSuggestion {
  location: StockLocation
  lines: SuggestionLine[]
}

export interface TransferSuggestion {
  from: StockLocation
  to: StockLocation
  lines: SuggestionLine[]
}

export interface DailySuggestions {
  purchase: PurchaseSuggestion[]
  transfers: TransferSuggestion[]
}

/** Whether a line starts ticked: something to ask for, nothing already covering it. */
export function tickedByDefault(l: SuggestionLine): boolean {
  return !l.inProgress && l.qty > 0 && (l.limitedTo === undefined || l.limitedTo > 0)
}

export function dailySuggestions(input: {
  reorders: readonly ReorderInsight[]
  locations: readonly StockLocation[]
  qtyAt: (locationId: string, productId: string) => number
  minFor: (product: Product, locationId: string) => number
  coverDays: number
  openTransfers: readonly Transfer[]
}): DailySuggestions {
  const warehouses = input.locations.filter((l) => l.active !== false && l.type === 'warehouse')
  const source = warehouses[0]

  const purchase: PurchaseSuggestion[] = []
  for (const wh of warehouses) {
    const lines = input.reorders
      .filter((r) => r.location.id === wh.id)
      .map<SuggestionLine>((r) => ({
        product: r.product,
        qty: r.recommendedQty,
        onHand: r.onHand,
        basis: r.basis,
        avgDaily: r.avgDaily,
        supplierId: r.supplier?.id ?? r.product.supplierId,
        supplierName: r.supplier?.name,
        inProgress: r.inProgress ? { kind: r.inProgress.kind, id: r.inProgress.id, docNo: r.inProgress.docNo } : null,
      }))
      .sort(bySupplierThenName)
    if (lines.length) purchase.push({ location: wh, lines })
  }

  const transfers: TransferSuggestion[] = []
  if (source) {
    // Several branches may want the same thing; the warehouse's stock is shared out in turn.
    // What transfers drafted or under review already claim comes off first: those goods are
    // still on the warehouse's balance until the transfer is approved and sent.
    const reserved = new Map<string, number>()
    for (const t of input.openTransfers) {
      if (t.fromLocationId !== source.id || !NOT_YET_SENT.includes(t.status)) continue
      for (const i of t.items) {
        if (i.removed) continue
        reserved.set(i.productId, (reserved.get(i.productId) ?? 0) + (i.dispatchQty ?? i.requestedQty ?? 0))
      }
    }
    const left = new Map<string, number>()
    const available = (productId: string) =>
      left.get(productId) ?? Math.max(0, input.qtyAt(source.id, productId) - (reserved.get(productId) ?? 0))
    const branches = input.locations.filter((l) => l.active !== false && l.type === 'branch')
    for (const branch of branches) {
      const open = input.openTransfers.filter((t) => t.toLocationId === branch.id && OPEN_TRANSFER.includes(t.status))
      const lines: SuggestionLine[] = []
      for (const r of input.reorders) {
        if (r.location.id !== branch.id) continue
        const rec = recommend({
          onHand: r.onHand,
          incoming: r.incoming,
          avgDaily: r.avgDaily,
          min: input.minFor(r.product, branch.id),
          leadTimeDays: TRANSFER_LEAD_DAYS,
          coverDays: input.coverDays,
        })
        if (!rec) continue
        const onTransfer = open.find((t) => t.items.some((i) => !i.removed && i.productId === r.product.id))
        const inProgress: InProgress | null = onTransfer
          ? { kind: 'transfer', id: onTransfer.id, docNo: onTransfer.docNo }
          : r.inProgress
            ? { kind: r.inProgress.kind, id: r.inProgress.id, docNo: r.inProgress.docNo }
            : null
        // A line already on a document is shown as suggested; only lines still to be drafted
        // share out what the warehouse has left.
        const have = available(r.product.id)
        const qty = inProgress ? rec.recommendedQty : Math.min(rec.recommendedQty, have)
        if (!inProgress) left.set(r.product.id, have - qty)
        lines.push({
          product: r.product,
          qty,
          onHand: r.onHand,
          basis: rec.basis,
          avgDaily: r.avgDaily,
          inProgress,
          ...(qty < rec.recommendedQty ? { limitedTo: qty } : {}),
        })
      }
      lines.sort((a, b) => a.product.name.localeCompare(b.product.name))
      if (lines.length) transfers.push({ from: source, to: branch, lines })
    }
  }

  return { purchase, transfers }
}

function bySupplierThenName(a: SuggestionLine, b: SuggestionLine): number {
  return (a.supplierName ?? '~').localeCompare(b.supplierName ?? '~') || a.product.name.localeCompare(b.product.name)
}
