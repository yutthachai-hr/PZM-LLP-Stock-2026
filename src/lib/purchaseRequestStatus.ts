import type { PurchaseRequest, PurchaseRequestStatus, Role } from '../types'

/**
 * The one place a request's status is reasoned about.
 *
 * Every screen and service asks these functions rather than comparing strings, so the
 * lifecycle can be read in full here and changed in one place:
 *
 *   draft ──submit──▶ pendingApproval ──approve──▶ approved ──convert──▶ poCreated
 *     ▲                     │ return                   │ reopen (admin)
 *     └──── returned ◀──────┘ reject ──▶ rejected      ▼
 *              │ resubmit                         pendingApproval
 *              └──────────▶ pendingApproval
 */

const TRANSITIONS: Record<PurchaseRequestStatus, readonly PurchaseRequestStatus[]> = {
  draft: ['pendingApproval'],
  pendingApproval: ['returned', 'approved', 'rejected'],
  returned: ['pendingApproval'],
  approved: ['poCreated', 'pendingApproval'],
  rejected: ['pendingApproval'],
  poCreated: [],
}

export function canTransition(from: PurchaseRequestStatus, to: PurchaseRequestStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** A manager is anyone who may review: the "hua na" role, and admins. */
export function isManager(role: Role | undefined): boolean {
  return role === 'admin' || role === 'manager'
}

/**
 * Whether this person may change the lines of this request right now.
 *
 * The requester edits their own draft, and edits it again when a manager sends it back.
 * A manager edits while it is waiting for approval — that is what reviewing is. Nobody
 * edits an approved, rejected or converted request; an admin reopens it first, which is
 * a recorded step, not a silent change.
 */
export function canEditItems(
  pr: Pick<PurchaseRequest, 'status' | 'requestedBy'>,
  user: { id: string; role: Role },
): boolean {
  const own = pr.requestedBy === user.id
  switch (pr.status) {
    case 'draft':
    case 'returned':
      return own || isManager(user.role)
    case 'pendingApproval':
      return isManager(user.role)
    default:
      return false
  }
}

/** Whether the requester-side buttons (save draft / submit) apply. */
export function isRequesterEditable(status: PurchaseRequestStatus): boolean {
  return status === 'draft' || status === 'returned'
}

/** Whether the manager-side review actions (approve / return / reject) apply. */
export function isUnderReview(status: PurchaseRequestStatus): boolean {
  return status === 'pendingApproval'
}

/** Approved and not yet turned into orders. */
export function isReadyForOrder(pr: Pick<PurchaseRequest, 'status' | 'orders'>): boolean {
  return pr.status === 'approved' && !(pr.orders && pr.orders.length > 0)
}

/** Lines that still count: everything a manager has not taken out. */
export function liveItems<T extends { removed?: unknown }>(items: readonly T[]): T[] {
  return items.filter((i) => !i.removed)
}

export const PR_STATUS_KEYS: Record<PurchaseRequestStatus, string> = {
  draft: 'ร่าง', // i18n-key
  pendingApproval: 'รออนุมัติ', // i18n-key
  returned: 'ส่งกลับให้แก้ไข', // i18n-key
  approved: 'อนุมัติแล้ว', // i18n-key
  rejected: 'ไม่อนุมัติ', // i18n-key
  poCreated: 'สร้างใบสั่งซื้อแล้ว', // i18n-key
}

export function prBadgeColor(status: PurchaseRequestStatus): 'slate' | 'red' | 'green' | 'amber' | 'blue' {
  switch (status) {
    case 'pendingApproval':
      return 'amber'
    case 'returned':
      return 'red'
    case 'rejected':
      return 'red'
    case 'approved':
      return 'green'
    case 'poCreated':
      return 'blue'
    default:
      return 'slate'
  }
}
