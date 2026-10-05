import type { AppUser, DeliveryDateChange, InventorySettings, PurchaseOrder } from '../../src/types'
import {
  applyPatch,
  dateKeyToMs,
  decide,
  DEFAULT_LINK_TTL_DAYS,
  DEFAULT_MAX_POSTPONE_DAYS,
  effectiveDeliveryOf,
  issueLink,
  lastRejection,
  linkActiveUntil,
  linkProblem,
  msToDateKey,
  openLink,
  requestedOf,
  respond,
  type RespondOutcome,
  type SupplierPatch,
} from '../../src/lib/supplierConfirmation'
import { supplierAnswerDraft, supplierDecisionDraft, toDoc } from '../../src/lib/inventoryRules/notifications'
import { DAY_MS } from '../../src/lib/inventoryRules/time'
import { brandCollection, type ServerStore } from './serverStore'
import { signSupplierToken, verifySupplierToken, type SupplierClaims, type TokenBrand } from './supplierToken'

/**
 * The supplier-confirmation endpoints as plain functions over injected dependencies, so the
 * tests drive them with an in-memory store and a fake clock. The Pages Function files in
 * functions/api/ only wire the real ones in (see `liveDeps`).
 *
 *   POST /api/supplier-po/link     signed-in staff: the link to send with the sheet
 *   GET  /api/supplier/<token>     anyone holding the link: what the page shows
 *   POST /api/supplier/<token>     anyone holding the link: accept, or propose a date
 *   POST /api/supplier-po/decide   หัวหน้า/admin: approve or refuse a date beyond the range
 */

export interface Deps {
  store: ServerStore
  secret: string
  now: () => number
  makeId: () => string
  /** The uid in a verified Firebase ID token from this Authorization header, or null. */
  verifyUser: (authorization: string | null) => Promise<string | null>
  /** https://pzmstock.pages.dev — where the link points. */
  origin: string
}

export interface Reply {
  status: number
  body: Record<string, unknown>
}

const COMPANY: Record<TokenBrand, string> = {
  pizza: 'Pizza Mania',
  lelapin: 'Le Lapin Sandwich Delivery',
}

const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body })
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => ({ status, body: { error, ...extra } })
/** Every link that is not ours, in any way, gets this same answer. */
const NOT_FOUND = fail(404, 'not_found')

const isBrand = (b: unknown): b is TokenBrand => b === 'pizza' || b === 'lelapin'
const isId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s)

async function settingsOf(store: ServerStore, brand: TokenBrand): Promise<{ maxPostponeDays: number; ttlDays: number }> {
  const s = (await store.get<Partial<InventorySettings>>(brandCollection(brand, 'inventorySchedules'), 'settings'))?.doc
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
  return {
    maxPostponeDays: num(s?.supplierMaxPostponeDays, DEFAULT_MAX_POSTPONE_DAYS),
    ttlDays: num(s?.supplierLinkTtlDays, DEFAULT_LINK_TTL_DAYS) || DEFAULT_LINK_TTL_DAYS,
  }
}

/** The signed-in caller, as the rules' active() would see them; null if they may not act. */
async function caller(deps: Deps, authorization: string | null): Promise<AppUser | null> {
  const uid = await deps.verifyUser(authorization)
  if (!uid) return null
  if (await deps.store.get('revokedUsers', uid)) return null
  const user = (await deps.store.get<AppUser>('users', uid))?.doc
  return user && user.active === true ? { ...user, id: uid } : null
}

/**
 * Read the order, compute a patch, write it only if nobody wrote in between; on a lost race
 * read again and recompute. Three tries is plenty for a document a handful of people touch.
 */
async function writeOrder<R>(
  deps: Deps,
  col: string,
  id: string,
  compute: (o: PurchaseOrder) => { patch: SupplierPatch | null; reply: R } | Reply,
): Promise<{ order: PurchaseOrder; reply: R } | Reply> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const got = await deps.store.get<PurchaseOrder>(col, id)
    if (!got) return NOT_FOUND
    const r = compute(got.doc)
    if ('status' in r && 'body' in r) return r
    if (!r.patch) return { order: got.doc, reply: r.reply }
    if (await deps.store.patchIf(col, id, r.patch, got.updateTime)) return { order: applyPatch(got.doc, r.patch), reply: r.reply }
  }
  return fail(409, 'busy')
}

