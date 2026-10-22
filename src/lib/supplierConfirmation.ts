import type {
  DeliveryDateChange,
  PurchaseOrder,
  SupplierActivity,
  SupplierConfirmationStatus,
  SupplierIdentity,
} from '../types'
import { bkkDayStart, bkkDaysBetween, BKK_OFFSET_MS, DAY_MS } from './inventoryRules/time'

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
/** Only sets the timestamp signed into a new token; the order's lifecycle decides validity. */
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

/**
 * Purchasing's own latest ask: the date the approval range is measured from. A link that re-asks
 * the approved date after a quantity-only revision is the system's, not purchasing's, so it never
 * widens what a supplier may change without approval (owner, 22 Oct 2026; PR #48 review).
 */
export function rangeAnchorOf(o: PurchaseOrder): number | undefined {
  const h = o.deliveryDateHistory ?? []
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].action !== 'requested') continue
    return h[i].source === 'system' ? h[i].from : h[i].to
  }
  return requestedOf(o)
}

/** The last day a supplier's change applies at once; later ones wait for approval. */
export function supplierAutoUntil(o: PurchaseOrder, maxPostponeDays: number): number | undefined {
  const anchor = rangeAnchorOf(o)
  return anchor === undefined ? undefined : bkkDayStart(anchor) + Math.max(0, Math.floor(maxPostponeDays)) * DAY_MS
}

/** When the goods are now expected: what was agreed, else what was asked. */
export function effectiveDeliveryOf(o: PurchaseOrder): number | undefined {
  return o.confirmedDeliveryDate ?? requestedOf(o)
}

/** Whether the date that stands now was set by a manager/admin approving the supplier's proposal. */
export function agreedByPurchasing(o: PurchaseOrder): boolean {
  const agreed = agreedDateOf(o)
  if (agreed === undefined) return false
  const h = o.deliveryDateHistory ?? []
  for (let i = h.length - 1; i >= 0; i--) {
    const { action, to } = h[i]
    if (action === 'accepted' || action === 'autoApplied' || action === 'approved') return action === 'approved' && to !== undefined && bkkDayStart(to) === agreed
  }
  return false
}

/**
 * The Bangkok day the supplier and we agree on now: the last date accepted, applied within
 * the range or approved by a หัวหน้า on this link. It still stands while a newer date waits
 * for approval or after one was refused; an amended order's new link (`reset`) ends it.
 */
export function agreedDateOf(o: PurchaseOrder): number | undefined {
  const status = o.supplierConfirmationStatus
  if (o.confirmedDeliveryDate === undefined || !status || status === 'waiting') return undefined
  const day = bkkDayStart(o.confirmedDeliveryDate)
  const h = o.deliveryDateHistory ?? []
  for (let i = h.length - 1; i >= 0; i--) {
    const { action, to } = h[i]
    if (action === 'reset') return undefined
    if (action === 'accepted' || action === 'autoApplied' || action === 'approved') return to !== undefined && bkkDayStart(to) === day ? day : undefined
  }
  // The history was cut short: the status is all there is to go on.
  return status === 'pending_date_approval' ? undefined : day
}

/**
 * The supplier state a tab must have seen before making a new answer. Event identity
 * catches C→P→C even when the visible dates return to C. First-view bookkeeping and
 * unrelated PO writes do not change it. This is an optimistic precondition, not a credential.
 */
