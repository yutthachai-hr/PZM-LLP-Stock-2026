import type { Announcement, AnnouncementStatus, Role } from '../types'
import { isManager } from './purchaseRequestStatus'

/**
 * The one place an announcement's status is reasoned about — the same arrangement as
 * lib/purchaseRequestStatus.ts, and the rules' announcementMove() says the same thing.
 *
 *   draft ⇄ ready ──publish──▶ published ──send──▶ sent
 *     │       │                   │  └──(auto, some groups failed)──▶ partiallySent ──▶ sent
 *     └───────┴──────cancel───────┴──▶ cancelled        (published only while nothing was sent)
 *
 * The number is issued by publish, never before: a draft that is thrown away leaves no gap
 * in the sequence. After publishing, the words are frozen (the snapshot); only the send
 * record grows.
 */

const TRANSITIONS: Record<AnnouncementStatus, readonly AnnouncementStatus[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['draft', 'published', 'cancelled'],
  published: ['sent', 'partiallySent', 'cancelled'],
  partiallySent: ['sent'],
  sent: [],
  cancelled: [],
}

export function canMoveAnnouncement(from: AnnouncementStatus, to: AnnouncementStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

// Writing, publishing and sending announcements: หัวหน้า and admin (owner, 24 Sep 2026).
export function canWriteAnnouncements(role: Role | undefined): boolean {
  return isManager(role)
}

/** The words may still change: before a number is issued. */
export function isAnnouncementEditable(status: AnnouncementStatus): boolean {
  return status === 'draft' || status === 'ready'
}

/** Published and not cancelled — it has a number, and it may be sent (again). */
export function isSendable(a: Pick<Announcement, 'status'>): boolean {
  return a.status === 'published' || a.status === 'partiallySent' || a.status === 'sent'
}

/** Cancelling a published announcement is allowed only while nothing has gone out. */
export function isCancellable(a: Pick<Announcement, 'status' | 'sends'>): boolean {
  if (a.status === 'published') return !a.sends.some((s) => s.outcome === 'sent')
  return canMoveAnnouncement(a.status, 'cancelled')
}

export const ANNOUNCEMENT_STATUS_KEYS: Record<AnnouncementStatus, string> = {
  draft: 'ร่าง', // i18n-key
  ready: 'พร้อมเผยแพร่', // i18n-key
  published: 'เผยแพร่แล้ว', // i18n-key
  partiallySent: 'ส่งได้บางกลุ่ม', // i18n-key
  sent: 'ส่งแล้ว', // i18n-key
  cancelled: 'ยกเลิก', // i18n-key
}

export function announcementBadge(status: AnnouncementStatus): 'slate' | 'red' | 'green' | 'amber' | 'blue' {
  switch (status) {
    case 'ready':
      return 'amber'
    case 'published':
      return 'blue'
    case 'partiallySent':
      return 'amber'
    case 'sent':
      return 'green'
    case 'cancelled':
      return 'red'
    default:
      return 'slate'
  }
}
