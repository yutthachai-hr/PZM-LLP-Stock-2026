import type {
  DeliveryDateChange,
  PurchaseOrder,
  SupplierActivity,
  SupplierConfirmationStatus,
  SupplierIdentity,
} from '../types'
import { bkkDayEnd, bkkDayStart, bkkDaysBetween, BKK_OFFSET_MS, DAY_MS } from './inventoryRules/time'

/**
 * The supplier's answer to a delivery date (5 Oct 2026), as pure rules.
 *
 * Shared by the app (badges, the order's timeline) and the Pages Functions that write the
 * answer (functions/_lib/supplierPo.ts) — the server is the only writer of these fields, and
 * it computes every write here so the two can never disagree about what an answer means.
 * No browser, no Firebase: this file is bundled into a Cloudflare Function.
 *
 * Owner's rulings: a supplier may move a delivery up to `supplierMaxPostponeDays` later
 * (2) on their own, beyond that a หัวหน้า or admin decides; earlier — never before today —
 * applies on its own; the link may be used again until the delivery day, every answer kept.
 *
 * Every transition returns a patch: field → value, `null` meaning "remove the field". The
 * date we asked for (`requestedDeliveryDate`) is never in a patch a supplier's answer makes.
 */

/** A list kept on the order stops growing here (the document has to stay small). */
export const SUPPLIER_LIST_MAX = 100
export const SUPPLIER_NOTE_MAX = 300
export const SUPPLIER_NAME_MAX = 60
/** Nobody books a delivery four months out through a link; a date past this is a typo. */
export const SUPPLIER_FAR_DAYS = 120

export const DEFAULT_MAX_POSTPONE_DAYS = 2
export const DEFAULT_LINK_TTL_DAYS = 30

export type SupplierPatch = { [K in keyof PurchaseOrder]?: PurchaseOrder[K] | null }

export interface Actor {
  id?: string
  name: string
}

// ------------------------------------------------------------------ reading ----

/** The date we asked for. Orders sent before 5 Oct 2026 only have `expectedAt`. */
export function requestedOf(o: PurchaseOrder): number | undefined {
  return o.requestedDeliveryDate ?? o.expectedAt
}

/** When the goods are now expected: what was agreed, else what was asked. */
export function effectiveDeliveryOf(o: PurchaseOrder): number | undefined {
  return o.confirmedDeliveryDate ?? requestedOf(o)
}

/** `YYYY-MM-DD` → start of that Bangkok day; null for anything that is not a real date. */
export function dateKeyToMs(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '')
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const utc = Date.UTC(y, mo - 1, d)
  const back = new Date(utc)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return utc - BKK_OFFSET_MS
}

/** The Bangkok day of `ms` as `YYYY-MM-DD` — what a date input holds. */
export function msToDateKey(ms: number): string {
  const d = new Date(bkkDayStart(ms) + BKK_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/**
 * `DD/MM/YYYY` of a Bangkok day for a message to a supplier — the Buddhist year in Thai
 * (06/10/2569), the Gregorian one in English, as the company's own paperwork writes it.
 */
export function supplierDateLabel(ms: number, lang: 'th' | 'en'): string {
  const [y, m, d] = msToDateKey(ms).split('-')
  return `${d}/${m}/${lang === 'th' ? Number(y) + 543 : y}`
}

/** True when this request id has already been applied — a retried submit, not a new one. */
export function isReplay(o: PurchaseOrder, requestId: string): boolean {
  if (!requestId) return false
  return (
    (o.deliveryDateHistory ?? []).some((h) => h.requestId === requestId) ||
    (o.supplierActivity ?? []).some((a) => a.requestId === requestId)
  )
}

/** The latest refusal the supplier has not answered since, for the page to explain. */
export function lastRejection(o: PurchaseOrder): DeliveryDateChange | undefined {
  const h = o.deliveryDateHistory ?? []
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].action === 'rejected') return h[i]
    if (h[i].source === 'supplier') return undefined
  }
  return undefined
}

// --------------------------------------------------------------- validation ----

