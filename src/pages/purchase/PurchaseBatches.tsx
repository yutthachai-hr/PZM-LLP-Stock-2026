import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { Icon } from '../../components/Icon'
import { Badge, Button, Card, EmptyState, PageHeader, SegTab, Spinner } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { formatThaiDateTime } from '../../lib/format'
import { listBatchesInRange, rowState } from '../../services/purchaseBatch'
import type { PurchaseBatch, PurchaseBatchStatus } from '../../types'
import { badgeColor, batchStatusText } from './issues'

/**
 * The imported order lists of the last month, newest first, and the way in to a new one.
 *
 * Also where the manual screen lives from here: "สั่งเอง" goes to the Orders page, which is
 * untouched — an order for one supplier keyed by hand is still the right tool some days.
 */

const DAYS = 30
type Filter = 'all' | 'needsReview' | 'ready' | 'sent' | 'failed'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' }, // i18n-key
  { key: 'needsReview', label: 'ต้องตรวจ' }, // i18n-key
  { key: 'ready', label: 'พร้อม' }, // i18n-key
  { key: 'sent', label: 'ส่งแล้ว' }, // i18n-key
  { key: 'failed', label: 'ค้าง/ไม่สำเร็จ' }, // i18n-key
]

function matches(b: PurchaseBatch, f: Filter): boolean {
  switch (f) {
    case 'all':
      return true
    case 'needsReview':
      return b.status === 'needsReview' || b.status === 'draft'
    case 'ready':
      return b.status === 'ready' || b.status === 'approved'
    case 'sent':
      return b.status === 'completed'
    case 'failed':
      return b.status === 'sending' || b.status === 'cancelled'
  }
}

export function PurchaseBatchesPage() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { locationById } = useData()
  const [params, setParams] = useSearchParams()
  const filter = (params.get('filter') as Filter) || 'all'
  const [batches, setBatches] = useState<PurchaseBatch[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const now = Date.now()
      setBatches(await listBatchesInRange(now - DAYS * 86_400_000, now + 86_400_000))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    void load()
  }, [load])

  const shown = batches.filter((b) => matches(b, filter))

  return (
    <div className="space-y-4">
      <PageHeader
        icon="truck"
        title={t('สั่งซื้ออัตโนมัติ')}
        subtitle={t('นำเข้ารายการสั่งของจาก Excel → ระบบจัดกลุ่มตามผู้ขาย → อนุมัติ → ส่ง LINE ทีละราย')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/orders')}>
              {t('สั่งเอง (ทีละผู้ขาย)')}
            </Button>
            <Button onClick={() => navigate('/purchase/import')}>
              <Icon name="upload" size={16} />
              {t('นำเข้า Excel')}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <SegTab
            key={f.key}
            label={t(f.label)}
            active={filter === f.key}
            onClick={() => setParams(f.key === 'all' ? {} : { filter: f.key })}
            grow={false}
          />
        ))}
      </div>

      {loading ? (
        <Spinner label={t('กำลังโหลด...')} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="upload"
          title={batches.length === 0 ? t('ยังไม่มีชุดนำเข้าใน {days} วันที่ผ่านมา', { days: DAYS }) : t('ไม่มีชุดในหมวดนี้')}
          hint={t('กด "นำเข้า Excel" เพื่อเริ่ม')}
        />
      ) : (
        <Card className="divide-y divide-line p-0">
          {shown.map((b) => {
            const live = b.rows.filter((r) => !r.skipped)
            const review = live.filter((r) => rowState(r) !== 'ready').length
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => navigate(`/purchase/${b.id}`)}
                className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-sunken"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="doc-no font-semibold text-ink">{b.batchNo}</span>
                    <Badge color={badgeColor(b.status as PurchaseBatchStatus)}>{batchStatusText(b.status, t)}</Badge>
                    {review > 0 && b.status !== 'cancelled' && (
                      <Badge color="amber">{t('ต้องตรวจ {n}', { n: review })}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {b.blockLabel} · {locationById(b.locationId)?.name ?? ''} ·{' '}
                    {t('{n} ผู้ขาย · {m} รายการ', { n: b.groups.length, m: live.length })}
                  </div>
                  <div className="text-xs text-ink-faint">
                    {formatThaiDateTime(b.createdAt)} · {b.createdByName} · {b.sourceFileName}
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