const isReply = (x: unknown): x is Reply => typeof x === 'object' && x !== null && 'status' in x && 'body' in x

/** A notification is a courtesy: failing to write one never fails the answer itself. */
async function notify(deps: Deps, brand: TokenBrand, doc: ReturnType<typeof toDoc>): Promise<void> {
  try {
    await deps.store.create(brandCollection(brand, 'notifications'), doc.id, doc as unknown as Record<string, unknown>)
  } catch {
    /* best effort */
  }
}

// ----------------------------------------------------------------- link (staff) ----

export async function mintLink(deps: Deps, authorization: string | null, body: unknown): Promise<Reply> {
  const user = await caller(deps, authorization)
  if (!user) return fail(401, 'unauthorized')
  const { brand, poId } = (body ?? {}) as { brand?: unknown; poId?: unknown }
  if (!isBrand(brand) || !isId(poId)) return fail(400, 'bad_request')
  const { ttlDays } = await settingsOf(deps.store, brand)
  const now = deps.now()
  const res = await writeOrder(deps, brandCollection(brand, 'purchaseOrders'), poId, (o) => {
    const r = issueLink(o, { now, actor: { id: user.id, name: user.name }, ttlDays, makeId: deps.makeId })
    if (!r.ok) return fail(409, 'not_open')
    return { patch: r.patch, reply: { version: r.version, expiresAt: r.expiresAt } }
  })
  if (isReply(res)) return res
  const claims: SupplierClaims = {
    brand,
    poId,
    supplierId: res.order.supplierId,
    version: res.reply.version,
    expMs: res.reply.expiresAt,
  }
  const token = await signSupplierToken(claims, deps.secret)
  return ok({ url: `${deps.origin}/s/${token}`, token, expiresAt: res.reply.expiresAt, order: res.order })
}

// -------------------------------------------------------------- the supplier page ----

/** What the supplier's page shows. No prices, no people, nothing about other orders. */
export function supplierView(o: PurchaseOrder, brand: TokenBrand, maxPostponeDays: number, now: number, tokenExp: number) {
  const requested = requestedOf(o)
  const confirmed = o.confirmedDeliveryDate
  const rejection = lastRejection(o)
  const key = (ms: number | undefined) => (ms === undefined ? null : msToDateKey(ms))
  return {
    brand,
    company: COMPANY[brand],
    supplierName: o.supplierName,
    docNo: o.docNo,
    revision: o.revision ?? 0,
    status: o.supplierConfirmationStatus ?? 'waiting',
    requestedDate: key(requested),
    confirmedDate: key(confirmed),
    effectiveDate: key(effectiveDeliveryOf(o)),
    pending: o.pendingDeliveryDate ? { date: key(o.pendingDeliveryDate.date), note: o.pendingDeliveryDate.note ?? null } : null,
    rejection: rejection ? { date: key(rejection.to), reason: rejection.note ?? '' } : null,
    note: o.supplierDeliveryNote ?? null,
    items: o.lines.map((l) => ({ name: l.productName, qty: l.orderedQty, unit: l.entryUnit ?? l.unit })),
    maxPostponeDays,
    today: msToDateKey(now),
    /** The last date that applies at once; later ones wait for approval. */
    autoUntil: requested === undefined ? null : msToDateKey(requested + maxPostponeDays * DAY_MS),
    activeUntil: linkActiveUntil(o, tokenExp),
  }
}

async function claimsFor(deps: Deps, token: string): Promise<SupplierClaims | null> {
  return verifySupplierToken(token, deps.secret, deps.now())
}

export async function viewLink(deps: Deps, token: string): Promise<Reply> {
  const claims = await claimsFor(deps, token)
  if (!claims) return NOT_FOUND
  const col = brandCollection(claims.brand, 'purchaseOrders')
  const got = await deps.store.get<PurchaseOrder>(col, claims.poId)
  if (!got) return NOT_FOUND
  const now = deps.now()
  const problem = linkProblem(got.doc, claims, now)
  if (problem === 'mismatch') return NOT_FOUND
  if (problem) return fail(410, problem, { docNo: got.doc.docNo, company: COMPANY[claims.brand] })

  let order = got.doc
  const opened = openLink(order, claims.version, now, deps.makeId)
  if (opened) {
    // Recording the first view is worth one write, not a failed page: ignore a lost race.
    try {
      if (await deps.store.patchIf(col, claims.poId, opened, got.updateTime)) order = applyPatch(order, opened)
    } catch {
      /* best effort */
    }
  }
  const { maxPostponeDays } = await settingsOf(deps.store, claims.brand)
  return ok({ view: supplierView(order, claims.brand, maxPostponeDays, now, claims.expMs) })
}

