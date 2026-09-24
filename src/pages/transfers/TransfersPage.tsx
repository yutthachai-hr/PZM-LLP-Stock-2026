import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { Icon, type IconName } from '../../components/Icon'
import { SiteChip } from '../../components/SiteChip'
import { Button, EmptyState, SearchInput, Select, Spinner } from '../../components/ui'
import {
  FilterBar,
  FilterField,
  FramePage,
  PageHero,
  SectionCard,
  StatRow,
  StatTile,
  StatusChip,
  TipCard,
  WithSidePanel,
} from '../../components/frame'
import { DataTable, type Column } from '../../components/DataTable'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { fmtQty, formatThaiDateShort, formatThaiDateTime } from '../../lib/format'
import { looseMatch } from '../../lib/search'
import { bkkDayEnd, bkkDayStart } from '../../lib/inventoryRules/time'
import { transferCache } from '../../data/transferCache'
import {
  TRANSFER_STATUS_KEYS,
  transferBadgeColor,
} from '../../lib/transferStatus'
import type { Transfer } from '../../types'

const DAYS = 30

type FilterStatus = 'all' | 'pendingApproval' | 'inTransit' | 'discrepancy' | 'completed' | 'cancelled'

export function TransfersPage() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { locations } = useData()
  const [params, setParams] = useSearchParams()

  const [rows, setRows] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [originSite, setOriginSite] = useState('')
  const [destSite, setDestSite] = useState('')

  const filter = (params.get('status') as FilterStatus) || 'all'

  const setFilter = (next: FilterStatus) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'all') p.delete('status')
        else p.set('status', next)
        return p
      },
      { replace: true },
    )
  }

  const load = useCallback(async (force = false) => {
    setLoading(true)
    try {
      const now = Date.now()
      const data = await transferCache.fetchRange(
        bkkDayStart(now) - DAYS * 86_400_000,
        bkkDayEnd(now) + 86_400_000,
        { force },
      )
      setRows(data)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    void load()
    return transferCache.subscribe(() => {
      const now = Date.now()
      const cached = transferCache.peekRange(
        bkkDayStart(now) - DAYS * 86_400_000,
        bkkDayEnd(now) + 86_400_000,
      )
      if (cached) setRows(cached)
    })
  }, [load])

  const locationMap = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const locName = useCallback(
    (id: string) => locationMap.get(id)?.name ?? id,
    [locationMap],
  )

  // Status counters
  const counts = useMemo(() => {
    const res = {
      all: rows.length,
      pendingApproval: 0,
      inTransit: 0,
      discrepancy: 0,
      completed: 0,
      cancelled: 0,
    }
    for (const r of rows) {
      if (r.status === 'pendingApproval') res.pendingApproval++
      else if (r.status === 'inTransit' || r.status === 'receiving') res.inTransit++
      else if (r.status === 'discrepancy' || r.status === 'pendingDiscrepancyApproval' || r.status === 'resolved') res.discrepancy++
      else if (r.status === 'completed') res.completed++
      else if (r.status === 'cancelled') res.cancelled++
    }
    return res
  }, [rows])

  const shown = useMemo(() => {
    return rows.filter((r) => {
      if (filter === 'pendingApproval' && r.status !== 'pendingApproval') return false
      if (filter === 'inTransit' && r.status !== 'inTransit' && r.status !== 'receiving') return false
      if (filter === 'discrepancy' && r.status !== 'discrepancy' && r.status !== 'pendingDiscrepancyApproval' && r.status !== 'resolved') return false
      if (filter === 'completed' && r.status !== 'completed') return false
      if (filter === 'cancelled' && r.status !== 'cancelled') return false

      if (originSite && r.fromLocationId !== originSite) return false
      if (destSite && r.toLocationId !== destSite) return false

      if (search.trim()) {
        const q = search.trim()
        const fields = [
          r.docNo,
          r.requestedByName,
          r.note,
          locName(r.fromLocationId),
          locName(r.toLocationId),
          ...r.items.map((i) => i.productName),
        ]
        if (!looseMatch(fields, q)) return false
      }
      return true
    })
  }, [rows, filter, originSite, destSite, search, locName])

  type FilterTab = { key: FilterStatus; label: string; n: number; icon: IconName }
  const filters: FilterTab[] = [
    { key: 'all', label: t('ทั้งหมด'), n: counts.all, icon: 'swap' },
    { key: 'pendingApproval', label: t('รออนุมัติ'), n: counts.pendingApproval, icon: 'clock' },
    { key: 'inTransit', label: t('ระหว่างขนส่ง'), n: counts.inTransit, icon: 'truck' },
    { key: 'discrepancy', label: t('มีผลต่าง/ปัญหา'), n: counts.discrepancy, icon: 'alertCircle' },
    { key: 'completed', label: t('เสร็จสิ้น'), n: counts.completed, icon: 'checkCircle' },
  ]

  const columns: Column<Transfer>[] = [
    {
      key: 'docNo',
      header: t('เลขที่เอกสาร'),
      primary: true,
      className: 'w-36 font-mono font-medium',
      cell: (r: Transfer) => (
        <div className="space-y-0.5">
          <div className="font-semibold text-ink">{r.docNo}</div>
          <div className="text-xs text-ink-faint">{formatThaiDateShort(r.dispatchDate)}</div>
        </div>
      ),
    },
    {
      key: 'route',
      header: t('เส้นทางขนส่ง'),
      className: 'min-w-[200px]',
      cell: (r: Transfer) => (
        <div className="flex items-center gap-1.5 text-xs md:text-sm">
          <SiteChip locationId={r.fromLocationId} />
          <Icon name="arrowRight" size={14} className="shrink-0 text-ink-faint" />
          <SiteChip locationId={r.toLocationId} />
          {r.legKind && (
            <span className="rounded bg-sunken px-1.5 py-0.5 text-2xs text-ink-soft">
              {r.legKind === 'return' ? t('สายส่งกลับ') : r.legKind === 'forward' ? t('สายส่งต่อ') : t('สายเก็บไว้')}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'items',
      header: t('รายการสินค้า'),
      className: 'min-w-[220px]',
      cell: (r: Transfer) => {
        const first = r.items[0]
        const extra = r.items.length - 1
        return (
          <div className="text-xs md:text-sm">
            <span className="font-medium text-ink">
              {first ? `${first.productName} × ${fmtQty(first.dispatchQty ?? first.requestedQty ?? 0)} ${first.unit}` : '—'}
            </span>
            {extra > 0 && <span className="ml-1 text-ink-soft">{t('และอีก {n} รายการ', { n: extra })}</span>}
          </div>
        )
      },
    },
    {
      key: 'status',
      header: t('สถานะ'),
      card: 'value',
      className: 'w-32',
      cell: (r: Transfer) => (
        <StatusChip tone={transferBadgeColor(r.status)} size="sm">
          {t(TRANSFER_STATUS_KEYS[r.status])}
        </StatusChip>
      ),
    },
    {
      key: 'requestedBy',
      header: t('ผู้ขอ / ผู้ทำรายการ'),
      card: 'meta',
      className: 'w-36 text-xs text-ink-soft',
      cell: (r: Transfer) => (
        <div>
          <div>{r.requestedByName}</div>
          <div className="text-2xs text-ink-faint">{formatThaiDateTime(r.createdAt)}</div>
        </div>
      ),
    },
  ]

  const activeSites = useMemo(() => locations.filter((l) => l.active !== false && l.type !== 'transit'), [locations])

  return (
    <FramePage>
      <PageHero
        icon="swap"
        tone="brand"
        title={t('ขนส่ง/โอนสาขา')}
        subtitle={t('จัดการระบบขนส่งสินค้าระหว่างสาขา ตรวจรับสินค้า และบันทึกผลต่าง')}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/transfers/today')}>
              <Icon name="receive" size={18} />
              {t('ของเข้าวันนี้')}
            </Button>
            <Button onClick={() => navigate('/transfers/new')}>
              <Icon name="plus" size={18} />
              {t('สร้างคำขอโอนสินค้า')}
            </Button>
          </>
        }
      />

      <WithSidePanel
        side={
          <>
            <SectionCard icon="chart" title={t('ภาพรวม 30 วัน')}>
              <StatRow>
                <StatTile
                  icon="clock"
                  tone="amber"
                  label={t('รออนุมัติ')}
                  value={counts.pendingApproval}
                  hint={t('รอหัวหน้าตรวจทาน')}
                />
                <StatTile
                  icon="truck"
                  tone="brand"
                  label={t('ระหว่างขนส่ง')}
                  value={counts.inTransit}
                  hint={t('รอสาขาปลายทางตรวจรับ')}
                />
              </StatRow>
              <StatRow>
                <StatTile
                  icon="alertCircle"
                  tone="red"
                  label={t('มีผลต่าง/ปัญหา')}
                  value={counts.discrepancy}
                  hint={t('ของขาด/เกิน/เสียหาย')}
                />
                <StatTile
                  icon="checkCircle"
                  tone="green"
                  label={t('เสร็จสิ้น')}
                  value={counts.completed}
                  hint={t('ตรวจรับเข้าสต๊อกแล้ว')}
                />
              </StatRow>
            </SectionCard>

            <TipCard title={t('ระบบขนส่งสินค้า')}>
              <ul className="list-disc space-y-1 pl-4">
                <li>{t('การตัดสต๊อกเกิดขึ้นเมื่อหัวหน้า "อนุมัติ" โดยสินค้าจะเข้าสู่คลังระหว่างขนส่ง (Transit)')}</li>
                <li>{t('สาขาปลายทางต้องกด "ตรวจรับสินค้า" เพื่อโอนสต๊อกจาก Transit เข้าสู่สาขาจริง')}</li>
                <li>{t('หากของขาด เกิน หรือเสียหาย ระบบจะบันทึกผลต่างและให้หัวหน้าเลือกวิธีปรับยอด')}</li>
              </ul>
            </TipCard>
          </>
        }
      >
        {/* Status navigation bar */}
        <div className="flex flex-wrap gap-1.5 border-b border-line pb-2">
          {filters.map((f) => {
            const on = f.key === filter
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors md:text-sm ${
                  on
                    ? 'bg-brand text-white shadow-sm'
                    : 'bg-sunken text-ink-soft hover:bg-line/60 hover:text-ink'
                }`}
              >
                <Icon name={f.icon} size={16} />
                <span>{f.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-2xs ${
                    on ? 'bg-white/20 text-white' : 'bg-line text-ink-soft'
                  }`}
                >
                  {f.n}
                </span>
              </button>
            )
          })}
        </div>

        {/* Filter & search bar */}
        <FilterBar>
          <FilterField label={t('ค้นหา')}>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('ค้นหาเลขที่, สินค้า, สาขา...')}
            />
          </FilterField>
          <FilterField label={t('สาขาต้นทาง')}>
            <Select value={originSite} onChange={(e) => setOriginSite(e.target.value)}>
              <option value="">{t('ทุกสาขา')}</option>
              {activeSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label={t('สาขาปลายทาง')}>
            <Select value={destSite} onChange={(e) => setDestSite(e.target.value)}>
              <option value="">{t('ทุกสาขา')}</option>
              {activeSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </FilterField>
        </FilterBar>

        {/* Document table */}
        {loading ? (
          <div className="py-12 text-center">
            <Spinner label={t('กำลังโหลด...')} />
          </div>
        ) : shown.length === 0 ? (
          <div className="space-y-4 py-8 text-center">
            <EmptyState
              icon="swap"
              title={t('ไม่พบรายการโอนสินค้า')}
              hint={search || filter !== 'all' ? t('ลองเปลี่ยนคำค้นหาหรือตัวกรอง') : t('ยังไม่มีการทำรายการโอนสินค้า')}
            />
            <div>
              <Button onClick={() => navigate('/transfers/new')}>
                <Icon name="plus" size={16} />
                {t('สร้างคำขอโอนสินค้า')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <DataTable<Transfer>
              columns={columns}
              rows={shown}
              onRowClick={(r) => navigate(`/transfers/${r.id}`)}
              rowKey={(r) => r.id}
            />
          </div>
        )}
      </WithSidePanel>
    </FramePage>
  )
}