export type ProposalVerdict =
  | { ok: true; mode: 'auto' | 'needsApproval'; days: number }
  | { ok: false; error: 'invalid' | 'past' | 'tooFar' }

/**
 * Whether a date the supplier picked may apply on its own. `days` is how much later than
 * asked (negative = earlier). Without a date asked for there is nothing to postpone from,
 * so any date from today on applies.
 */
export function evaluateProposal(p: {
  requested: number | undefined
  proposed: number | null
  now: number
  maxPostponeDays: number
}): ProposalVerdict {
  if (p.proposed === null || !Number.isFinite(p.proposed)) return { ok: false, error: 'invalid' }
  const today = bkkDayStart(p.now)
  const day = bkkDayStart(p.proposed)
  if (day < today) return { ok: false, error: 'past' }
  if (bkkDaysBetween(today, day) > SUPPLIER_FAR_DAYS) return { ok: false, error: 'tooFar' }
  if (p.requested === undefined) return { ok: true, mode: 'auto', days: 0 }
  const days = bkkDaysBetween(p.requested, day)
  const max = Math.max(0, Math.floor(p.maxPostponeDays))
  return { ok: true, mode: days <= max ? 'auto' : 'needsApproval', days }
}

// --------------------------------------------------------------------- link ----

/**
 * The last instant the link answers: its hard cap, and the end of the delivery day — the
 * agreed one, or a proposed later one still waiting. With no date at all, the cap alone.
 */
export function linkActiveUntil(o: PurchaseOrder, tokenExpMs: number): number {
  const cap = Math.min(tokenExpMs, o.supplierLink?.expiresAt ?? tokenExpMs)
  const dates = [effectiveDeliveryOf(o), o.pendingDeliveryDate?.date].filter((d): d is number => d !== undefined)
  if (!dates.length) return cap
  return Math.min(cap, bkkDayEnd(Math.max(...dates)))
}

export type LinkProblem = 'mismatch' | 'expired' | 'closed'

/**
 * Whether a link (already proven to be ours by its signature) still speaks for this order.
 * A received, part-received or cancelled order takes no answers; a link from before the
 * last re-issue is dead.
 */
export function linkProblem(
  o: PurchaseOrder,
  claims: { supplierId: string; version: number; expMs: number },
  now: number,
): LinkProblem | null {
  const link = o.supplierLink
  if (!link || link.version !== claims.version || o.supplierId !== claims.supplierId) return 'mismatch'
  if (o.status !== 'ordered' || (o.receipts?.length ?? 0) > 0) return 'closed'
  if (now > linkActiveUntil(o, claims.expMs)) return 'expired'
  return null
}

export interface IssueContext {
  now: number
  actor: Actor
  ttlDays: number
  makeId: () => string
}

export type IssueResult =
  | { ok: true; patch: SupplierPatch | null; version: number; expiresAt: number }
  | { ok: false; error: 'notOpen' }

/**
 * The link to send with the sheet. The same link while the order is unchanged and the link
 * alive — sending the sheet twice gives the supplier one link, not two that disagree. A new
 * version once the order was amended (which also resets the answer: an amended order has
 * to be confirmed again) or the old link lapsed.
 */