export async function answerLink(deps: Deps, token: string, body: unknown): Promise<Reply> {
  const claims = await claimsFor(deps, token)
  if (!claims) return NOT_FOUND
  const b = (body ?? {}) as { action?: unknown; date?: unknown; note?: unknown; name?: unknown; requestId?: unknown }
  if (b.action !== 'accept' && b.action !== 'propose') return fail(400, 'bad_request')
  if (typeof b.requestId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(b.requestId)) return fail(400, 'bad_request')
  const date = b.action === 'propose' ? dateKeyToMs(typeof b.date === 'string' ? b.date : '') : null
  if (b.action === 'propose' && date === null) return fail(422, 'invalid')

  const col = brandCollection(claims.brand, 'purchaseOrders')
  const { maxPostponeDays } = await settingsOf(deps.store, claims.brand)
  const now = deps.now()
  type Answer = { replayed: true } | { replayed: false; outcome: RespondOutcome; change: DeliveryDateChange }
  const res = await writeOrder<Answer>(deps, col, claims.poId, (o) => {
    const problem = linkProblem(o, claims, now)
    if (problem === 'mismatch') return NOT_FOUND
    if (problem) return fail(410, problem)
    const r = respond(
      o,
      {
        action: b.action as 'accept' | 'propose',
        date,
        note: typeof b.note === 'string' ? b.note : undefined,
        name: typeof b.name === 'string' ? b.name : undefined,
        requestId: b.requestId as string,
      },
      { now, maxPostponeDays, makeId: deps.makeId },
    )
    if (!r.ok) return fail(422, r.error)
    if (r.replayed) return { patch: null, reply: { replayed: true } }
    return { patch: r.patch, reply: { replayed: false, outcome: r.outcome, change: r.change } }
  })
  if (isReply(res)) return res

  const reply = res.reply
  if (!reply.replayed) {
    const kind =
      reply.outcome === 'pending' ? 'supplierDatePending' : reply.outcome === 'changed' ? 'supplierDateChanged' : 'supplierConfirmed'
    const draft = supplierAnswerDraft(res.order, kind, reply.change.id, reply.change.to as number, reply.change.byName)
    await notify(deps, claims.brand, toDoc(draft, now, 'worker', 'supplier-link'))
  }
  return ok({
    replayed: reply.replayed,
    outcome: reply.replayed ? null : reply.outcome,
    view: supplierView(res.order, claims.brand, maxPostponeDays, now, claims.expMs),
  })
}

// ------------------------------------------------------------ decide (หัวหน้า) ----

export async function decideDate(deps: Deps, authorization: string | null, body: unknown): Promise<Reply> {
  const user = await caller(deps, authorization)
  if (!user) return fail(401, 'unauthorized')
  if (user.role !== 'admin' && user.role !== 'manager') return fail(403, 'forbidden')
  const b = (body ?? {}) as { brand?: unknown; poId?: unknown; changeId?: unknown; decision?: unknown; reason?: unknown }
  if (!isBrand(b.brand) || !isId(b.poId) || typeof b.changeId !== 'string') return fail(400, 'bad_request')
  if (b.decision !== 'approve' && b.decision !== 'reject') return fail(400, 'bad_request')
  const brand = b.brand
  const now = deps.now()
  const res = await writeOrder(deps, brandCollection(brand, 'purchaseOrders'), b.poId, (o) => {
    const r = decide(
      o,
      { changeId: b.changeId as string, decision: b.decision as 'approve' | 'reject', reason: typeof b.reason === 'string' ? b.reason : undefined },
      { id: user.id, name: user.name },
      now,
      deps.makeId,
    )
    if (!r.ok) return fail(r.error === 'stale' ? 409 : 422, r.error)
    return { patch: r.patch, reply: { change: r.change, date: r.date } }
  })
  if (isReply(res)) return res
  const approved = b.decision === 'approve'
  const draft = supplierDecisionDraft(res.order, approved, res.reply.change.id, res.reply.date, user.name, res.reply.change.note ?? '')
  await notify(deps, brand, toDoc(draft, now, 'worker', user.id))
  return ok({ order: res.order })
}
