/**
 * G12 — what the Business Guard decides against: the state as of `now`, in memory.
 *
 * Plain data, no handles: the guard never reads Firestore (tests/agent-no-write-path).
 * Whoever calls the guard builds this from what it already holds — the app from its live
 * data (`snapshotFrom`), the safety dataset from its fixed world, Phase H's executor from a
 * fresh read inside the transaction.
 *
 * Quantities are in each product's own unit (`unitType`), as balances are.
 */
import type { AppUser, MonthlyCount, Product, PurchaseOrder, PurchaseOrderStatus, PurchaseRequest, Role, StockLocation, Supplier, Transfer, TransferStatus } from '../types'
import { resolveFactor, toBase } from '../lib/inventoryRules/uom'
import type { ActionProposal } from './proposal'

export interface SnapProduct {
  id: string
  name: string
  sku?: string
  active: boolean
  unitType: string
  unitConversions?: { label: string; size: number; per?: number; of?: string }[]
  minStock: number
}

export interface SnapLevel {
  locationId: string
  productId: string
  onHand: number
  /** Promised away already (reservations), in the base unit. */
  reserved?: number
}

export interface GuardLimits {
  /** Older than this, a proposal goes to a person even if nothing it read has changed. */
  staleAfterMs: number
  /** Above this (base units) a quantity is refused outright. */
  qtyMax: number
  /** More than this many days of use at the site sends a quantity to a person. */
  sanityDays: number
  /** A proposed delivery date may be at most this far ahead. */
  poDateMaxDays: number
}

export const DEFAULT_LIMITS: GuardLimits = { staleAfterMs: 6 * 3_600_000, qtyMax: 1_000_000, sanityDays: 60, poDateMaxDays: 180 }

export interface GuardSnapshot {
  now: number
  users: { id: string; role: Role; active: boolean; siteIds?: string[] }[]
  products: SnapProduct[]
  locations: { id: string; name: string; active: boolean; type?: string }[]
  suppliers: { id: string; name: string; active?: boolean }[]
  levels: SnapLevel[]
  /** Average daily use per site and product, base units. Absent = no history. */
  usage: { locationId: string; productId: string; avgDaily: number }[]
  /** Per-site minimum where it differs from the product's own `minStock`. */
  mins?: { locationId: string; productId: string; min: number }[]
  /** Transfer quantities requested out of a site and not yet approved (taken off its spare). */
  pendingOut: { locationId: string; productId: string; qty: number }[]
  orders: { id: string; status: PurchaseOrderStatus; supplierId: string; locationId: string; expectedAt?: number }[]
  /** Drafts still open, for the duplicate check. */
  openDrafts: { kind: 'PR' | 'TRANSFER'; locationId: string; productId: string; supplierId?: string }[]
  /** `${locationId}__${YYYY-MM}` of every posted monthly count — the period lock (plan B1). */
  closedPeriods: string[]
  /** operationIntentIds already proposed or executed (replay). */
  seenOperations: string[]
  /** When a record last changed: product, location, order ids, and `${loc}__${product}` for a level. */
  changedAt: Record<string, number>
  limits?: Partial<GuardLimits>
}

export const levelKey = (locationId: string, productId: string) => `${locationId}__${productId}`

/** Build a snapshot from the app's own records. Pure: the caller already holds the data. */
export function snapshotFrom(input: {
  now: number
  users: readonly AppUser[]
  products: readonly Product[]
  locations: readonly StockLocation[]
  suppliers: readonly Supplier[]
  levels: readonly SnapLevel[]
  usage?: readonly { locationId: string; productId: string; avgDaily: number }[]
  orders: readonly PurchaseOrder[]
  requests: readonly PurchaseRequest[]
  transfers: readonly Transfer[]
  monthlyCounts: readonly MonthlyCount[]
  seenOperations?: readonly string[]
  changedAt?: Record<string, number>
  limits?: Partial<GuardLimits>
}): GuardSnapshot {
  const PENDING: readonly TransferStatus[] = ['draft', 'pendingApproval', 'returned']
  const pendingOut: GuardSnapshot['pendingOut'] = []
  const openDrafts: GuardSnapshot['openDrafts'] = []
  for (const t of input.transfers) {
    if (!PENDING.includes(t.status)) continue
    for (const i of t.items) {
      if (i.removed) continue
      pendingOut.push({ locationId: t.fromLocationId, productId: i.productId, qty: i.dispatchQty || i.requestedQty || 0 })
      if (t.status === 'draft') openDrafts.push({ kind: 'TRANSFER', locationId: t.toLocationId, productId: i.productId })
    }
  }
  for (const r of input.requests) {
    if (r.status !== 'draft' && r.status !== 'pendingApproval' && r.status !== 'returned') continue
    for (const i of r.items) openDrafts.push({ kind: 'PR', locationId: r.locationId, productId: i.productId, supplierId: i.supplierId })
  }
  return {
    now: input.now,
    users: input.users.map((u) => ({ id: u.id, role: u.role, active: u.active, siteIds: u.siteIds })),
    products: input.products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, active: p.active, unitType: p.unitType, unitConversions: p.unitConversions, minStock: p.minStock })),
    locations: input.locations.map((l) => ({ id: l.id, name: l.name, active: l.active, type: l.type })),
    suppliers: input.suppliers.map((s) => ({ id: s.id, name: s.name })),
    levels: [...input.levels],
    usage: [...(input.usage ?? [])],
    pendingOut,
    orders: input.orders.map((o) => ({ id: o.id, status: o.status, supplierId: o.supplierId, locationId: o.locationId, expectedAt: o.expectedAt })),
    openDrafts,
    closedPeriods: input.monthlyCounts.filter((c) => c.status === 'posted').map((c) => `${c.locationId}__${c.month}`),
    seenOperations: [...(input.seenOperations ?? [])],
    changedAt: { ...(input.changedAt ?? {}) },
    limits: input.limits,
  }
}

/**
 * The state after a proposal was accepted as a draft: its transfer quantities count against
 * the source, its lines are open drafts, its operation id is spent. Used to evaluate a second
 * proposal "after" the first (the race scenarios) — nothing is written anywhere.
 */
export function afterAccepting(snap: GuardSnapshot, p: ActionProposal): GuardSnapshot {
  const next: GuardSnapshot = {
    ...snap,
    pendingOut: [...snap.pendingOut],
    openDrafts: [...snap.openDrafts],
    seenOperations: [...snap.seenOperations, p.operationIntentId],
  }
  const params = p.parameters
  if (params.kind === 'CREATE_TRANSFER_DRAFT') {
    for (const l of params.lines) {
      next.pendingOut.push({ locationId: params.fromLocationId, productId: l.productId, qty: baseQtyOf(snap, l.productId, l.qty, l.unit) ?? l.qty })
      next.openDrafts.push({ kind: 'TRANSFER', locationId: params.toLocationId, productId: l.productId })
    }
  } else if (params.kind === 'CREATE_PR_DRAFT') {
    for (const l of params.lines) next.openDrafts.push({ kind: 'PR', locationId: params.locationId, productId: l.productId, supplierId: l.supplierId })
  }
  return next
}

/** A quantity in the product's own unit, or null when the unit has no rate. */
export function baseQtyOf(snap: GuardSnapshot, productId: string, qty: number, unit: string | undefined): number | null {
  const product = snap.products.find((x) => x.id === productId)
  if (!product) return null
  const f = resolveFactor(product, unit)
  return f === null ? null : toBase(qty, f)
}