export function issueLink(o: PurchaseOrder, ctx: IssueContext): IssueResult {
  if (o.status !== 'ordered' || (o.receipts?.length ?? 0) > 0) return { ok: false, error: 'notOpen' }
  const rev = o.revision ?? 0
  const link = o.supplierLink
  if (link && link.rev === rev && linkActiveUntil(o, link.expiresAt) > ctx.now) {
    return { ok: true, patch: null, version: link.version, expiresAt: link.expiresAt }
  }

  const version = (link?.version ?? 0) + 1
  const expiresAt = ctx.now + Math.max(1, ctx.ttlDays) * DAY_MS
  const history = [...(o.deliveryDateHistory ?? [])]
  const activity = [...(o.supplierActivity ?? [])]
  const patch: SupplierPatch = {}
  const by = { byName: ctx.actor.name, byId: ctx.actor.id }

  if (!link) {
    const asked = requestedOf(o)
    if (asked !== undefined) {
      patch.requestedDeliveryDate = asked
      history.push({ id: ctx.makeId(), at: ctx.now, source: 'purchasing', action: 'requested', to: asked, ...by })
    }
    patch.supplierConfirmationStatus = 'waiting'
  } else if (link.rev !== rev) {
    const dateAmended = (o.revisions ?? []).some(
      (r) => r.rev > link.rev && r.changes.some((c) => c.kind === 'expectedAt'),
    )
    if (o.pendingDeliveryDate) {
      history.push({
        id: ctx.makeId(),
        at: ctx.now,
        source: 'system',
        action: 'superseded',
        to: o.pendingDeliveryDate.date,
        ...by,
      })
      patch.pendingDeliveryDate = null
    }
    if (dateAmended) {
      const before = o.requestedDeliveryDate
      if (o.expectedAt !== undefined) patch.requestedDeliveryDate = o.expectedAt
      else patch.requestedDeliveryDate = null
      patch.confirmedDeliveryDate = null
      history.push({
        id: ctx.makeId(),
        at: ctx.now,
        source: 'purchasing',
        action: 'requested',
        from: before,
        to: o.expectedAt,
        ...by,
      })
    }
    history.push({ id: ctx.makeId(), at: ctx.now, source: 'system', action: 'reset', ...by })
    activity.push({ id: ctx.makeId(), at: ctx.now, kind: 'reset', ...by })
    patch.supplierConfirmationStatus = 'waiting'
  }

  activity.push({ id: ctx.makeId(), at: ctx.now, kind: 'linkIssued', ...by })
  patch.supplierLink = { version, rev, issuedAt: ctx.now, issuedBy: ctx.actor.id ?? ctx.actor.name, expiresAt }
  patch.deliveryDateHistory = history.slice(-SUPPLIER_LIST_MAX)
  patch.supplierActivity = activity.slice(-SUPPLIER_LIST_MAX)
  patch.updatedAt = ctx.now
  return { ok: true, patch: clean(patch), version, expiresAt }
}

/** The first time a link version is opened, once. Later views write nothing. */
export function openLink(o: PurchaseOrder, version: number, now: number, makeId: () => string): SupplierPatch | null {
  const link = o.supplierLink
  if (!link || link.version !== version || link.openedAt) return null
  return {
    supplierLink: { ...link, openedAt: now },
    supplierActivity: [...(o.supplierActivity ?? []), { id: makeId(), at: now, kind: 'opened' as const, byName: '' }].slice(
      -SUPPLIER_LIST_MAX,
    ),
    updatedAt: now,
  }
}

// ------------------------------------------------------------------ answers ----

export interface RespondInput {
  action: 'accept' | 'propose'
  /** ms of the Bangkok day; required for `propose`. */
  date?: number | null
  note?: string
  name?: string
  requestId: string
}

export interface RespondContext {
  now: number
  maxPostponeDays: number
  makeId: () => string
}

export type RespondOutcome = 'confirmed' | 'changed' | 'pending'

export type RespondResult =
  | { ok: true; replayed: true }
  | {
      ok: true
      replayed: false
      outcome: RespondOutcome
      patch: SupplierPatch
      change: DeliveryDateChange
      supersededChangeId?: string
    }
  | { ok: false; error: 'invalid' | 'past' | 'tooFar' | 'noRequestedDate' | 'full' }

/** Trim, strip control characters, cut to length; empty means none. */
export function cleanText(s: unknown, max: number): string | undefined {
  if (typeof s !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max)
  return t || undefined
}

/**
 * The supplier answers: accept the date asked for, or propose another. Applied at once
 * when within the owner's range (`confirmedDeliveryDate` and `expectedAt` move, so the
 * calendar does); held as `pendingDeliveryDate` otherwise. A newer answer replaces a
 * waiting one. Retrying the same `requestId` changes nothing.
 */
