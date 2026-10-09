/**
 * G19 — the workflows as state machines (owner, 7 Oct 2026): purchase requests, purchase
 * orders, receiving, transfers and monthly counts, in one format.
 *
 * Each machine lists its states, the terminal ones, and its actions: from which states, to
 * which state, by which roles (and whether the requester may too). Services ask `transition`
 * before they write — so an invalid move is refused in ONE place, in words kept here — and
 * screens ask `available` which buttons to show, instead of comparing status strings.
 *
 * The database rules stay authoritative (firestore.rules repeats the moves for anyone writing
 * directly); tests/workflow.test.ts pins every cell of every machine, and checks the request
 * and transfer machines against their own transition tables so the two cannot drift.
 *
 * Pure: no backend, no React.
 */
import { AppError } from '../i18n/AppError'
import type { MonthlyCountStatus, PurchaseOrderStatus, PurchaseRequestStatus, Role, TransferStatus } from '../types'

export interface Action<S extends string> {
  from: readonly S[]
  to: S
  /** Who may, by role. */
  roles: readonly Role[]
  /** The person who raised the document may too, whatever their role. */
  owner?: boolean
  /** The words when the document is not in a `from` state, per state (else a generic refusal). */
  refuse?: Partial<Record<S, string>>
}

export interface Machine<S extends string, A extends string> {
  name: string
  states: readonly S[]
  initial: S
  terminal: readonly S[]
  actions: Record<A, Action<S>>
}

export interface Actor {
  role: Role
  /** Whether this person raised the document (requests, transfers). */
  isOwner?: boolean
}

export type Check<S> = { ok: true; to: S } | { ok: false; why: 'state' | 'role'; key: string; vars?: Record<string, string> }

/** The generic refusals, in the app's words. */
export const NOT_NOW = 'ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน ({state})' // i18n-key
export const NOT_YOURS = 'ไม่มีสิทธิ์ทำรายการนี้' // i18n-key

const ALL: readonly Role[] = ['admin', 'manager', 'staff']
const MANAGERS: readonly Role[] = ['admin', 'manager']
const ADMIN: readonly Role[] = ['admin']

export function check<S extends string, A extends string>(m: Machine<S, A>, state: S, action: A, actor?: Actor): Check<S> {
  const a = m.actions[action]
  if (!a.from.includes(state)) return { ok: false, why: 'state', key: a.refuse?.[state] ?? NOT_NOW, ...(a.refuse?.[state] ? {} : { vars: { state } }) }
  if (actor && !(a.roles.includes(actor.role) || (a.owner && actor.isOwner))) return { ok: false, why: 'role', key: NOT_YOURS }
  return { ok: true, to: a.to }
}

/** For services: the next state, or the refusal thrown as an AppError. */
export function transition<S extends string, A extends string>(m: Machine<S, A>, state: S, action: A, actor?: Actor): S {
  const c = check(m, state, action, actor)
  if (!c.ok) throw new AppError(c.key, c.vars)
  return c.to
}

/** For screens: the actions this person may take on a document in this state. */
export function available<S extends string, A extends string>(m: Machine<S, A>, state: S, actor: Actor): A[] {
  return (Object.keys(m.actions) as A[]).filter((a) => check(m, state, a, actor).ok)
}

export const can = <S extends string, A extends string>(m: Machine<S, A>, state: S, action: A, actor: Actor) => check(m, state, action, actor).ok

/** Every (from, to) pair a machine allows — for the drift tests. */
export function edges<S extends string, A extends string>(m: Machine<S, A>): [S, S][] {
  return Object.values<Action<S>>(m.actions).flatMap((a) => a.from.map((f) => [f, a.to] as [S, S]))
}

// ---------------------------------------------------------------- purchase orders ----

