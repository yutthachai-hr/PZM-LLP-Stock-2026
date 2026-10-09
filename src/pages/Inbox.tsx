import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useData } from '../data/DataContext'
import { AlertBanner, Button, EmptyState, Spinner } from '../components/ui'
import { ChipRow, FramePage, PageHero, SectionCard, StatusChip, type Tone } from '../components/frame'
import { Icon } from '../components/Icon'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { formatThaiDateShort } from '../lib/format'
import { INBOX_DETAIL, INBOX_TITLE, inboxItems, type InboxGroup, type InboxItem, type InboxSeverity } from '../lib/exceptionInbox'
import { loadInbox } from '../services/inbox'
import { useSuppliers } from '../services/suppliers'
import { useSupplierIntel } from '../data/useSupplierIntel'

/**
 * The Exception Inbox (plan C3): everything waiting on a หัวหน้า, worst first, one press
 * from the screen that settles it. Read when opened (open records only, by status); the
 * refresh button reads again.
 */

const GROUP_LABEL: Record<InboxGroup | 'all', string> = {
  all: 'ทั้งหมด', // i18n-key
  approve: 'รออนุมัติ', // i18n-key
  stuck: 'ค้าง/ล่าช้า', // i18n-key
  problem: 'มีปัญหา', // i18n-key
}

const SEVERITY: Record<InboxSeverity, { tone: Tone; label: string }> = {
  critical: { tone: 'red', label: 'วิกฤต' }, // i18n-key
  high: { tone: 'amber', label: 'สูง' }, // i18n-key
  medium: { tone: 'blue', label: 'ปานกลาง' }, // i18n-key
}

type Loaded = Awaited<ReturnType<typeof loadInbox>>

export function InboxPage() {
  const t = useT()
  const { user } = useAuth()
  const { locationById } = useData()
  const suppliers = useSuppliers()
  // Phase G10: predicted stock-outs join the decisions (HIGH/CRITICAL, with enough evidence).
  const intel = useSupplierIntel()
  const [rows, setRows] = useState<Loaded | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [group, setGroup] = useState<InboxGroup | 'all'>('all')
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    setBusy(true)
    try {
      setRows(await loadInbox())
      setNow(Date.now())
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const items = useMemo(
    () =>
      rows
        ? inboxItems({
            now,
            ...rows,
            locationName: (id) => (id ? (locationById(id)?.name ?? '') : ''),
            leadTimeOf: (id) => suppliers.find((s) => s.id === id)?.leadTimeDays,
            formatDate: formatThaiDateShort,
            stockouts: intel.stockouts
              .filter((s) => s.prediction && s.prediction.estimatedStockoutDate !== null && (s.prediction.riskLevel === 'HIGH' || s.prediction.riskLevel === 'CRITICAL') && s.meta.dataConfidence !== 'insufficient')
              .map((s) => ({ productId: s.productId, productName: s.productName, locationId: s.locationId, level: s.prediction!.riskLevel as 'HIGH' | 'CRITICAL', date: s.prediction!.estimatedStockoutDate!, shortageQty: s.prediction!.estimatedShortageQty, gapDays: s.prediction!.gapDays })),
          })
        : [],
    [rows, now, locationById, suppliers, intel.stockouts],
  )
  const count = (g: InboxGroup | 'all') => (g === 'all' ? items.length : items.filter((i) => i.group === g).length)
  const shown = group === 'all' ? items : items.filter((i) => i.group === group)

  if (user && user.role === 'staff') return <Navigate to="/" replace />

  return (
    <FramePage>
      <PageHero
        icon="inbox"
        tone="red"
        title={t('งานรอตัดสินใจ')}
        subtitle={t('ทุกเรื่องที่รอหัวหน้าตัดสินใจ เรียงจากเร่งที่สุด')}
        actions={
          <Button variant="secondary" onClick={() => void load()} disabled={busy}>
            <Icon name="refresh" size={16} />
            {t('โหลดใหม่')}
          </Button>
        }
      />
      {error != null && (
        <AlertBanner action={<Button size="sm" variant="secondary" onClick={() => void load()}>{t('ลองใหม่')}</Button>}>
          {t('โหลดงานรอตัดสินใจไม่สำเร็จ: {what}', { what: errText(error, t) })}
        </AlertBanner>
      )}
      <ChipRow
        label={t('กลุ่มงาน')}
        value={group}
        onChange={setGroup}
        chips={(['all', 'approve', 'stuck', 'problem'] as const).map((g) => ({ key: g, label: t(GROUP_LABEL[g]), count: count(g) }))}
      />
      <SectionCard icon="inbox" title={t('รายการ')} count={t('({n} รายการ)', { n: shown.length })} flush>
        {!rows && !error ? (
          <Spinner />
        ) : !shown.length ? (
          <EmptyState icon="checkCircle" title={t('ไม่มีงานค้างให้ตัดสินใจ')} />
        ) : (
          <ul className="divide-y divide-line" aria-label={t('งานรอตัดสินใจ')}>
            {shown.map((item) => (
              <InboxRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </SectionCard>
    </FramePage>
  )
}

function InboxRow({ item }: { item: InboxItem }) {
  const t = useT()
  const sev = SEVERITY[item.severity]
  return (
    <li>
      <Link to={item.link} className="flex items-start gap-3 px-4 py-3 hover:bg-sunken md:px-5">
        <StatusChip tone={sev.tone} size="sm">
          {t(sev.label)}
        </StatusChip>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{t(INBOX_TITLE[item.kind], item.params)}</div>
          <div className="text-xs text-ink-soft">{t(INBOX_DETAIL[item.kind], item.params)}</div>
        </div>
        <div className="shrink-0 text-right text-xs text-ink-faint">
          {t('ตั้งแต่ {date}', { date: formatThaiDateShort(item.since) })}
          <Icon name="chevronRight" size={16} className="ml-auto mt-1 block" />
        </div>
      </Link>
    </li>
  )
}
