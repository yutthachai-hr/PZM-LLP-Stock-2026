import type { PurchaseOrder } from '../../types'
import { confirmationBadge, type BadgeColor } from '../../lib/supplierConfirmation'
import { needsResend } from '../../lib/poRevision'

export type OrderNextAction = 'send' | 'resend' | 'reviewDate' | 'receive' | 'receiveRemaining' | null
export interface OrderPresentation {
  primary: { label: string; color: BadgeColor }
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

  const supplier = confirmationBadge(order)
  const resend = needsResend(order)
  const pending = order.supplierConfirmationStatus === 'pending_date_approval'
  const partial = !!order.receipts?.length
  const primary: OrderPresentation['primary'] = resend
    ? { label: 'ต้องส่ง PO ใหม่', color: 'red' } // i18n-key
    : pending ? supplier!
    : late ? { label: 'เกินกำหนดรับของ', color: 'red' } // i18n-key
    : partial ? { label: 'รับบางส่วน', color: 'amber' } // i18n-key
    : supplier ?? { label: 'สั่งแล้ว', color: 'blue' } // i18n-key
  const secondary = [
    supplier?.label,
    pending ? 'ผู้ขายเสนอเปลี่ยนวันส่ง' : null, // i18n-key
    late ? 'เกินกำหนดรับของ' : null, // i18n-key
    partial ? 'รับบางส่วน' : null, // i18n-key
    !resend && order.shareStatus === 'sent' ? 'ส่งเข้า LINE แล้ว' : null, // i18n-key
  ].filter((label): label is string => !!label && label !== primary.label)
  return {
    primary, secondary,
    urgency: resend || pending || late ? 'urgent' : partial || order.supplierConfirmationStatus === 'waiting' ? 'attention' : 'normal',
    nextAction: resend ? 'resend' : pending ? 'reviewDate' : partial ? 'receiveRemaining' : late ? 'receive' : order.shareStatus !== 'sent' ? 'send' : 'receive',
  }
}
