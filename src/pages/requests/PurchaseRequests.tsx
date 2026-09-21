import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../components/Toast'
import { Icon } from '../../components/Icon'
import { SiteChip } from '../../components/SiteChip'
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, StatusTabs } from '../../components/ui'
import type { IconName } from '../../components/Icon'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { formatThaiDateTime } from '../../lib/format'
import { isManager, isReadyForOrder, liveItems, PR_STATUS_KEYS, prBadgeColor } from '../../lib/purchaseRequestStatus'
import { requestCache } from '../../data/requestCache'
import { bkkDayEnd, bkkDayStart } from '../../lib/inventoryRules/time'
import type { PurchaseRequest, PurchaseRequestStatus } from '../../types'

/**
 * Every request of the last month. A manager sees what is waiting for them first, oldest
 * first — the one that has waited longest is the one to open.
 */
const DAYS = 30
type Filter = 'all' | 'mine' | 'pendingApproval' | 'returned' | 'approved' | 'rejected' | 'ready' | 'poCreated'

export function PurchaseRequestsPage() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const manager = isManager(user?.role)
  const [rows, setRows] = useState<PurchaseRequest[]>([])
  // A manager lands on what is waiting for them — unless nothing is, then on everything.
  const filter =
    (params.get('filter') as Filter) ||
    (manager && rows.some((r) => r.status === 'pendingApproval') ? 'pendingApproval' : 'all')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const now = Date.now()
      setRows(await requestCache.fetchRange(bkkDayStart(now) - DAYS * 86_400_000, bkkDayEnd(now) + 86_400_000))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    void load()
  }, [load])

  type FilterTab = { key: Filter; label: string; n: number; icon: IconName; tone: 'brand' | 'in' | 'out' | 'warn' | 'plain' }
  const filters: FilterTab[] = useMemo(() => {
    const count = (f: (r: PurchaseRequest) => boolean) => rows.filter(f).length
    const list: FilterTab[] = [
      { key: 'all', label: t('ทั้งหมด'), n: rows.length, icon: 'note', tone: 'plain' },
      { key: 'pendingApproval', label: t('รออนุมัติ'), n: count((r) => r.status === 'pendingApproval'), icon: 'clock', tone: 'warn' },
      { key: 'returned', label: t('ส่งกลับให้แก้ไข'), n: count((r) => r.status === 'returned'), icon: 'pencil', tone: 'out' },
      { key: 'ready', label: t('พร้อมสร้าง PO'), n: count(isReadyForOrder), icon: 'check', tone: 'brand' },
      { key: 'poCreated', label: t('สร้างใบสั่งซื้อแล้ว'), n: count((r) => r.status === 'poCreated'), icon: 'checkCircle', tone: 'in' },
      { key: 'rejected', label: t('ไม่อนุมัติ'), n: count((r) => r.status === 'rejected'), icon: 'x', tone: 'plain' },
    ]
    if (user) list.splice(1, 0, { key: 'mine', label: t('ของฉัน'), n: count((r) => r.requestedBy === user.id), icon: 'users', tone: 'plain' })
    return list
  }, [rows, t, user])

  const shown = useMemo(() => {
    const f = filter
    const pick = rows.filter((r) => {
      if (f === 'all') return true
      if (f === 'mine') return r.requestedBy === user?.id
      if (f === 'ready') return isReadyForOrder(r)
      return r.status === (f as PurchaseRequestStatus)
    })
    // Waiting ones oldest first; everything else newest first.
    return f === 'pendingApproval' ? [...pick].sort((a, b) => (a.submittedAt ?? a.createdAt) - (b.submittedAt ?? b.createdAt)) : pick
  }, [rows, filter, user?.id])

  return (
    <div className="space-y-4">
      <PageHeader
        icon="note"
        title={t('รายการขอสั่งซื้อ')}
        subtitle={t('พนักงานขอ → หัวหน้าตรวจและอนุมัติ → สร้างใบสั่งซื้อ → ส่ง LINE')}
        actions={
          <Button onClick={() => navigate('/requests/new')}>
            <Icon name="plus" size={16} />
            {t('สร้างรายการขอสั่งซื้อ')}
          </Button>
        }
      />

      <StatusTabs
        items={filters.map((f) => ({ key: f.key, label: f.label, count: f.n, icon: f.icon, tone: f.tone }))}
        value={filter}
        onChange={(k) => setParams({ filter: k })}
      />

      {loading ? (
        <Spinner label={t('กำลังโหลด...')} />
      ) : shown.length === 0 ? (
        <EmptyState icon="note" title={t('ไม่มีรายการในหมวดนี้')} hint={t('กด "สร้างรายการขอสั่งซื้อ" เพื่อเริ่ม')} />
      ) : (
        <Card className="divide-y divide-line p-0">
          {shown.map((r) => {
            const live = liveItems(r.items)
            const suppliers = new Set(live.map((i) => i.supplierId)).size
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/requests/${r.id}`)}
                className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-sunken"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="doc-no font-semibold text-ink">{r.docNo}</span>
                    <Badge color={prBadgeColor(r.status)}>{t(PR_STATUS_KEYS[r.status])}</Badge>
                    {r.revision > 1 && <Badge>{t('ครั้งที่ {n}', { n: r.revision })}</Badge>}
                    {live.some((i) => i.supplierChoice === 'custom') && <Badge color="amber">{t('เลือกผู้ขายเอง')}</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-ink-soft">
                    <SiteChip locationId={r.locationId} /> · {t('{n} ผู้ขาย · {m} รายการ', { n: suppliers, m: live.length })}
                  </div>
                  <div className="text-xs text-ink-faint">
                    {formatThaiDateTime(r.submittedAt ?? r.createdAt)} · {r.requestedByName}
                    {r.approvedByName ? ` · ${t('อนุมัติโดย')} ${r.approvedByName}` : ''}
                  </div>
                </div>
                <Icon name="arrowRight" size={16} className="shrink-0 text-ink-faint" />
              </button>
            )
          })}
        </Card>
      )}
    </div>
  )
}
