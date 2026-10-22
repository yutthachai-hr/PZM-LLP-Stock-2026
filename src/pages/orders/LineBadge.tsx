import { Icon } from '../../components/Icon'
import { formatThaiDateTime } from '../../lib/format'
import { useT, type TFn } from '../../i18n/I18nContext'
import type { PurchaseOrder } from '../../types'
import { LINE_LABEL, lineStateOf, type LineState } from './lineStatus'

const TONE: Record<LineState, string> = {
  sent: 'bg-chat-soft text-chat ring-chat-ring/50',
  unsent: 'bg-sunken text-ink-soft ring-line-strong',
  awaitingConfirm: 'bg-warn-soft text-warn ring-warn/25',
  failed: 'bg-out-soft text-out ring-out/25',
  skipped: 'bg-surface text-ink-faint ring-line',
  resend: 'bg-out-soft text-out ring-out/40',
}

/** What the badge stands on, in words: when, who, and what it does not claim. */
function lineDetail(order: PurchaseOrder, state: LineState, t: TFn): string {
  const when = (ms?: number) => (ms ? formatThaiDateTime(ms) : '')
  const by = order.sentByName ? t('โดย {name}', { name: order.sentByName }) : ''
  switch (state) {
    case 'sent':
      return [t('ส่งเข้า LINE ล่าสุด {at}', { at: when(order.sentAt) }), by, t('— ยังไม่ได้แปลว่าผู้ขายอ่านหรือยืนยัน')].filter(Boolean).join(' ')
    case 'resend': {
      const last = order.revisions?.[order.revisions.length - 1]
      return t('แก้ไขเป็น Rev.{rev} หลังส่งล่าสุด {at} — ผู้ขายยังมีใบฉบับเก่า', { rev: last?.rev ?? '', at: when(order.sentAt) })
    }
    case 'awaitingConfirm':
      return t('เปิดหน้าแชร์เมื่อ {at} — ยังไม่ได้ยืนยันว่าส่งแล้ว', { at: when(order.shareOpenedAt) })
    case 'failed':
      return t('การส่งเข้า LINE ครั้งล่าสุดไม่สำเร็จ')
    case 'skipped':
      return t('เลือกข้ามการส่งใบนี้ทาง LINE')
    default:
      return t('ยังไม่เคยส่งใบนี้เข้า LINE')
  }
}

/**
 * The order's LINE state as its own badge. The visible text carries the state; the
 * detail (when, by whom) is the tooltip and is read out by screen readers as well.
 * `detailed` also prints the detail under the badge, for the order sheet.
 */
export function LineBadge({ order, detailed = false }: { order: PurchaseOrder; detailed?: boolean }) {
  const t = useT()
  const state = lineStateOf(order)
  if (!state) return null
  const detail = lineDetail(order, state, t)
  const badge = (
    <span
      data-line-state={state}
      title={detail}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${state === 'sent' || state === 'resend' ? 'font-semibold' : 'font-medium'} ${TONE[state]}`}
    >
      <Icon name="message" size={13} />
      {t(LINE_LABEL[state])}
      <span className="sr-only">{`: ${detail}`}</span>
    </span>
  )
  if (!detailed) return badge
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
      {badge}
      <span aria-hidden="true">{detail}</span>
    </div>
  )
}