export function respond(o: PurchaseOrder, input: RespondInput, ctx: RespondContext): RespondResult {
  if (isReplay(o, input.requestId)) return { ok: true, replayed: true }
  const history = o.deliveryDateHistory ?? []
  // Room for this answer (two entries at most) and the decision that may follow it.
  if (history.length > SUPPLIER_LIST_MAX - 3) return { ok: false, error: 'full' }

  const requested = requestedOf(o)
  const note = cleanText(input.note, SUPPLIER_NOTE_MAX)
  const name = cleanText(input.name, SUPPLIER_NAME_MAX)
  const identity: SupplierIdentity = name ? { via: 'link', name } : { via: 'link' }
  const byName = name ?? o.supplierName
  const before = effectiveDeliveryOf(o)

  let target: number
  let mode: 'auto' | 'needsApproval'
  if (input.action === 'accept') {
    if (requested === undefined) return { ok: false, error: 'noRequestedDate' }
    if (bkkDayStart(requested) < bkkDayStart(ctx.now)) return { ok: false, error: 'past' }
    target = bkkDayStart(requested)
    mode = 'auto'
  } else {
    const v = evaluateProposal({
      requested,
      proposed: input.date ?? null,
      now: ctx.now,
      maxPostponeDays: ctx.maxPostponeDays,
    })
    if (!v.ok) return { ok: false, error: v.error }
    target = bkkDayStart(input.date as number)
    mode = v.mode
  }

  const nextHistory = [...history]
  const nextActivity = [...(o.supplierActivity ?? [])]
  const patch: SupplierPatch = { updatedAt: ctx.now }
  let supersededChangeId: string | undefined
  if (o.pendingDeliveryDate) {
    supersededChangeId = o.pendingDeliveryDate.changeId
    nextHistory.push({
      id: ctx.makeId(),
      at: ctx.now,
      source: 'supplier',
      action: 'superseded',
      to: o.pendingDeliveryDate.date,
      byName,
    })
    patch.pendingDeliveryDate = null
  }

  const change: DeliveryDateChange = {
    id: ctx.makeId(),
    at: ctx.now,
    source: 'supplier',
    action: input.action === 'accept' ? 'accepted' : mode === 'auto' ? 'autoApplied' : 'proposed',
    from: before,
    to: target,
    byName,
    note,
    requestId: input.requestId,
  }
  nextHistory.push(change)

  let outcome: RespondOutcome
  if (mode === 'auto') {
    outcome = requested !== undefined && bkkDayStart(requested) === target ? 'confirmed' : 'changed'
    patch.confirmedDeliveryDate = target
    patch.expectedAt = target
    patch.supplierConfirmationStatus = outcome
    patch.supplierConfirmedAt = ctx.now
    patch.supplierConfirmedBy = identity
  } else {
    outcome = 'pending'
    patch.pendingDeliveryDate = { date: target, note, name, at: ctx.now, changeId: change.id }
    patch.supplierConfirmationStatus = 'pending_date_approval'
  }
  patch.supplierDeliveryNote = note ?? null
  nextActivity.push({
    id: ctx.makeId(),
    at: ctx.now,
    kind: input.action === 'accept' ? 'accepted' : mode === 'auto' ? 'autoApplied' : 'pendingApproval',
    byName,
    date: target,
    note,
    requestId: input.requestId,
  })
  patch.deliveryDateHistory = nextHistory
  patch.supplierActivity = nextActivity.slice(-SUPPLIER_LIST_MAX)
  return { ok: true, replayed: false, outcome, patch: clean(patch), change: clean(change), supersededChangeId }
}

export interface DecideInput {
  changeId: string
  decision: 'approve' | 'reject'
  reason?: string
}

export type DecideResult =
  | { ok: true; patch: SupplierPatch; change: DeliveryDateChange; date: number }
  | { ok: false; error: 'stale' | 'reasonRequired' }

/**
 * A หัวหน้า or admin decides a date beyond the range. Approving applies it exactly as an
 * in-range answer would have; refusing leaves the agreed date (if any) where it was and the
 * supplier sees why the next time they open the link.
 */
