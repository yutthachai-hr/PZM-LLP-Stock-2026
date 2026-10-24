import type { PurchaseOrder } from '../../types'
import { confirmationBadge, type BadgeColor } from '../../lib/supplierConfirmation'
import { needsResend } from '../../lib/poRevision'
import { lineStateOf } from './lineStatus'

export type OrderNextAction = 'send' | 'resend' | 'reviewDate' | 'receive' | 'receiveRemaining' | null
export interface OrderPresentation {
  /** The operational fact: overdue, partly received, or the supplier's answer. Never LINE. */
  primary: { label: string; color: BadgeColor; supplier?: boolean }
  secondary: string[]
  urgency: 'normal' | 'attention' | 'urgent'
  nextAction: OrderNextAction
}

/** Presentation only. Action eligibility remains with the existing UI and services. */
export function presentOrderStatus(order: PurchaseOrder, late: boolean): OrderPresentation {
  if (order.status === 'cancelled') return { primary: { label: 'ยกเลิกแล้ว', color: 'slate' }, secondary: [], urgency: 'normal', nextAction: null } // i18n-key
  if (order.status === 'received') return {
    primary: order.closedShortAt !== undefined
      ? { label: 'ปิดยอดค้าง — รับไม่ครบ', color: 'amber' } // i18n-key
      : order.lines.length > 0 && order.lines.every((line) => line.receivedQty !== undefined && line.receivedQty >= line.orderedQty)
        ? { label: 'รับครบแล้ว', color: 'green' } // i18n-key
        : { label: 'รับของแล้ว', color: 'green' }, // i18n-key
    secondary: [], urgency: 'normal', nextAction: null,
  }
  if (order.status === 'draft') return { primary: { label: 'ร่าง — รออนุมัติ', color: 'slate' }, secondary: [], urgency: 'normal', nextAction: null } // i18n-key

  const answer = confirmationBadge(order)
  const supplier = answer && { ...answer, supplier: true }
  const resend = needsResend(order)
  const pending = order.supplierConfirmationStatus === 'pending_date_approval'
  const partial = !!order.receipts?.length
  // Whether LINE has the current sheet is shown by its own badge (lineStatus.ts); the
  // primary stays the operational fact, with overdue the loudest of them.
  const primary: OrderPresentation['primary'] = pending ? supplier!
    : late ? { label: 'เกินกำหนดรับของ', color: 'red' } // i18n-key
    : partial ? { label: 'รับบางส่วน', color: 'amber' } // i18n-key
    : supplier ?? { label: 'สั่งแล้ว', color: 'blue' } // i18n-key
  const secondary = [
    supplier?.label,
    pending ? 'ผู้ขายเสนอเปลี่ยนวันส่ง' : null, // i18n-key
    late ? 'เกินกำหนดรับของ' : null, // i18n-key
    partial ? 'รับบางส่วน' : null, // i18n-key
    resend ? 'ต้องส่ง PO ใหม่' : null, // i18n-key
  ].filter((label): label is string => !!label && label !== primary.label)
  return {
    primary, secondary,
    urgency: resend || pending || late ? 'urgent' : partial || order.supplierConfirmationStatus === 'waiting' ? 'attention' : 'normal',
    nextAction: resend ? 'resend' : pending ? 'reviewDate' : partial ? 'receiveRemaining' : late ? 'receive' : order.shareStatus !== 'sent' ? 'send' : 'receive',
  }
}

export type OrderStateFilter = '' | 'late' | 'sent' | 'unsent' | 'resend' | 'draft' | 'supplierWaiting' | 'datePending'

/** One test per filter, shared by the select, the quick-filter chips and their counts. */
export function matchesStateFilter(order: PurchaseOrder, filter: OrderStateFilter, late: boolean): boolean {
  if (!filter) return true
  if (filter === 'late') return late
  if (filter === 'draft') return order.status === 'draft'
  if (filter === 'supplierWaiting') return order.status === 'ordered' && order.supplierConfirmationStatus === 'waiting'
  if (filter === 'datePending') return order.status === 'ordered' && order.supplierConfirmationStatus === 'pending_date_approval'
  const line = lineStateOf(order)
  if (filter === 'sent') return line === 'sent'
  if (filter === 'resend') return line === 'resend'
  // Not sent to LINE: the current sheet has not gone out. A resend has its own filter.
  return line === 'unsent' || line === 'awaitingConfirm' || line === 'failed' || line === 'skipped'
}

// A date waiting for a manager's decision is first: the supplier is waiting on us (22 Oct 2026).
export const QUICK_FILTERS = ['datePending', 'unsent', 'supplierWaiting', 'resend', 'late'] as const
export type QuickFilter = (typeof QUICK_FILTERS)[number]

/** How many of the given rows each quick filter would show — the rows loaded, not all time. */
export function stateFilterCounts(orders: readonly PurchaseOrder[], isLate: (o: PurchaseOrder) => boolean): Record<QuickFilter, number> {
  const counts = { datePending: 0, unsent: 0, supplierWaiting: 0, resend: 0, late: 0 }
  for (const o of orders) for (const f of QUICK_FILTERS) if (matchesStateFilter(o, f, isLate(o))) counts[f]++
  return counts
}
