import type { AppNotification, NotificationKind } from '../types'

/**
 * How a stored notification is shown as it arrives (5 Oct 2026): severity, whether it pops
 * up, which sound, where its buttons go. The stored document is unchanged — this is the
 * one function between it and the popup host, so no component decides any of this itself.
 * Text stays where it was (lib/inventoryRules/copy.ts, by kind).
 */

export type Severity = 'info' | 'success' | 'warning' | 'critical'

export type SoundName = 'success' | 'warning' | 'critical'

/** What the sound settings switch on and off (N6). */
export type SoundCategory = 'supplierConfirmations' | 'dateChanges' | 'deliveryRisks' | 'stockoutRisks' | 'informational'

export type EntityType = 'po' | 'supplier' | 'request' | 'transfer' | 'product' | 'task' | 'none'

export interface NotificationAction {
  /** A t() key. */
  label: string
  url: string
}

export interface PresentedNotification {
  id: string
  type: NotificationKind
  severity: Severity
  /** Shown as a popup when it arrives (always listed in the bell regardless). */
  popup: boolean
  sound: SoundName | null
  soundCategory: SoundCategory
  entityType: EntityType
  entityId: string | null
  /** The primary click. */
  actionUrl: string
  actions: NotificationAction[]
  metadata: Record<string, string | number>
  createdAt: number
}

/** Good news worth a chime: the supplier said yes, or a date was settled. */
const SUCCESS: ReadonlySet<NotificationKind> = new Set<NotificationKind>(['supplierConfirmed', 'supplierDateApproved'])

/** Info-priority kinds that still deserve a popup. */
const INFO_POPUP: ReadonlySet<NotificationKind> = new Set<NotificationKind>(['poArriving', 'transferArriving'])

/** Kinds that are summaries or reminders, not events: listed, never popped. */
const NEVER_POPUP: ReadonlySet<NotificationKind> = new Set<NotificationKind>(['dailyBrief', 'weeklySummary'])

const SOUND_CATEGORY: Partial<Record<NotificationKind, SoundCategory>> = {
  supplierConfirmed: 'supplierConfirmations',
  supplierDateApproved: 'supplierConfirmations',
  supplierDateChanged: 'dateChanges',
  supplierDatePending: 'dateChanges',
  supplierDateRejected: 'dateChanges',
  poDelayed: 'deliveryRisks',
  poArriving: 'informational',
  stockoutSoon: 'stockoutRisks',
  outOfStock: 'stockoutRisks',
  lowStock: 'stockoutRisks',
}

export function severityOf(n: Pick<AppNotification, 'kind' | 'priority'>): Severity {
  if (n.priority === 'critical') return 'critical'
  if (SUCCESS.has(n.kind)) return 'success'
  if (n.priority === 'high' || n.priority === 'medium') return 'warning'
  return 'info'
}

function entityOf(n: AppNotification): { type: EntityType; id: string | null } {
  const po = /[?&]po=([^&]+)/.exec(n.link)?.[1]
  if (po) return { type: 'po', id: decodeURIComponent(po) }
  const req = /^\/requests\/([^/?]+)/.exec(n.link)?.[1]
  if (req) return { type: 'request', id: req }
  const tr = /^\/transfers\/([^/?]+)/.exec(n.link)?.[1]
  if (tr && tr !== 'today' && tr !== 'new') return { type: 'transfer', id: tr }
  if (n.productId) return { type: 'product', id: n.productId }
  if (n.supplierId) return { type: 'supplier', id: n.supplierId }
  if (n.category === 'task') return { type: 'task', id: null }
  return { type: 'none', id: null }
}

const PRIMARY_LABEL: Record<EntityType, string> = {
  po: 'ดูใบสั่งซื้อ', // i18n-key
  supplier: 'ดูผู้ขาย', // i18n-key
  request: 'ดูรายการขอสั่งซื้อ', // i18n-key
  transfer: 'ดูใบโอน', // i18n-key
  product: 'ดูสินค้า', // i18n-key
  task: 'ดูงาน', // i18n-key
  none: 'เปิด', // i18n-key
}

export function presentNotification(n: AppNotification): PresentedNotification {
  const severity = severityOf(n)
  const entity = entityOf(n)
  const actions: NotificationAction[] = [{ label: PRIMARY_LABEL[entity.type], url: n.link }]
  // A supplier's answer: the supplier itself is the next thing people look at.
  if (n.supplierId && entity.type === 'po' && n.category === 'supplier') {
    actions.push({ label: 'ดูผู้ขาย', url: `/suppliers?id=${encodeURIComponent(n.supplierId)}` }) // i18n-key
  }
  const popup = !NEVER_POPUP.has(n.kind) && (severity !== 'info' || INFO_POPUP.has(n.kind))
  return {
    id: n.id,
    type: n.kind,
    severity,
    popup,
    sound: popup && severity !== 'info' ? severity : null,
    soundCategory: SOUND_CATEGORY[n.kind] ?? (severity === 'info' ? 'informational' : 'deliveryRisks'),
    entityType: entity.type,
    entityId: entity.id,
    actionUrl: n.link,
    actions,
    metadata: n.params,
    createdAt: n.createdAt,
  }
}

/** Most severe first — for picking one sound out of a burst. */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, warning: 2, success: 1, info: 0 }
