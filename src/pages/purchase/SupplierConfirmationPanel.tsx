import { useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { BACKEND_MODE } from '../../backend'
import { useToast } from '../../components/Toast'
import { Icon } from '../../components/Icon'
import { Badge, Button } from '../../components/ui'
import { useT, type TFn } from '../../i18n/I18nContext'
import { formatThaiDate, formatThaiDateTime } from '../../lib/format'
import { confirmationBadge, requestedOf, supplierTimeline } from '../../lib/supplierConfirmation'
import { decideSupplierDate, supplierLink } from '../../services/supplierConfirmation'
import type { PurchaseOrder, SupplierActivity } from '../../types'
import { ReasonModal } from '../requests/ReasonModal'

/**
 * The supplier's answer on an order (5 Oct 2026): the date asked for and the date agreed,
 * a date beyond the range waiting for a หัวหน้า or admin, the supplier's link, and every
 * interaction with the supplier as a timeline. Nothing here writes the order directly —
 * approve/refuse and the link go through the server, the only writer of these fields.
 */
export function SupplierConfirmationPanel({
  order,
  onChanged,
}: {
  order: PurchaseOrder
  onChanged: (order: PurchaseOrder) => void
}) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const badge = confirmationBadge(order)
  const requested = requestedOf(order)
  const pending = order.pendingDeliveryDate
  const canDecide = user?.role === 'admin' || user?.role === 'manager'
  // Approving and the link go through the server, which the browser-storage demo has none of.
  const serverless = BACKEND_MODE === 'local'
  const timeline = supplierTimeline(order)

  if (order.status !== 'ordered' && !timeline.length) return null

  async function decide(decision: 'approve' | 'reject', reason?: string) {
    if (!pending) return
    setBusy(true)
    try {
      const next = await decideSupplierDate(order, pending.changeId, decision, reason)
      onChanged(next)
      toast.success(decision === 'approve' ? t('อนุมัติวันส่งใหม่แล้ว') : t('ไม่อนุมัติวันส่งใหม่แล้ว'))
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      toast.error(code === 'stale' ? t('ผู้ขายเปลี่ยนคำตอบแล้ว — เปิดใบนี้ใหม่') : t('บันทึกไม่สำเร็จ ลองอีกครั้ง'))
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    setBusy(true)
    try {
      const link = await supplierLink(order)
      if (!link) {
        toast.error(t('ยังสร้างลิงก์ผู้ขายไม่ได้ (ระบบยังไม่เปิดใช้ หรือออฟไลน์)'))
        return
      }
      onChanged(link.order)
      await navigator.clipboard.writeText(link.url)
      toast.success(t('คัดลอกลิงก์ยืนยันของผู้ขายแล้ว'))
    } catch {
      toast.error(t('คัดลอกไม่สำเร็จ'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-sunken p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{t('การยืนยันวันส่งของผู้ขาย')}</h3>
        {badge && <Badge color={badge.color}>{t(badge.label)}</Badge>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-ink-faint">{t('วันที่ขอให้ส่ง')}</dt>
        <dd className="num text-ink">{requested !== undefined ? formatThaiDate(requested) : t('ไม่ระบุ')}</dd>
        {order.confirmedDeliveryDate !== undefined && (
          <>
            <dt className="text-ink-faint">{t('วันส่งที่ยืนยัน')}</dt>
            <dd className="num font-semibold text-in">{formatThaiDate(order.confirmedDeliveryDate)}</dd>
          </>
        )}
        {order.supplierConfirmedBy?.name && (
          <>
            <dt className="text-ink-faint">{t('ผู้ยืนยัน')}</dt>
            <dd className="text-ink">{order.supplierConfirmedBy.name}</dd>
          </>
        )}
        {order.supplierDeliveryNote && (
          <>
            <dt className="text-ink-faint">{t('หมายเหตุผู้ขาย')}</dt>
            <dd className="text-ink">{order.supplierDeliveryNote}</dd>
          </>
        )}
      </dl>

      {pending && (
        <div className="rounded-lg border border-out/30 bg-out-soft p-3">
          <p className="font-medium text-out">
            {t('ผู้ขายขอส่งวันที่ {date} — เกินช่วงที่อนุญาต', { date: formatThaiDate(pending.date) })}
          </p>
          {pending.note && <p className="mt-1 text-ink-soft">{pending.note}</p>}
          {serverless ? (
            <p className="mt-1 text-xs text-ink-soft">{t('โหมดสาธิตไม่มีเซิร์ฟเวอร์ — อนุมัติได้ในระบบจริง')}</p>
          ) : canDecide ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="success" disabled={busy} onClick={() => void decide('approve')}>
                <Icon name="check" size={16} />
                {t('อนุมัติวันใหม่')}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
                {t('ไม่อนุมัติ')}
              </Button>
            </div>
          ) : (
            <p className="mt-1 text-xs text-ink-soft">{t('รอหัวหน้าหรือแอดมินอนุมัติ')}</p>
          )}
        </div>
      )}

      {order.status === 'ordered' && !serverless && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void copyLink()}>
          <Icon name="share" size={16} />
          {t('คัดลอกลิงก์ยืนยันของผู้ขาย')}
        </Button>
      )}

      {timeline.length > 0 && (
        <ol className="space-y-1 border-t border-line pt-2">
          {timeline.map((a) => (
            <li key={a.id} className="flex gap-2 text-xs">
              <span className="num shrink-0 text-ink-faint">{formatThaiDateTime(a.at)}</span>
              <span className="text-ink">{describeActivity(a, t)}</span>
            </li>
          ))}
        </ol>
      )}

      {rejecting && (
        <ReasonModal
          title={t('ไม่อนุมัติวันส่งใหม่')}
          message={t('ผู้ขายจะเห็นเหตุผลนี้เมื่อเปิดลิงก์อีกครั้ง')}
          confirmText={t('ไม่อนุมัติ')}
          required
          danger
          onClose={() => setRejecting(false)}
          onConfirm={async (reason) => {
            setRejecting(false)
            await decide('reject', reason)
          }}
        />
      )}
    </div>
  )
}

/** One line of the supplier timeline, in the reader's language. */
export function describeActivity(a: SupplierActivity, t: TFn): string {
  const date = a.date !== undefined ? formatThaiDate(a.date) : ''
  const who = a.byName
  const note = a.note ? ` — ${a.note}` : ''
  switch (a.kind) {
    case 'linkIssued':
      return t('{who} ส่งลิงก์ยืนยันให้ผู้ขาย', { who })
    case 'opened':
      return t('ผู้ขายเปิดลิงก์')
    case 'accepted':
      return t('{who} ยืนยันส่งวันที่ {date}', { who, date }) + note
    case 'autoApplied':
      return t('{who} เปลี่ยนวันส่งเป็น {date}', { who, date }) + note
    case 'pendingApproval':
      return t('{who} ขอเลื่อนส่งเป็น {date} (รออนุมัติ)', { who, date }) + note
    case 'approved':
      return t('{who} อนุมัติวันส่ง {date}', { who, date })
    case 'rejected':
      return t('{who} ไม่อนุมัติวันที่ {date}', { who, date }) + note
    case 'reset':
      return t('ใบสั่งซื้อถูกแก้ไข — ต้องให้ผู้ขายยืนยันใหม่')
    default:
      return ''
  }
}
