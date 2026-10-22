import type { PurchaseOrder } from '../../types'
import { needsResend } from '../../lib/poRevision'

/**
 * Where the order's sheet has got to on LINE — one fact, kept apart from the supplier's
 * answer (owner, 17 Oct 2026: the green LINE highlight went missing when it was folded into
 * the status text). Read only from what is stored on the order: `shareStatus`, `sentAt` and
 * the revisions through `needsResend()`. Nothing here says the supplier read or agreed to
 * anything — a personal LINE share cannot know that.
 */
export type LineState = 'sent' | 'unsent' | 'awaitingConfirm' | 'failed' | 'skipped' | 'resend'

/** The LINE state of a placed order; none for a draft, a received or a cancelled one. */
export function lineStateOf(order: PurchaseOrder): LineState | null {
  if (order.status !== 'ordered') return null
  // Amended after it went out: the supplier holds the old sheet, whatever else is true.
  if (needsResend(order)) return 'resend'
  switch (order.shareStatus) {
    case 'sent':
      return 'sent'
    case 'shareOpened':
      return 'awaitingConfirm'
    case 'failed':
      return 'failed'
    case 'skipped':
      return 'skipped'
    default:
      return 'unsent'
  }
}

export const LINE_LABEL: Record<LineState, string> = {
  sent: 'LINE · ส่งแล้ว', // i18n-key
  unsent: 'LINE · ยังไม่ส่ง', // i18n-key
  awaitingConfirm: 'LINE · รอยืนยันส่ง', // i18n-key
  failed: 'LINE · ส่งไม่สำเร็จ', // i18n-key
  skipped: 'ข้ามการส่ง LINE', // i18n-key
  resend: 'LINE · ต้องส่งใหม่', // i18n-key
}
