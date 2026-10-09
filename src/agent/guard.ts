/**
 * G12 — the Business Guard: deterministic rules that decide whether a proposal may go on.
 *
 * `guard(raw, snapshot)` is pure: same input, same answer, no clock (the snapshot carries
 * `now`), no I/O. It returns ALLOW, DENY or NEEDS_HUMAN with every rule's result, each under
 * a stable ruleId (docs/agent-safety/00-inspection-and-design.md §10).
 *
 * What it never does:
 *  - read `untrusted[]` or `reason` — free text and the proposer's own explanation cannot
 *    move a decision (the G16 invariance tests strip them and compare);
 *  - trust the actor as given — role and sites are taken from the users on file;
 *  - write, or execute anything. ALLOW means "a person may now look at this draft".
 *
 * A model can only make the answer stricter: see `combine`.
 */
import { monthOf } from '../lib/monthlyCount'
import { TRANSFER_LEAD_DAYS } from '../lib/inventoryRules/suggestions'
import { SOURCE_KEEP_DAYS } from '../intel/transfer'
import { FORBIDDEN_ACTIONS, parseProposal, proposalHash, referencedIds, type ActionProposal, type ActionType, type DraftLine } from './proposal'
import { baseQtyOf, DEFAULT_LIMITS, levelKey, type GuardSnapshot } from './snapshot'
import type { Role } from '../types'

export type Decision = 'ALLOW' | 'DENY' | 'NEEDS_HUMAN'
export type Outcome = 'PASS' | 'DENY' | 'NEEDS_HUMAN'

export interface RuleResult {
  ruleId: string
  outcome: Outcome
  reason: string
  evidence: Record<string, string | number>
}

export const SAFETY_DECISION_SCHEMA = 'safety-decision/1' as const

export interface GuardResult {
  /** Contract version (G25); always set by guard(), optional for hand-built results. */
  schema?: typeof SAFETY_DECISION_SCHEMA
  decision: Decision
  results: RuleResult[]
}

export const GUARD_VERSION = 'guard/1'

/** Who may propose what. Drafts are anyone's; touching an order or a supplier is a หัวหน้า's. */
export const ACTION_ROLES: Record<ActionType, readonly Role[]> = {
  CREATE_PR_DRAFT: ['admin', 'manager', 'staff'],
  CREATE_TRANSFER_DRAFT: ['admin', 'manager', 'staff'],
  RECOMMEND_PURCHASE: ['admin', 'manager', 'staff'],
  PROPOSE_PO_DATE_CHANGE: ['admin', 'manager'],
  CONTACT_SUPPLIER: ['admin', 'manager'],
}

const DAY = 86_400_000

export function decide(results: readonly RuleResult[]): Decision {
  if (results.some((r) => r.outcome === 'DENY')) return 'DENY'
  if (results.some((r) => r.outcome === 'NEEDS_HUMAN')) return 'NEEDS_HUMAN'
  return 'ALLOW'
}

/** What a model may say about a proposal the guard has already judged. */
export type ModelVerdict = 'APPROVE' | 'REJECT' | 'ABSTAIN'

/**
 * Guard and model together. The guard is the floor: a model can tighten, never loosen.
 * DENY stays DENY; NEEDS_HUMAN never becomes ALLOW; ALLOW + REJECT = DENY;
 * ALLOW + ABSTAIN (or no answer) = NEEDS_HUMAN.
 */
export function combine(guardDecision: Decision, model: ModelVerdict | undefined): Decision {
  if (guardDecision === 'DENY') return 'DENY'
  if (model === 'REJECT') return 'DENY'
  if (guardDecision === 'NEEDS_HUMAN') return 'NEEDS_HUMAN'
  return model === 'APPROVE' ? 'ALLOW' : 'NEEDS_HUMAN'
}

const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