export const PO = {
  name: 'purchaseOrder',
  states: ['draft', 'ordered', 'received', 'cancelled'],
  initial: 'draft',
  terminal: ['received', 'cancelled'],
  actions: {
    // A staff order is a draft until a หัวหน้า or admin approves it (plan B4).
    approve: { from: ['draft'], to: 'ordered', roles: MANAGERS },
    // A placed order changes only as a numbered, explained revision.
    amend: { from: ['ordered'], to: 'ordered', roles: ALL, refuse: { draft: 'แก้ไขได้เฉพาะใบที่สั่งแล้วและยังไม่รับของ', received: 'แก้ไขได้เฉพาะใบที่สั่งแล้วและยังไม่รับของ', cancelled: 'แก้ไขได้เฉพาะใบที่สั่งแล้วและยังไม่รับของ' } }, // i18n-key
    send: { from: ['ordered'], to: 'ordered', roles: ALL },
    // One delivery checked in; the order stays open until everything has come (receivePO decides).
    receive: { from: ['ordered'], to: 'ordered', roles: ALL, refuse: { received: 'ใบสั่งซื้อนี้รับของแล้ว', cancelled: 'ใบสั่งซื้อนี้ถูกยกเลิกแล้ว', draft: 'ใบสั่งซื้อนี้ยังเป็นร่าง ต้องอนุมัติก่อนรับของ' } }, // i18n-key
    receiveLast: { from: ['ordered'], to: 'received', roles: ALL, refuse: { received: 'ใบสั่งซื้อนี้รับของแล้ว', cancelled: 'ใบสั่งซื้อนี้ถูกยกเลิกแล้ว', draft: 'ใบสั่งซื้อนี้ยังเป็นร่าง ต้องอนุมัติก่อนรับของ' } }, // i18n-key
    closeShort: { from: ['ordered'], to: 'received', roles: ALL, refuse: { draft: 'ใบสั่งซื้อนี้ไม่ได้รอรับของอยู่', received: 'ใบสั่งซื้อนี้ไม่ได้รอรับของอยู่', cancelled: 'ใบสั่งซื้อนี้ไม่ได้รอรับของอยู่' } }, // i18n-key
    cancel: { from: ['draft', 'ordered'], to: 'cancelled', roles: ALL, refuse: { received: 'ยกเลิกไม่ได้: ใบสั่งซื้อนี้รับของเข้าคลังแล้ว', cancelled: 'ใบสั่งซื้อนี้ยกเลิกไปแล้ว' } }, // i18n-key
  },
} as const satisfies Machine<PurchaseOrderStatus, string>

export type PoAction = keyof typeof PO.actions

/** A draft nobody approved may be dropped outright; anything placed is cancelled with a reason. */
export const PO_DELETABLE: readonly PurchaseOrderStatus[] = ['draft']

// ---------------------------------------------------------------- receiving ----

/** One receipt on the Receive screen (its draft), from keying to filed. */
export type ReceivingState = 'keying' | 'reviewing' | 'filing' | 'filed'

export const RECEIVING = {
  name: 'receiving',
  states: ['keying', 'reviewing', 'filing', 'filed'],
  initial: 'keying',
  terminal: ['filed'],
  actions: {
    review: { from: ['keying'], to: 'reviewing', roles: ALL },
    back: { from: ['reviewing'], to: 'keying', roles: ALL },
    file: { from: ['reviewing'], to: 'filing', roles: ALL },
    // A dropped connection: the same operationId files once (plan A1), so trying again is safe.
    retry: { from: ['filing'], to: 'filing', roles: ALL },
    filed: { from: ['filing'], to: 'filed', roles: ALL },
    failed: { from: ['filing'], to: 'reviewing', roles: ALL },
  },
} as const satisfies Machine<ReceivingState, string>

// ---------------------------------------------------------------- monthly counts ----