export function supplierStateOf(o: PurchaseOrder): string {
  return JSON.stringify([
    o.revision ?? 0,
    o.supplierLink?.version ?? 0,
    o.supplierConfirmationStatus ?? 'waiting',
    requestedOf(o) ?? null,
    o.confirmedDeliveryDate ?? null,
    o.pendingDeliveryDate?.changeId ?? null,
    o.pendingDeliveryDate?.date ?? null,
    o.deliveryDateHistory?.at(-1)?.id ?? null,
  ])
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
 * Whether the order still takes supplier answers: placed and not yet fully received, closed
 * short or cancelled. A part receipt leaves the order `ordered` while goods are still owed, so
 * its link stays open (owner, 21 Oct 2026). Time alone never closes a link.
 */
export function orderTakesAnswers(o: PurchaseOrder): boolean {
  return o.status === 'ordered'
}

export type LinkProblem = 'mismatch' | 'closed'

/**
 * Whether a link (already proven to be ours by its signature) still speaks for this order:
 * the same supplier, link version and order revision, and the order still open. A link
 * lives as long as its order (owner, 21 Oct 2026: PO-00002 opened 16 Oct was refused as
 * expired on 21 Oct) — no delivery-day or token-age limit.
 */
export function linkProblem(o: PurchaseOrder, claims: { supplierId: string; version: number }): LinkProblem | null {
  const link = o.supplierLink
  if (!link || link.version !== claims.version || link.rev !== (o.revision ?? 0) || o.supplierId !== claims.supplierId) return 'mismatch'
  if (!orderTakesAnswers(o)) return 'closed'
  return null
}

export interface IssueContext {
  now: number
  actor: Actor
  ttlDays: number
  makeId: () => string
  /** Take the link back: a new version for the same, unchanged order (R30). */
  reissue?: boolean
}

export type IssueResult =
  | { ok: true; patch: SupplierPatch | null; version: number; expiresAt: number }
  | { ok: false; error: 'notOpen' }

/**
 * The link to send with the sheet. The same link while the order is unchanged — sending the
 * sheet twice, or weeks later, gives the supplier the one link they already have. A new
 * version only once the order was amended (which also resets the answer: an amended order
 * has to be confirmed again). Elapsed time never re-issues.
 */
export function issueLink(o: PurchaseOrder, ctx: IssueContext): IssueResult {
  if (!orderTakesAnswers(o)) return { ok: false, error: 'notOpen' }
  const rev = o.revision ?? 0
  const link = o.supplierLink
  if (link && link.rev === rev && !ctx.reissue) {
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
    } else if (o.expectedAt !== undefined && requestedOf(o) !== o.expectedAt) {
      // The date stands (an approval or an in-range change moved expectedAt to it): a revision
      // that left the date alone asks for that date, never the one first asked (PO-00003, owner
      // 22 Oct 2026). The agreement is kept; another date is an explicit proposal.
      history.push({ id: ctx.makeId(), at: ctx.now, source: 'system', action: 'requested', from: requestedOf(o), to: o.expectedAt, ...by })
      patch.requestedDeliveryDate = o.expectedAt
    }
    history.push({ id: ctx.makeId(), at: ctx.now, source: 'system', action: 'reset', ...by })
    activity.push({ id: ctx.makeId(), at: ctx.now, kind: 'reset', ...by })
    patch.supplierConfirmationStatus = 'waiting'
  }

  // Same order, same answer: only the link the supplier holds is replaced.
  if (ctx.reissue && link && link.rev === rev) activity.push({ id: ctx.makeId(), at: ctx.now, kind: 'linkRevoked', ...by })
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
  /** Nothing to write: this request was applied already, or (`unchanged`) the order is
   *  already exactly where this answer would put it. */
  | { ok: true; replayed: true; unchanged?: true }
  | {
      ok: true
      replayed: false
      outcome: RespondOutcome
      patch: SupplierPatch
      change: DeliveryDateChange
      supersededChangeId?: string
    }
  | { ok: false; error: 'invalid' | 'past' | 'tooFar' | 'noRequestedDate' | 'full' | 'agreed' }

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
 * waiting one. Retrying the same `requestId` changes nothing, and neither does the same
 * answer sent again under a new one (see `isUnchanged`).
 */
export function respond(o: PurchaseOrder, input: RespondInput, ctx: RespondContext): RespondResult {
  if (isReplay(o, input.requestId)) return { ok: true, replayed: true }
  const history = o.deliveryDateHistory ?? []

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
    // A different date already stands (approved by purchasing, or the supplier's own change):
    // "accept" means the date asked for, so it would silently undo that agreement (PO-00003,
    // 22 Oct 2026). Moving off the agreed date is an explicit proposal, never this button.
    const agreed = agreedDateOf(o)
    if (agreed !== undefined && agreed !== bkkDayStart(requested)) return { ok: false, error: 'agreed' }
    if (bkkDayStart(requested) < bkkDayStart(ctx.now)) return { ok: false, error: 'past' }
    target = bkkDayStart(requested)
    mode = 'auto'
  } else {
    const v = evaluateProposal({
      requested: rangeAnchorOf(o),
      proposed: input.date ?? null,
      now: ctx.now,
      maxPostponeDays: ctx.maxPostponeDays,
    })
    if (!v.ok) return { ok: false, error: v.error }
    target = bkkDayStart(input.date as number)
    // The date agreed was within the range or approved already, or is the date this link asks
    // for: going back to it, or answering a refusal with it, is not asked for a second time.
    mode = target === agreedDateOf(o) || (requested !== undefined && target === bkkDayStart(requested)) ? 'auto' : v.mode
  }

  // Before the room check: an answer that changes nothing needs no room.
  if (isUnchanged(o, target, mode)) return { ok: true, replayed: true, unchanged: true }
  // Room for this answer (two entries at most) and the decision that may follow it.
  if (history.length > SUPPLIER_LIST_MAX - 3) return { ok: false, error: 'full' }

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

/**
 * Whether this answer would leave the order where it already is: the same date already
 * agreed on this link (nothing waiting over it), or the same date already waiting for a
 * หัวหน้า. Then it is not a new event: no history, no activity, no notification, and the
 * name and note sent with it overwrite nothing (owner, 12 Oct 2026: one confirmation,
 * pressed five times, reached the bell five times).
 *
 * Judged on the order itself, re-read on every lost race, not on time: a different date is
 * always new, and so is the first answer after the order was amended (the new link resets
 * the status to 'waiting') or after a หัวหน้า refused a date (the supplier is answering the
 * refusal; once answered, the same date again is unchanged).
 */
function isUnchanged(o: PurchaseOrder, target: number, mode: 'auto' | 'needsApproval'): boolean {
  if (lastRejection(o)) return false
  if (mode === 'needsApproval') return o.pendingDeliveryDate !== undefined && bkkDayStart(o.pendingDeliveryDate.date) === target
  return !o.pendingDeliveryDate && agreedDateOf(o) === target
}

export interface DecideInput {
  changeId: string
  decision: 'approve' | 'reject'
  reason?: string
}

export type DecideResult =
  | { ok: true; patch: SupplierPatch; change: DeliveryDateChange; date: number }
  | { ok: false; error: 'stale' | 'reasonRequired' | 'past' }

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
  // A date that has gone by while it waited is never applied; refusing it still works (R30).
  if (input.decision === 'approve' && bkkDayStart(pending.date) < bkkDayStart(now)) return { ok: false, error: 'past' }

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
  // Not green: green on an order row is LINE's ("sent"), and a supplier's answer must never
  // be mistaken for the share going out, or the other way round (owner, 17 Oct 2026).
  confirmed: { label: 'ผู้ขายยืนยันแล้ว', color: 'slate' }, // i18n-key
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