export function guard(raw: unknown, snap: GuardSnapshot): GuardResult {
  const results: RuleResult[] = []
  const add = (ruleId: string, outcome: Outcome, reason: string, evidence: Record<string, string | number> = {}) => void results.push({ ruleId, outcome, reason, evidence })
  const done = (): GuardResult => ({ schema: SAFETY_DECISION_SCHEMA, decision: decide(results), results })
  const lim = { ...DEFAULT_LIMITS, ...snap.limits }

  // ------------------------------------------------------------ shape: nothing else runs on a bad shape
  const parsed = parseProposal(raw)
  if (!parsed.ok) {
    add('G.SCHEMA.VALID', 'DENY', 'The proposal does not match action-proposal/1.', { errors: parsed.errors.slice(0, 10).join('; ') })
    return done()
  }
  const p = parsed.proposal
  add('G.SCHEMA.VALID', 'PASS', 'Shape is valid.')
  const hash = proposalHash(p)
  if (hash !== p.integrity.hash) {
    add('G.INTEGRITY.HASH', 'DENY', 'The proposal was changed after it was sealed.', { expected: hash, actual: p.integrity.hash })
    return done()
  }
  add('G.INTEGRITY.HASH', 'PASS', 'Integrity hash matches.')
  if ((FORBIDDEN_ACTIONS as readonly string[]).includes(p.actionType)) {
    add('G.ACTION.FORBIDDEN', 'DENY', 'This action is never proposed by anything but a person at a screen.', { actionType: p.actionType })
    return done()
  }
  add('G.ACTION.KNOWN', 'PASS', 'Action type is allowed.', { actionType: p.actionType })
  const params = p.parameters as Exclude<ActionProposal['parameters'], { kind: (typeof FORBIDDEN_ACTIONS)[number] }>
  const action = p.actionType as ActionType

  const declared = [...new Set(p.entityIds)].sort()
  const named = referencedIds(params)
  if (declared.join(',') !== named.join(',')) add('G.ENTITY.CONSISTENT', 'DENY', 'entityIds do not list exactly the ids the parameters name.', { declared: declared.join(','), named: named.join(',') })
  else add('G.ENTITY.CONSISTENT', 'PASS', 'entityIds match the parameters.')

  // ------------------------------------------------------------ idempotency
  if (snap.seenOperations.includes(p.operationIntentId)) add('G.IDEMPOTENCY.OPERATION', 'DENY', 'This operation was already proposed (replay).', { operationIntentId: p.operationIntentId })
  else add('G.IDEMPOTENCY.OPERATION', 'PASS', 'First time this operation is seen.')

  // ------------------------------------------------------------ actor: the file, not the claim
  const user = snap.users.find((u) => u.id === p.actor.id)
  if (!user || !user.active) {
    add('G.ACTOR.EXISTS_ACTIVE', 'DENY', 'No active user with this id.', { actor: p.actor.id })
    return done()
  }
  add('G.ACTOR.EXISTS_ACTIVE', 'PASS', 'Actor is an active user.')
  if (p.actor.role !== user.role) add('G.ACTOR.ROLE', 'DENY', 'The role claimed is not the role on file.', { claimed: p.actor.role, onFile: user.role })
  else if (!ACTION_ROLES[action].includes(user.role)) add('G.ACTOR.ROLE', 'DENY', 'This role may not propose this action.', { role: user.role, action })
  else add('G.ACTOR.ROLE', 'PASS', 'Role may propose this action.', { role: user.role })

  const fileSites = user.siteIds && user.siteIds.length ? user.siteIds : null // null = every site
  const claimedWider = (p.actor.siteIds ?? []).filter((s) => fileSites && !fileSites.includes(s))
  const order = 'poId' in params && params.poId ? snap.orders.find((o) => o.id === params.poId) : undefined
  const sites = locationsOf(params, order?.locationId)
  const outside = fileSites ? sites.filter((s) => !fileSites.includes(s)) : []
  if (claimedWider.length) add('G.ACTOR.SITE', 'DENY', 'The sites claimed are not the sites on file.', { claimed: claimedWider.join(',') })
  else if (outside.length) add('G.ACTOR.SITE', 'DENY', 'The actor has no access to a site this touches.', { sites: outside.join(',') })
  else add('G.ACTOR.SITE', 'PASS', 'Actor may act at every site touched.')

  // ------------------------------------------------------------ ambiguity: abstain rather than guess
  const lines = linesOf(params)
  if ((p.unresolved?.length ?? 0) > 0 || (lines !== null && lines.length === 0)) {
    add('G.AMBIGUOUS.UNRESOLVED', 'NEEDS_HUMAN', 'The proposer could not resolve what was meant; a person must choose.', { fields: (p.unresolved ?? []).map((u) => u.field).join(',') || 'lines' })
  }

  // ------------------------------------------------------------ entities
  for (const id of sites) {
    const loc = snap.locations.find((l) => l.id === id)
    if (!loc) add('G.ENTITY.LOCATION_EXISTS', 'DENY', 'No such location.', { locationId: id })
    else if (!loc.active || loc.type === 'transit') add('G.ENTITY.LOCATION_ACTIVE', 'DENY', 'Location is inactive or not a stocking site.', { locationId: id })
    else add('G.ENTITY.LOCATION_ACTIVE', 'PASS', 'Location exists and is active.', { locationId: id })
  }
  for (const sid of suppliersOf(params)) {
    const s = snap.suppliers.find((x) => x.id === sid)
    if (!s || s.active === false) add('G.ENTITY.SUPPLIER_EXISTS', 'DENY', 'No such active supplier.', { supplierId: sid })
    else add('G.ENTITY.SUPPLIER_EXISTS', 'PASS', 'Supplier exists.', { supplierId: sid })
  }
  if ('poId' in params && params.poId) {
    if (!order) add('G.ENTITY.PO_EXISTS', 'DENY', 'No such purchase order.', { poId: params.poId })
    else if (params.kind === 'CONTACT_SUPPLIER' && order.supplierId !== params.supplierId) add('G.ENTITY.PO_EXISTS', 'DENY', 'The order belongs to another supplier.', { poId: order.id, orderSupplier: order.supplierId, supplierId: params.supplierId })
    else add('G.ENTITY.PO_EXISTS', 'PASS', 'Purchase order exists.', { poId: order.id })
  }

  // Per line: product, name, unit, quantity — all in the product's own unit from here on.
  const base = new Map<string, number>() // productId → base qty, summed over lines
  for (const l of lines ?? []) {
    const product = snap.products.find((x) => x.id === l.productId)
    if (!product) {
      add('G.ENTITY.PRODUCT_EXISTS', 'DENY', 'No such product.', { productId: l.productId })
      continue
    }
    if (!product.active) add('G.ENTITY.PRODUCT_ACTIVE', 'DENY', 'Product is inactive.', { productId: product.id })
    else add('G.ENTITY.PRODUCT_ACTIVE', 'PASS', 'Product exists and is active.', { productId: product.id })
    if (l.productName !== undefined) {
      const ok = norm(l.productName) === norm(product.name) || (!!product.sku && norm(l.productName) === norm(product.sku))
      add('G.ENTITY.NAME_MATCH', ok ? 'PASS' : 'DENY', ok ? 'Name matches the id.' : 'The name given is not this product (wrong record).', { productId: product.id, given: l.productName.slice(0, 80), onFile: product.name })
    }
    if (!(l.qty > 0) || !Number.isFinite(l.qty)) {
      add('G.QTY.POSITIVE_FINITE', 'DENY', 'Quantity must be a positive number.', { productId: product.id, qty: String(l.qty) })
      continue
    }
    add('G.QTY.POSITIVE_FINITE', 'PASS', 'Quantity is positive.', { productId: product.id })
    const q = baseQtyOf(snap, product.id, l.qty, l.unit)
    if (q === null) {
      add('G.UNIT.CONVERTIBLE', 'DENY', 'No conversion rate from this unit to the product’s own.', { productId: product.id, unit: l.unit ?? '', base: product.unitType })
      continue
    }
    add('G.UNIT.CONVERTIBLE', 'PASS', 'Unit converts.', { productId: product.id, baseQty: q })
    base.set(product.id, (base.get(product.id) ?? 0) + q)
  }

  // Quantities against hard and sanity bounds, at the site the goods go to.
  const dest = destinationOf(params)
  for (const [productId, q] of base) {
    const product = snap.products.find((x) => x.id === productId)!
    if (q > lim.qtyMax) {
      add('G.QTY.BOUNDED', 'DENY', 'Quantity is beyond any plausible order.', { productId, qty: q, max: lim.qtyMax })
      continue
    }
    const avg = dest ? usageOf(snap, dest, productId) : 0
    const min = dest ? minOf(snap, dest, product) : product.minStock
    const sanity = Math.max(lim.sanityDays * avg, 10 * min)
    if (sanity > 0 && q > sanity) add('G.QTY.BOUNDED', 'NEEDS_HUMAN', 'Quantity is far above what this site uses; a person should confirm.', { productId, qty: q, sanity })
    else add('G.QTY.BOUNDED', 'PASS', 'Quantity is within bounds.', { productId, qty: q })
  }

  // ------------------------------------------------------------ transfers: the source keeps what it needs
  if (params.kind === 'CREATE_TRANSFER_DRAFT') {
    if (params.fromLocationId === params.toLocationId) add('G.TRANSFER.DISTINCT_SITES', 'DENY', 'A transfer needs two different sites.', { locationId: params.fromLocationId })
    else add('G.TRANSFER.DISTINCT_SITES', 'PASS', 'Sites differ.')
    for (const [productId, q] of base) {
      const product = snap.products.find((x) => x.id === productId)!
      const lvl = snap.levels.find((x) => x.locationId === params.fromLocationId && x.productId === productId)
      const onHand = lvl?.onHand ?? 0
      const pending = snap.pendingOut.filter((x) => x.locationId === params.fromLocationId && x.productId === productId).reduce((s, x) => s + x.qty, 0)
      const available = Math.max(0, onHand - (lvl?.reserved ?? 0) - pending)
      const ev = { productId, qty: q, onHand, reserved: lvl?.reserved ?? 0, pendingOut: pending, available }
      if (q > available) {
        add('G.TRANSFER.SOURCE_SUFFICIENT', 'DENY', 'The source does not have this much to give.', ev)
        continue
      }
      add('G.TRANSFER.SOURCE_SUFFICIENT', 'PASS', 'The source has enough.', ev)
      // The same floor as src/intel/transfer.ts: its minimum, or its own use over the lead time plus SOURCE_KEEP_DAYS.
      const required = Math.max(minOf(snap, params.fromLocationId, product), usageOf(snap, params.fromLocationId, productId) * (TRANSFER_LEAD_DAYS + SOURCE_KEEP_DAYS))
      const after = Math.round((available - q) * 1000) / 1000
      add('G.TRANSFER.SOURCE_FLOOR', after < required ? 'DENY' : 'PASS', after < required ? 'The source would fall below what it needs itself.' : 'The source keeps what it needs.', { productId, after, required })
    }
  }

  // ------------------------------------------------------------ purchase orders
  if (params.kind === 'PROPOSE_PO_DATE_CHANGE' && order) {
    add('G.PO.STATE', order.status === 'ordered' ? 'PASS' : 'DENY', order.status === 'ordered' ? 'Order is open.' : 'Only an ordered (open) purchase order can be re-dated.', { poId: order.id, status: order.status })
    const sane = params.newDate > snap.now && params.newDate <= snap.now + lim.poDateMaxDays * DAY
    add('G.PO.DATE_SANE', sane ? 'PASS' : 'DENY', sane ? 'Date is ahead and within range.' : 'The date is in the past or too far ahead.', { newDate: params.newDate, now: snap.now })
  }

  // ------------------------------------------------------------ time: period lock and staleness
  const date = params.kind === 'PROPOSE_PO_DATE_CHANGE' ? params.newDate : snap.now
  const month = monthOf(date)
  const closed = sites.filter((s) => snap.closedPeriods.includes(`${s}__${month}`))
  add('G.PERIOD.OPEN', closed.length ? 'DENY' : 'PASS', closed.length ? 'The month is closed at this site (monthly count posted).' : 'Period is open.', { month, ...(closed.length ? { locations: closed.join(',') } : {}) })

  const refs = [...named, ...[...base.keys()].flatMap((pid) => sites.map((s) => levelKey(s, pid)))]
  const changed = refs.filter((r) => (snap.changedAt[r] ?? 0) > p.inputsAsOf)
  if (changed.length) add('G.STATE.FRESH', 'DENY', 'A record this was computed from has changed since.', { changed: changed.slice(0, 10).join(','), inputsAsOf: p.inputsAsOf })
  else if (snap.now - p.inputsAsOf > lim.staleAfterMs) add('G.STATE.FRESH', 'NEEDS_HUMAN', 'Computed from old state; a person should check it still holds.', { ageMs: snap.now - p.inputsAsOf, toleranceMs: lim.staleAfterMs })
  else add('G.STATE.FRESH', 'PASS', 'State is fresh.')

  // ------------------------------------------------------------ duplicates of a draft already open
  if (params.kind === 'CREATE_PR_DRAFT' || params.kind === 'CREATE_TRANSFER_DRAFT' || params.kind === 'RECOMMEND_PURCHASE') {
    const kind = params.kind === 'CREATE_TRANSFER_DRAFT' ? 'TRANSFER' : 'PR'
    const at = dest!
    const dup = (lines ?? []).filter((l) => snap.openDrafts.some((d) => d.kind === kind && d.locationId === at && d.productId === l.productId && (kind === 'TRANSFER' || !l.supplierId || !d.supplierId || d.supplierId === l.supplierId)))
    if (dup.length) add('G.IDEMPOTENCY.DUPLICATE_DRAFT', 'NEEDS_HUMAN', 'An open draft already covers this; a person should decide whether to add to it.', { products: dup.map((d) => d.productId).join(',') })
  }

  return done()
}