export function decide(o: PurchaseOrder, input: DecideInput, actor: Actor, now: number, makeId: () => string): DecideResult {
  const pending = o.pendingDeliveryDate
  if (!pending || pending.changeId !== input.changeId || o.status !== 'ordered') return { ok: false, error: 'stale' }
  const reason = cleanText(input.reason, SUPPLIER_NOTE_MAX)
  if (input.decision === 'reject' && !reason) return { ok: false, error: 'reasonRequired' }

  const requested = requestedOf(o)
  const before = effectiveDeliveryOf(o)
  const change: DeliveryDateChange = clean({
    id: makeId(),
    at: now,
    source: 'purchasing',
    action: input.decision === 'approve' ? 'approved' : 'rejected',
    from: before,
    to: pending.date,
    byName: actor.name,
    byId: actor.id,
    note: reason,
  })
  const patch: SupplierPatch = { pendingDeliveryDate: null, updatedAt: now }
  let status: SupplierConfirmationStatus
  if (input.decision === 'approve') {
    status = requested !== undefined && bkkDayStart(requested) === pending.date ? 'confirmed' : 'changed'
    patch.confirmedDeliveryDate = pending.date
    patch.expectedAt = pending.date
    patch.supplierConfirmedAt = pending.at
    patch.supplierConfirmedBy = pending.name ? { via: 'link', name: pending.name } : { via: 'link' }
  } else if (o.confirmedDeliveryDate !== undefined) {
    status = requested !== undefined && bkkDayStart(requested) === o.confirmedDeliveryDate ? 'confirmed' : 'changed'
  } else {
    status = 'waiting'
  }
  patch.supplierConfirmationStatus = status
  patch.deliveryDateHistory = [...(o.deliveryDateHistory ?? []), change].slice(-SUPPLIER_LIST_MAX)
  patch.supplierActivity = [
    ...(o.supplierActivity ?? []),
    clean({
      id: makeId(),
      at: now,
      kind: input.decision === 'approve' ? ('approved' as const) : ('rejected' as const),
      byName: actor.name,
      byId: actor.id,
      date: pending.date,
      note: reason,
    }),
  ].slice(-SUPPLIER_LIST_MAX)
  return { ok: true, patch: clean(patch), change, date: pending.date }
}

/** Apply a patch to an order the way the store will (null removes the field). */
export function applyPatch(o: PurchaseOrder, patch: SupplierPatch): PurchaseOrder {
  const next = { ...o } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k]
    else if (v !== undefined) next[k] = v
  }
  return next as unknown as PurchaseOrder
}

// ----------------------------------------------------------------- display ----

export type BadgeColor = 'slate' | 'red' | 'green' | 'amber' | 'blue'

const BADGES: Record<SupplierConfirmationStatus, { label: string; color: BadgeColor }> = {
  waiting: { label: 'รอผู้ขายยืนยัน', color: 'amber' }, // i18n-key
  confirmed: { label: 'ผู้ขายยืนยันแล้ว', color: 'green' }, // i18n-key
  changed: { label: 'ผู้ขายเปลี่ยนวันส่ง', color: 'blue' }, // i18n-key
  pending_date_approval: { label: 'รออนุมัติวันส่ง', color: 'red' }, // i18n-key
}

/** The badge an order shows for the supplier's answer; none on an open order never linked. */
export function confirmationBadge(o: PurchaseOrder): { label: string; color: BadgeColor } | null {
  if (o.status !== 'ordered' || !o.supplierConfirmationStatus) return null
  return BADGES[o.supplierConfirmationStatus]
}

/** Every supplier interaction, newest first, for the order's timeline. */
export function supplierTimeline(o: PurchaseOrder): SupplierActivity[] {
  return [...(o.supplierActivity ?? [])].sort((a, b) => b.at - a.at)
}

/** Drop `undefined` values, so a write never carries a key with nothing in it. */
function clean<T extends object>(o: T): T {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v
  return out as T
}
