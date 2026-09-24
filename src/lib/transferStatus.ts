import type {
  DiscrepancyReason,
  DiscrepancyResolutionCode,
  Role,
  Transfer,
  TransferStatus,
} from '../types'

/**
 * The single source of truth for branch transfer lifecycle and permissions.
 *
 *   draft ──submit──▶ pendingApproval ──approve──▶ inTransit ──open──▶ receiving
 *     ▲                     │ return                  │                  │
 *     │                     ▼                         │                  │
 *     └── returned ◀────────┘                         ▼                  ▼
 *                                                discrepancy ◀───────────┤
 *                                                     │                  ▼
 *                                                     ▼              completed
 *                                          pendingDiscrepancyApproval
 *                                                     │ approve
 *                                                     ▼
 *                                                  resolved ──legs closed──▶ completed
 */

const TRANSITIONS: Record<TransferStatus, readonly TransferStatus[]> = {
  draft: ['pendingApproval', 'cancelled'],
  pendingApproval: ['returned', 'rejected', 'inTransit', 'cancelled'],
  returned: ['pendingApproval', 'cancelled'],
  rejected: ['pendingApproval'], // admin reopen
  inTransit: ['receiving', 'completed', 'discrepancy'],
  receiving: ['completed', 'discrepancy'],
  discrepancy: ['pendingDiscrepancyApproval'],
  pendingDiscrepancyApproval: ['resolved'],
  resolved: ['completed'],
  completed: [],
  cancelled: [],
}

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

/** A manager is anyone who may review: manager role, and admins. */
export function isManager(role: Role | undefined): boolean {
  return role === 'admin' || role === 'manager'
}

/**
 * Check whether a user is allowed to access/act on a given branch.
 * Admin and managers can access all branches.
 * Staff with empty or undefined siteIds can access all branches.
 * Otherwise, locationId must be listed in siteIds.
 */
export function canUserAccessBranch(
  user: { role: Role; siteIds?: string[] } | undefined,
  locationId: string,
): boolean {
  if (!user) return false
  if (isManager(user.role)) return true
  if (!user.siteIds || user.siteIds.length === 0) return true
  return user.siteIds.includes(locationId)
}

/** Whether the user may create a transfer from the given location. */
export function canCreateTransfer(
  user: { id: string; role: Role; siteIds?: string[] } | undefined,
  fromLocationId: string,
): boolean {
  return canUserAccessBranch(user, fromLocationId)
}

/** Whether this person may edit transfer items right now. */
export function canEditItems(
  transfer: Pick<Transfer, 'status' | 'requestedBy'>,
  user: { id: string; role: Role },
): boolean {
  const own = transfer.requestedBy === user.id
  switch (transfer.status) {
    case 'draft':
    case 'returned':
      return own || isManager(user.role)
    case 'pendingApproval':
      return isManager(user.role)
    default:
      return false
  }
}

/** Whether the requester-side submit action applies. */
export function canSubmit(
  transfer: Pick<Transfer, 'status' | 'requestedBy' | 'items'>,
  user: { id: string; role: Role },
): boolean {
  if (transfer.status !== 'draft' && transfer.status !== 'returned') return false
  const own = transfer.requestedBy === user.id
  if (!own && !isManager(user.role)) return false
  return liveItems(transfer.items).length > 0
}

/** Whether the manager review action (approve / return / reject) applies. */
export function canApprove(
  transfer: Pick<Transfer, 'status'>,
  user: { role: Role },
): boolean {
  return transfer.status === 'pendingApproval' && isManager(user.role)
}

/** Whether branch staff can receive goods on this transfer. */
export function canReceive(
  transfer: Pick<Transfer, 'status' | 'toLocationId'>,
  user: { role: Role; siteIds?: string[] } | undefined,
): boolean {
  if (transfer.status !== 'inTransit' && transfer.status !== 'receiving') return false
  return canUserAccessBranch(user, transfer.toLocationId)
}

/** Filter out lines that were removed during review. */
export function liveItems<T extends { removed?: unknown }>(items: readonly T[]): T[] {
  return items.filter((i) => !i.removed)
}

export const TRANSFER_STATUS_KEYS: Record<TransferStatus, string> = {
  draft: 'ร่าง', // i18n-key
  pendingApproval: 'รออนุมัติ', // i18n-key
  returned: 'ส่งกลับให้แก้ไข', // i18n-key
  rejected: 'ไม่อนุมัติ', // i18n-key
  inTransit: 'ระหว่างขนส่ง', // i18n-key
  receiving: 'กำลังตรวจรับ', // i18n-key
  discrepancy: 'มีผลต่าง/ปัญหา', // i18n-key
  pendingDiscrepancyApproval: 'รออนุมัติผลต่าง', // i18n-key
  resolved: 'แก้ไขผลต่างแล้ว', // i18n-key
  completed: 'เสร็จสิ้น', // i18n-key
  cancelled: 'ยกเลิก', // i18n-key
}

export function transferBadgeColor(status: TransferStatus): 'slate' | 'red' | 'green' | 'amber' | 'blue' | 'purple' {
  switch (status) {
    case 'pendingApproval':
      return 'amber'
    case 'returned':
    case 'rejected':
    case 'discrepancy':
    case 'pendingDiscrepancyApproval':
      return 'red'
    case 'inTransit':
      return 'blue'
    case 'receiving':
      return 'amber'
    case 'resolved':
      return 'purple'
    case 'completed':
      return 'green'
    default:
      return 'slate'
  }
}

export const DISCREPANCY_REASON_KEYS: Record<DiscrepancyReason, string> = {
  SHORT: 'ของขาด (ส่งมาไม่ครบ)', // i18n-key
  OVER: 'ของเกิน (ส่งมาเกิน)', // i18n-key
  WEIGHT_VARIANCE: 'น้ำหนักต่างจากป้าย', // i18n-key
  DAMAGED: 'สินค้าชำรุด/เสียหาย', // i18n-key
  WRONG_ITEM: 'ส่งสินค้าผิดรายการ', // i18n-key
  WRONG_BRANCH: 'ส่งผิดสาขา', // i18n-key
  COUNTING_ERROR: 'นับจำนวนผิดพลาด', // i18n-key
  OTHER: 'อื่นๆ', // i18n-key
}

export const DISCREPANCY_RESOLUTION_KEYS: Record<DiscrepancyResolutionCode, string> = {
  NOT_ACTUALLY_LOADED: 'ไม่ได้ขนขึ้นรถจริง (คืนสต๊อกต้นทาง)', // i18n-key
  TRANSIT_LOSS: 'ของหายระหว่างทาง (ตัดยอดสูญหาย)', // i18n-key
  DAMAGED: 'เสียหายระหว่างทาง (ตัดยอดชำรุด)', // i18n-key
  WEIGHING_ERROR: 'ชั่งน้ำหนักคลาดเคลื่อน (ปรับยอดรับจริง)', // i18n-key
  WRONG_BRANCH: 'ส่งผิดสาขา (จัดการผ่านส่งผิดสาขา)', // i18n-key
  DISPATCH_WRONG: 'คลังส่งเกินจริง (หักคลังหลักเข้าสาขา)', // i18n-key
  COUNT_ERROR: 'นับผิดเอง (ปรับยอดรับจริง)', // i18n-key
  APPROVED_ADJUSTMENT: 'อนุมัติรับเข้าสต๊อก (รับเข้าสาขา)', // i18n-key
  BELONGS_TO_OTHER_TRANSFER: 'เป็นของใบส่งอื่น', // i18n-key
}