type Allowed = Exclude<ActionProposal['parameters'], { kind: (typeof FORBIDDEN_ACTIONS)[number] }>

/** Draft lines, uniformly; null for actions that have none. RECOMMEND_PURCHASE is one line. */
function linesOf(params: Allowed): DraftLine[] | null {
  switch (params.kind) {
    case 'CREATE_PR_DRAFT':
    case 'CREATE_TRANSFER_DRAFT':
      return params.lines
    case 'RECOMMEND_PURCHASE':
      return [{ productId: params.productId, productName: params.productName, qty: params.qty, unit: params.unit, supplierId: params.supplierId }]
    default:
      return null
  }
}

function locationsOf(params: Allowed, orderLocation: string | undefined): string[] {
  switch (params.kind) {
    case 'CREATE_PR_DRAFT':
    case 'RECOMMEND_PURCHASE':
      return [params.locationId]
    case 'CREATE_TRANSFER_DRAFT':
      return [...new Set([params.fromLocationId, params.toLocationId])]
    default:
      return orderLocation ? [orderLocation] : []
  }
}

function suppliersOf(params: Allowed): string[] {
  switch (params.kind) {
    case 'CREATE_PR_DRAFT':
      return [...new Set(params.lines.map((l) => l.supplierId).filter((s): s is string => !!s))]
    case 'RECOMMEND_PURCHASE':
    case 'CONTACT_SUPPLIER':
      return params.supplierId ? [params.supplierId] : []
    default:
      return []
  }
}

function destinationOf(params: Allowed): string | null {
  switch (params.kind) {
    case 'CREATE_PR_DRAFT':
    case 'RECOMMEND_PURCHASE':
      return params.locationId
    case 'CREATE_TRANSFER_DRAFT':
      return params.toLocationId
    default:
      return null
  }
}

function usageOf(snap: GuardSnapshot, locationId: string, productId: string): number {
  return snap.usage.find((u) => u.locationId === locationId && u.productId === productId)?.avgDaily ?? 0
}

function minOf(snap: GuardSnapshot, locationId: string, product: { id: string; minStock: number }): number {
  return snap.mins?.find((m) => m.locationId === locationId && m.productId === product.id)?.min ?? product.minStock
}
