import type { IconName } from '../../components/Icon'
import type { CalendarItem, CalendarKind, ItemPriority, ItemStatus } from '../../lib/inventoryRules/types'
import type { EventHistoryAction, StockEventStatus, StockEventType } from '../../types'

/**
 * How each kind of calendar item looks: its icon, its name, and the tone of its chip.
 *
 * Colour says one thing per hue and nothing else — blue for a task, green for goods and
 * for done, amber for purchasing and warnings, red for critical, late and out, grey for
 * over or cancelled. The tokens are the app's own; nothing here invents a colour.
 */

// Labels are translation keys, rendered through t() where used. i18n-key
export const KIND_LABEL: Record<CalendarKind, string> = {
  task: 'งาน', // i18n-key
  poExpected: 'รับของ', // i18n-key
  prPending: 'รออนุมัติ', // i18n-key
  cutoff: 'ตัดรอบสั่ง', // i18n-key
  lowStock: 'ใกล้หมด', // i18n-key
  outOfStock: 'หมด', // i18n-key
  stockoutEstimate: 'คาดว่าจะหมด', // i18n-key
  adjustment: 'ปรับสต๊อก', // i18n-key
  waste: 'ของเสีย', // i18n-key
  reorder: 'แนะนำสั่งซื้อ', // i18n-key
}

export const KIND_ICON: Record<CalendarKind, IconName> = {
  task: 'note',
  poExpected: 'truck',
  prPending: 'cart',
  cutoff: 'clock',
  lowStock: 'warning',
  outOfStock: 'alertCircle',
  stockoutEstimate: 'warning',
  adjustment: 'adjust',
  waste: 'trash',
  reorder: 'cart',
}

/** The task types this calendar offers for a new task. Audit and transfer are not modules here. */
export const TASK_TYPES: StockEventType[] = ['stockCount', 'delivery', 'inventoryTask', 'other']

export const TYPE_LABEL: Record<StockEventType, string> = {
  stockCount: 'นับสต๊อก', // i18n-key
  audit: 'ตรวจนับ/ออดิท', // i18n-key
  delivery: 'ของเข้า', // i18n-key
  transfer: 'โอนสาขา', // i18n-key
  inventoryTask: 'งานคลัง', // i18n-key
  other: 'อื่น ๆ', // i18n-key
}

export const TYPE_ICON: Record<StockEventType, IconName> = {
  stockCount: 'checkCircle',
  audit: 'report',
  delivery: 'receive',
  transfer: 'truck',
  inventoryTask: 'note',
  other: 'pin',
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  pending: 'ยังไม่เริ่ม', // i18n-key
  inProgress: 'กำลังทำ', // i18n-key
  waitingApproval: 'รอหัวหน้าตรวจ', // i18n-key
  completed: 'เสร็จแล้ว', // i18n-key
  overdue: 'เกินกำหนด', // i18n-key
  cancelled: 'ยกเลิก', // i18n-key
  info: 'แจ้งเตือน', // i18n-key
}

export const EVENT_STATUS_LABEL: Record<StockEventStatus, string> = {
  upcoming: 'ยังไม่เริ่ม', // i18n-key
  inProgress: 'กำลังทำ', // i18n-key
  waitingApproval: 'รอหัวหน้าตรวจ', // i18n-key
  completed: 'เสร็จแล้ว', // i18n-key
  cancelled: 'ยกเลิก', // i18n-key
}

export const STATUS_COLOR: Record<ItemStatus, 'slate' | 'blue' | 'green' | 'red' | 'amber'> = {
  pending: 'slate',
  inProgress: 'blue',
  waitingApproval: 'amber',
  completed: 'green',
  overdue: 'red',
  cancelled: 'slate',
  info: 'slate',
}

export const PRIORITY_LABEL: Record<ItemPriority, string> = {
  critical: 'ด่วนมาก', // i18n-key
  high: 'สำคัญ', // i18n-key
  medium: 'ปานกลาง', // i18n-key
  normal: 'ปกติ', // i18n-key
}

export const PRIORITY_COLOR: Record<ItemPriority, 'red' | 'amber' | 'blue' | 'slate'> = {
  critical: 'red',
  high: 'amber',
  medium: 'blue',
  normal: 'slate',
}

export const DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] // i18n-key

/** The chip's classes: one tone per meaning, muted once it is over. */
export function chipClass(item: CalendarItem): string {
  if (item.status === 'completed' || item.status === 'cancelled') {
    return `bg-sunken text-ink-faint ${item.status === 'cancelled' ? 'line-through' : ''}`
  }
  if (item.priority === 'critical' || item.status === 'overdue') return 'bg-out-soft text-out'
  switch (item.kind) {
    case 'task':
      return item.priority === 'high' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand'
    case 'poExpected':
      return 'bg-in-soft text-in'
    case 'prPending':
    case 'cutoff':
    case 'reorder':
    case 'adjustment':
      return 'bg-warn-soft text-warn'
    case 'lowStock':
    case 'stockoutEstimate':
      return 'bg-warn-soft text-warn'
    case 'outOfStock':
    case 'waste':
      return 'bg-out-soft text-out'
  }
}

export const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

/** What each step in a task's history is called. */
export const HISTORY_LABEL: Record<EventHistoryAction, string> = {
  created: 'สร้างงาน', // i18n-key
  generated: 'สร้างจากตาราง', // i18n-key
  assigned: 'มอบหมาย', // i18n-key
  started: 'เริ่มทำ', // i18n-key
  completed: 'ทำเสร็จ', // i18n-key
  approved: 'อนุมัติ', // i18n-key
  rescheduled: 'เลื่อนงาน', // i18n-key
  cancelled: 'ยกเลิกงาน', // i18n-key
  edited: 'แก้ไข', // i18n-key
  reopened: 'ส่งกลับให้ทำใหม่', // i18n-key
}