export const COUNT = {
  name: 'monthlyCount',
  states: ['counting', 'recorded', 'posting', 'posted'],
  initial: 'counting',
  terminal: ['posted'],
  actions: {
    // Counting is everyone's job.
    count: { from: ['counting'], to: 'counting', roles: ALL, refuse: { recorded: 'ใบนับนี้ยืนยันแล้ว — แก้ยอดนับไม่ได้', posting: 'ใบนับนี้ยืนยันแล้ว — แก้ยอดนับไม่ได้', posted: 'ใบนับนี้ยืนยันแล้ว — แก้ยอดนับไม่ได้' } }, // i18n-key
    // What it does to the books is a manager's decision, signed.
    record: { from: ['counting'], to: 'recorded', roles: MANAGERS, refuse: { recorded: 'ใบนับนี้ยืนยันแล้ว', posting: 'ใบนับนี้ยืนยันแล้ว', posted: 'ใบนับนี้ยืนยันแล้ว' } }, // i18n-key
    post: { from: ['counting', 'recorded', 'posting'], to: 'posting', roles: MANAGERS, refuse: { posted: 'ใบนับนี้ปรับสต๊อกไปแล้ว' } }, // i18n-key
    postDone: { from: ['posting'], to: 'posted', roles: MANAGERS, refuse: { posted: 'ใบนับนี้ปรับสต๊อกไปแล้ว' } }, // i18n-key
    remove: { from: ['counting', 'recorded'], to: 'counting', roles: ADMIN },
  },
} as const satisfies Machine<MonthlyCountStatus, string>

// ---------------------------------------------------------------- requests and transfers ----
// Their tables already live in lib/purchaseRequestStatus.ts and lib/transferStatus.ts; these
// machines name the actions on top of them, and the tests prove every edge here is in those tables.

export const PR = {
  name: 'purchaseRequest',
  states: ['draft', 'pendingApproval', 'returned', 'approved', 'rejected', 'poCreated', 'skipped'],
  initial: 'draft',
  terminal: ['poCreated', 'skipped'],
  actions: {
    submit: { from: ['draft', 'returned'], to: 'pendingApproval', roles: MANAGERS, owner: true },
    approve: { from: ['pendingApproval'], to: 'approved', roles: MANAGERS },
    return: { from: ['pendingApproval'], to: 'returned', roles: MANAGERS },
    reject: { from: ['pendingApproval'], to: 'rejected', roles: MANAGERS },
    convert: { from: ['approved'], to: 'poCreated', roles: MANAGERS },
    reopen: { from: ['approved', 'rejected'], to: 'pendingApproval', roles: ADMIN },
    skip: { from: ['draft', 'returned'], to: 'skipped', roles: MANAGERS, owner: true },
  },
} as const satisfies Machine<PurchaseRequestStatus, string>

export const TRANSFER = {
  name: 'transfer',
  states: ['draft', 'pendingApproval', 'returned', 'rejected', 'inTransit', 'receiving', 'completed', 'discrepancy', 'pendingDiscrepancyApproval', 'resolved', 'cancelled'],
  initial: 'draft',
  terminal: ['completed', 'cancelled'],
  actions: {
    submit: { from: ['draft', 'returned'], to: 'pendingApproval', roles: MANAGERS, owner: true },
    approve: { from: ['pendingApproval'], to: 'inTransit', roles: MANAGERS },
    return: { from: ['pendingApproval'], to: 'returned', roles: MANAGERS },
    reject: { from: ['pendingApproval'], to: 'rejected', roles: MANAGERS },
    reopen: { from: ['rejected'], to: 'pendingApproval', roles: ADMIN },
    cancel: { from: ['draft', 'pendingApproval', 'returned'], to: 'cancelled', roles: MANAGERS, owner: true },
    openReceipt: { from: ['inTransit'], to: 'receiving', roles: ALL },
    receiveAll: { from: ['inTransit', 'receiving', 'discrepancy', 'pendingDiscrepancyApproval', 'resolved'], to: 'completed', roles: ALL },
    reportDiscrepancy: { from: ['inTransit', 'receiving'], to: 'discrepancy', roles: ALL },
    askApproval: { from: ['inTransit', 'receiving', 'discrepancy', 'resolved'], to: 'pendingDiscrepancyApproval', roles: ALL },
    resolve: { from: ['inTransit', 'receiving', 'discrepancy', 'pendingDiscrepancyApproval'], to: 'resolved', roles: MANAGERS },
  },
} as const satisfies Machine<TransferStatus, string>

export const MACHINES = { PO, RECEIVING, COUNT, PR, TRANSFER } as const
