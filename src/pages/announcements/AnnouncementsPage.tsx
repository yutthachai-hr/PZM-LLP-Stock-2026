import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { BRANDS, type BrandId } from '../../brand/brand'
import { Icon, type IconName } from '../../components/Icon'
import { Badge, Button, Card, EmptyState, SegTab, Spinner, StatusTabs } from '../../components/ui'
import { FramePage, PageHero, frameCard } from '../../components/frame'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { formatThaiDate } from '../../lib/format'
import { bkkDayEnd } from '../../lib/inventoryRules/time'
import { ANNOUNCEMENT_STATUS_KEYS, announcementBadge, canWriteAnnouncements } from '../../lib/announcementStatus'
import { listAnnouncements } from '../../services/announcements'
import type { Announcement, AnnouncementStatus } from '../../types'

/**
 * ประกาศบริษัท — every announcement of the last months, per company.
 *
 * Read once when opened (nothing is subscribed). A หัวหน้า or admin writes and sends them;
 * everyone else may read what the company has told its suppliers.
 */
const DAYS = 180

type Filter = 'all' | 'draft' | 'published' | 'sent' | 'cancelled'

const FILTERS: { key: Filter; label: string; icon: IconName; tone: 'plain' | 'warn' | 'brand' | 'in' | 'out'; match: (s: AnnouncementStatus) => boolean }[] = [
  { key: 'all', label: 'ทั้งหมด', icon: 'list', tone: 'plain', match: () => true }, // i18n-key
  { key: 'draft', label: 'ร่าง / พร้อมเผยแพร่', icon: 'pencil', tone: 'warn', match: (s) => s === 'draft' || s === 'ready' }, // i18n-key
  { key: 'published', label: 'รอส่ง', icon: 'megaphone', tone: 'brand', match: (s) => s === 'published' || s === 'partiallySent' }, // i18n-key
  { key: 'sent', label: 'ส่งแล้ว', icon: 'checkCircle', tone: 'in', match: (s) => s === 'sent' }, // i18n-key
  { key: 'cancelled', label: 'ยกเลิก', icon: 'xCircle', tone: 'out', match: (s) => s === 'cancelled' }, // i18n-key
]

export function AnnouncementsPage() {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { brand } = useBrand()
  const [params, setParams] = useSearchParams()
  const company = (params.get('company') === 'lelapin' || params.get('company') === 'pizza' ? params.get('company') : brand ?? 'pizza') as BrandId
  const filter = (FILTERS.find((f) => f.key === params.get('filter'))?.key ?? 'all') as Filter
  const [rows, setRows] = useState<Announcement[] | null>(null)
  const [error, setError] = useState('')
  const canWrite = canWriteAnnouncements(user?.role)

  const load = useCallback(async () => {
    setRows(null)
    setError('')
    try {
      const to = bkkDayEnd(Date.now())
      setRows(await listAnnouncements(company, to - DAYS * 86_400_000, to))
    } catch (e) {
      setError(errText(e, t))
      setRows([])
    }
  }, [company, t])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!
    return (rows ?? []).filter((r) => f.match(r.status))
  }, [rows, filter])

  const set = (patch: Record<string, string>) => setParams({ company, filter, ...patch })

  return (
    <FramePage>
      <PageHero
        icon="megaphone"
        title={t('ประกาศบริษัท')}
        subtitle={t('ประกาศถึงผู้ขายของ Pizza Mania และ Le Lapin — มีเลขที่เอกสาร ส่งเข้ากลุ่ม LINE และเก็บประวัติการส่ง')}
        actions={
          canWrite ? (
            <Button onClick={() => navigate(`/announcements/new?company=${company}`)}>
              <Icon name="plus" size={16} />
              {t('สร้างประกาศ')}
            </Button>
          ) : undefined
        }
      />

      <div className={`${frameCard} flex gap-1 p-1`} role="group" aria-label={t('บริษัท')}>
        {BRANDS.map((b) => (
          <SegTab key={b.id} label={b.name} active={company === b.id} onClick={() => set({ company: b.id })} />
        ))}
      </div>

      <StatusTabs
        items={FILTERS.map((f) => ({
          key: f.key,
          label: t(f.label),
          icon: f.icon,
          tone: f.tone,
          count: rows ? rows.filter((r) => f.match(r.status)).length : undefined,
        }))}
        value={filter}
        onChange={(k) => set({ filter: k })}
      />

      {rows === null ? (
        <Spinner label={t('กำลังโหลด...')} />
      ) : error ? (
        <div className={frameCard}>
          <EmptyState icon="warning" title={error} />
        </div>
      ) : shown.length === 0 ? (
        <div className={frameCard}>
          <EmptyState icon="megaphone" title={t('ยังไม่มีประกาศในหมวดนี้')} hint={t('ย้อนหลัง {n} วัน', { n: DAYS })} />
        </div>
      ) : (
        <Card className="divide-y divide-line !rounded-2xl p-0">
          {shown.map((a) => (
            <Link
              key={a.id}
              to={`/announcements/${a.company}/${a.id}`}
              className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-sunken"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Icon name={a.format === 'a5' ? 'fileSheet' : 'message'} size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{a.subject}</span>
                <span className="doc-no block text-xs text-ink-faint">
                  {a.docNo ?? t('ยังไม่ออกเลข')} · {formatThaiDate(a.announcementDate)} · {a.format === 'a5' ? 'A5' : t('ข้อความ')} · {a.publisherName}
                </span>
              </span>
              <Badge color={announcementBadge(a.status)}>{t(ANNOUNCEMENT_STATUS_KEYS[a.status])}</Badge>
            </Link>
          ))}
        </Card>
      )}
    </FramePage>
  )
}
