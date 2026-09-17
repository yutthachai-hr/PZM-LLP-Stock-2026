import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Button, StatGroup, StatTile } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { isManager, isReadyForOrder } from '../../lib/purchaseRequestStatus'
import { requestCache } from '../../data/requestCache'
import { bkkDayEnd, bkkDayStart } from '../../lib/inventoryRules/time'

/**
 * Purchase requests on the dashboard: the last month, by where they stand. A manager's
 * first tile is what is waiting for them; everyone else's is their own drafts and
 * returns. Read once when the dashboard opens through the shared range cache — the
 * Today panel reads a wider window of the same collection, so this is usually free.
 */
const DAYS = 30

export function RequestWidget() {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useAuth()
  const manager = isManager(user?.role)
  const [c, setC] = useState<{ draft: number; pending: number; returned: number; approved: number; rejected: number; ready: number } | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const now = Date.now()
        // Day-aligned bounds, so the cache key is the same all day and a remount is free.
        const rows = await requestCache.fetchRange(bkkDayStart(now) - DAYS * 86_400_000, bkkDayEnd(now) + 86_400_000)
        const mine = (s: string) => rows.filter((r) => r.status === s && (manager || r.requestedBy === user?.id)).length
        if (alive) {
          setC({
            draft: mine('draft'),
            pending: rows.filter((r) => r.status === 'pendingApproval').length,
            returned: mine('returned'),
            approved: rows.filter((r) => r.status === 'approved').length,
            rejected: mine('rejected'),
            ready: rows.filter(isReadyForOrder).length,
          })
        }
      } catch {
        if (alive) setC(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [manager, user?.id])

  if (!c) return null
  const go = (filter: string) => () => navigate(`/requests?filter=${filter}`)

  return (
    <StatGroup
      title={manager ? t('รายการขอสั่งซื้อ — รอตรวจ {n} รายการ', { n: c.pending }) : t('รายการขอสั่งซื้อ')}
      columns={3}
      action={
        <Button variant="ghost" onClick={() => navigate('/requests/new')}>
          {t('สร้างรายการขอสั่งซื้อ')}
        </Button>
      }
    >
      <button type="button" onClick={go('pendingApproval')} className="text-left">
        <StatTile icon="warning" tone={c.pending > 0 ? 'warn' : 'plain'} value={`${c.pending}`} label={t('รออนุมัติ')} />
      </button>
      <button type="button" onClick={go('returned')} className="text-left">
        <StatTile icon="refresh" tone={c.returned > 0 ? 'out' : 'plain'} value={`${c.returned}`} label={t('ส่งกลับให้แก้ไข')} />
      </button>
      <button type="button" onClick={go('ready')} className="text-left">
        <StatTile icon="truck" tone={c.ready > 0 ? 'brand' : 'plain'} value={`${c.ready}`} label={t('พร้อมสร้าง PO')} />
      </button>
      <button type="button" onClick={go('mine')} className="text-left">
        <StatTile icon="note" value={`${c.draft}`} label={t('ร่าง')} />
      </button>
      <button type="button" onClick={go('approved')} className="text-left">
        <StatTile icon="check" tone="in" value={`${c.approved}`} label={t('อนุมัติแล้ว')} />
      </button>
      <button type="button" onClick={go('rejected')} className="text-left">
        <StatTile icon="x" value={`${c.rejected}`} label={t('ไม่อนุมัติ')} />
      </button>
    </StatGroup>
  )
}
