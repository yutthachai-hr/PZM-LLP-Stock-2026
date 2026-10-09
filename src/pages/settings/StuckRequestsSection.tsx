import { useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useConfirm } from '../../components/Confirm'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, SectionHeader } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { repairPlan, type StuckConversion } from '../../lib/requestConversion'
import type { PurchaseOrder } from '../../types'
import { ReasonModal } from '../requests/ReasonModal'

/**
 * Settings → ซ่อมรายการขอสั่งซื้อที่ค้าง (plan A6, 6 Oct 2026).
 *
 * Before A6 a request became its orders one supplier at a time and was marked converted
 * only at the end, so a failure in between left orders pointing at a request that still
 * read "approved" (audit D4). Converting it again would order the same goods twice, so
 * the conversion now refuses and sends the admin here.
 *
 * Nothing is decided for the admin (the plan's rule): each request is shown with its
 * orders, and the admin either links them to it — the conversion takes them over and
 * creates only the suppliers still missing, in one transaction — or cancels an order that
 * should not exist, with a reason, after which the request converts normally. Read on
 * demand, never on opening the page.
 */
export function StuckRequestsSection() {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const { products } = useData()
  const [rows, setRows] = useState<StuckConversion[] | null>(null)
  const [busy, setBusy] = useState('')
  const [cancelling, setCancelling] = useState<PurchaseOrder | null>(null)

  async function check() {
    setBusy('check')
    try {
      const { listStuckConversions } = await import('../../services/purchaseRequests')
      setRows(await listStuckConversions())
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function link(s: StuckConversion) {
    if (!user) return
    const plan = repairPlan(s)
    const kept = s.orders.map((o) => `${o.supplierName}: ${o.docNo}`).join('\n')
    const made = plan.missing.map((g) => g.supplierName).join(', ')
    const ok = await confirm({
      title: t('ผูกใบสั่งซื้อเดิมกับ {docNo}', { docNo: s.request.docNo }),
      message:
        t('ใบสั่งซื้อที่มีอยู่จะถูกนับเป็นของรายการนี้ และรายการจะเปลี่ยนเป็น "สร้างใบสั่งซื้อแล้ว"') +
        '\n\n' +
        kept +
        (made ? '\n\n' + t('จะสร้างใบใหม่ให้ผู้ขายที่ยังไม่มี: {list}', { list: made }) : ''),
      confirmText: t('ผูกใบสั่งซื้อ'),
    })
    if (!ok) return
    setBusy(`link-${s.request.id}`)
    try {
      const { convertToOrders } = await import('../../services/purchaseRequests')
      await convertToOrders({ id: s.request.id, products, actor: { id: user.id, name: user.name, role: user.role }, adopt: plan.adopt })
      toast.success(t('ผูกใบสั่งซื้อกับ {docNo} แล้ว', { docNo: s.request.docNo }))
      await check()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function cancel(order: PurchaseOrder, reason: string) {
    if (!user) return
    try {
      const { cancelPurchaseOrder } = await import('../../services/purchaseOrders')
      await cancelPurchaseOrder({ id: order.id, reason, actor: { id: user.id, name: user.name } })
      toast.success(t('ยกเลิก {docNo} แล้ว', { docNo: order.docNo }))
      setCancelling(null)
      await check()
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  return (
    <Card>
      <SectionHeader
        icon="warning"
        title={t('ซ่อมรายการขอสั่งซื้อที่ค้าง')}
        description={t('รายการที่อนุมัติแล้วแต่มีใบสั่งซื้อค้างจากการสร้างที่ไม่สำเร็จครั้งก่อน เลือกทีละรายการ: ผูกใบเดิมเข้ากับรายการ หรือยกเลิกใบที่ไม่ควรมี ระบบไม่ทำให้เอง')}
        actions={
          <Button variant="secondary" onClick={check} disabled={!!busy}>
            {busy === 'check' ? t('กำลังตรวจ...') : t('ตรวจหารายการที่ค้าง')}
          </Button>
        }
      />
      {rows !== null && rows.length === 0 && <p className="text-sm font-medium text-in">{t('ไม่มีรายการขอสั่งซื้อที่ค้าง')}</p>}
      {rows?.map((s) => {
        const plan = repairPlan(s)
        return (
          <div key={s.request.id} className="mt-3 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{s.request.docNo}</span>
              <Badge color="amber">{t('อนุมัติแล้ว แต่มีใบสั่งซื้อค้าง')}</Badge>
              {s.request.approvedByName && <span className="text-xs text-ink-faint">{t('อนุมัติโดย {name}', { name: s.request.approvedByName })}</span>}
            </div>
            <ul className="mt-2 space-y-1.5">
              {s.orders.map((o) => {
                const cancellable = o.status !== 'received' && !o.receipts?.length
                return (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-ink">{o.docNo}</span>
                    <span className="text-ink-soft">{o.supplierName}</span>
                    <Badge>{o.status === 'received' ? t('รับของแล้ว') : o.status === 'draft' ? t('ร่าง') : t('สั่งแล้ว')}</Badge>
                    {cancellable && (
                      <Button variant="ghost" onClick={() => setCancelling(o)} disabled={!!busy}>
                        {t('ยกเลิกใบนี้')}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
            {plan.blockers.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-danger">
                {plan.blockers.map((b, i) => (
                  <li key={i}>
                    {b.kind === 'duplicate'
                      ? t('{supplier} มีใบสั่งซื้อซ้ำ {list} — ยกเลิกใบที่เกินก่อน', { supplier: b.supplierName, list: b.docNos.join(', ') })
                      : t('{docNo} สั่งจาก {supplier} ซึ่งไม่อยู่ในรายการนี้แล้ว — ยกเลิกใบนี้ก่อน', { docNo: b.docNo, supplier: b.supplierName })}
                  </li>
                ))}
              </ul>
            )}
            {plan.missing.length > 0 && plan.blockers.length === 0 && (
              <p className="mt-2 text-xs text-ink-faint">
                {t('ผู้ขายที่ยังไม่มีใบสั่งซื้อ (จะสร้างให้ตอนผูก): {list}', { list: plan.missing.map((g) => g.supplierName).join(', ') })}
              </p>
            )}
            <div className="mt-3">
              <Button onClick={() => void link(s)} disabled={!!busy || plan.blockers.length > 0}>
                {busy === `link-${s.request.id}` ? t('กำลังบันทึก...') : t('ผูกใบสั่งซื้อเดิมกับรายการนี้')}
              </Button>
            </div>
          </div>
        )
      })}
      {cancelling && (
        <ReasonModal
          title={t('ยกเลิกใบสั่งซื้อ {docNo}', { docNo: cancelling.docNo })}
          message={t('ใบนี้จะยังอยู่ในรายการ "ยกเลิกแล้ว" พร้อมชื่อผู้ยกเลิกและเหตุผล เลขที่จะไม่ถูกนำกลับมาใช้')}
          confirmText={t('ยกเลิกใบสั่งซื้อ')}
          danger
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => cancel(cancelling, reason)}
        />
      )}
    </Card>
  )
}
