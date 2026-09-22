import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/Confirm'
import { Icon, type IconName } from '../../components/Icon'
import { SiteChip, SiteSelect } from '../../components/SiteChip'
import { Badge, Button, Card, EmptyState, SearchInput, Select, Spinner, StatusTabs } from '../../components/ui'
import {
  FilterBar,
  FilterField,
  FramePage,
  ItemCell,
  PageHero,
  SectionCard,
  StatRow,
  StatTile,
  StatusChip,
  SummaryList,
  TipCard,
  WithSidePanel,
  frameCard,
} from '../../components/frame'
import { DataTable, type Column } from '../../components/DataTable'
import { useData } from '../../data/DataContext'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { fmtMoney, fmtQty, formatThaiDateShort, formatThaiDateTime } from '../../lib/format'
import { isManager, isReadyForOrder, liveItems, PR_STATUS_KEYS, prBadgeColor } from '../../lib/purchaseRequestStatus'
import { resolveFactor } from '../../lib/inventoryRules/uom'
import { looseMatch } from '../../lib/search'
import { categoryIcon } from '../../lib/categoryIcon'
import { requestCache } from '../../data/requestCache'
import { bkkDayEnd, bkkDayStart } from '../../lib/inventoryRules/time'
import * as S from '../../services/purchaseRequests'
import { UrgencyChip } from './Urgency'
import { URGENCIES, type PurchaseRequest, type PurchaseRequestItem, type PurchaseRequestStatus, type RequestUrgency } from '../../types'

/**
 * Every request of the last month (owner's mock-up 08, spec §2.10).
 *
 * Two ways to read the same requests: by document, as before — a manager lands on what is
 * waiting for them, oldest first — and by line, the mock-up's table of every product asked
 * for, with where it goes, the supplier, how urgent, and who asked. Ticking lines and
 * pressing "สร้างใบสั่งซื้อ" converts the approved requests they belong to, whole: a
 * request is approved as one, so it is ordered as one (the flow the owner kept, 22 Sep).
 */
const DAYS = 30
type Filter = 'all' | 'mine' | 'pendingApproval' | 'returned' | 'approved' | 'rejected' | 'ready' | 'poCreated'
type ViewMode = 'docs' | 'lines'

const OPEN: PurchaseRequestStatus[] = ['draft', 'returned', 'pendingApproval', 'approved']

interface LineRow {
  key: string
  pr: PurchaseRequest
  item: PurchaseRequestItem
  qty: number
  value: number
}

export function PurchaseRequestsPage() {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { products, productById, locations } = useData()
  const [params, setParams] = useSearchParams()
  const manager = isManager(user?.role)
  const [rows, setRows] = useState<PurchaseRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>(() => (params.get('view') === 'lines' ? 'lines' : 'docs'))
  const [search, setSearch] = useState('')
  const [site, setSite] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [urgency, setUrgency] = useState<'' | RequestUrgency>('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  // A manager lands on what is waiting for them — unless nothing is, then on everything.
  const filter =
    (params.get('filter') as Filter) ||
    (manager && rows.some((r) => r.status === 'pendingApproval') ? 'pendingApproval' : 'all')

  const load = useCallback(async (force = false) => {
    setLoading(true)
    try {
      const now = Date.now()
      setRows(await requestCache.fetchRange(bkkDayStart(now) - DAYS * 86_400_000, bkkDayEnd(now) + 86_400_000, { force }))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    void load()
  }, [load])

  // ---- by document ----
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

  // ---- by line ----
  const valueOf = useCallback(
    (i: PurchaseRequestItem, qty: number) => {
      const p = productById(i.productId)
      if (!p?.cost) return 0
      const f = i.entryUnit ? resolveFactor(p, i.entryUnit) : 1
      return f === null ? 0 : qty * f * p.cost
    },
    [productById],
  )

  const allLines = useMemo<LineRow[]>(
    () =>
      rows
        .filter((r) => OPEN.includes(r.status) && r.status !== 'draft')
        .flatMap((pr) =>
          liveItems(pr.items).map((item) => {
            const qty = item.approvedQty ?? item.requestedQty ?? 0
            return { key: `${pr.id}:${item.idx}`, pr, item, qty, value: valueOf(item, qty) }
          }),
        ),
    [rows, valueOf],
  )

  const lines = useMemo(() => {
    const q = search.trim()
    return allLines
      .filter((l) => !site || l.pr.locationId === site)
      .filter((l) => !supplierId || l.item.supplierId === supplierId)
      .filter((l) => !urgency || (l.item.urgency ?? 'normal') === urgency)
      .filter((l) => !q || looseMatch([l.item.productName, l.item.sku, l.item.supplierName, l.pr.docNo, l.pr.requestedByName], q))
      .sort((a, b) => urgencyRank(b.item) - urgencyRank(a.item) || (a.pr.submittedAt ?? a.pr.createdAt) - (b.pr.submittedAt ?? b.pr.createdAt))
  }, [allLines, search, site, supplierId, urgency])

  const supplierOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of allLines) m.set(l.item.supplierId, l.item.supplierName)
    return [...m].sort((a, b) => a[1].localeCompare(b[1]))
  }, [allLines])

  // ---- figures ----
  const openRows = rows.filter((r) => OPEN.includes(r.status))
  const readyCount = rows.filter(isReadyForOrder).length
  const pendingCount = rows.filter((r) => r.status === 'pendingApproval').length
  const urgentLines = allLines.filter((l) => (l.item.urgency ?? 'normal') !== 'normal').length
  const sites = new Set(openRows.map((r) => r.locationId)).size
  const estValue = allLines.reduce((s, l) => s + l.value, 0)
  const uniqueProducts = new Set(allLines.map((l) => l.item.productId)).size
  const topSuppliers = useMemo(() => {
    const m = new Map<string, { name: string; n: number; value: number }>()
    for (const l of allLines) {
      const cur = m.get(l.item.supplierId) ?? { name: l.item.supplierName, n: 0, value: 0 }
      cur.n++
      cur.value += l.value
      m.set(l.item.supplierId, cur)
    }
    return [...m.values()].sort((a, b) => b.n - a.n || b.value - a.value).slice(0, 5)
  }, [allLines])

  // ---- converting ----
  const chosenReady = useMemo(() => {
    const ids = new Set([...selected].map((k) => k.split(':')[0]))
    return rows.filter((r) => ids.has(r.id) && isReadyForOrder(r))
  }, [selected, rows])

  async function convertChosen() {
    if (!user || chosenReady.length === 0) return
    const ok = await confirm({
      title: t('สร้างใบสั่งซื้อ'),
      message: t('สร้างใบสั่งซื้อจาก {n} รายการขอสั่งซื้อที่อนุมัติแล้ว (ทั้งใบ) — กำหนดส่งตาม lead time ของผู้ขาย?', { n: chosenReady.length }),
      confirmText: t('สร้างใบสั่งซื้อ'),
    })
    if (!ok) return
    setBusy(true)
    let made = 0
    try {
      for (const pr of chosenReady) {
        const next = await S.convertToOrders({ id: pr.id, products, actor: { id: user.id, name: user.name, role: user.role } })
        made += next.orders?.length ?? 0
      }
      toast.success(t('สร้างใบสั่งซื้อแล้ว {n} ใบ', { n: made }))
      setSelected(new Set())
      await load(true)
    } catch (e) {
      toast.error(errText(e, t))
      await load(true)
    } finally {
      setBusy(false)
    }
  }

  const lineColumns = useMemo<Column<LineRow>[]>(
    () => [
      {
        key: 'product',
        header: t('สินค้า'),
        primary: true,
        className: 'md:max-w-[190px] 2xl:max-w-[280px]',
        cell: (l) => {
          const p = productById(l.item.productId)
          const look = categoryIcon(p?.category)
          return <ItemCell title={l.item.productName} sub={l.item.sku} productId={l.item.productId} hasImage={!!p?.hasImage} icon={look.icon} tone={look.tone} />
        },
      },
      { key: 'site', header: t('สาขาที่ขอ'), cell: (l) => <SiteChip locationId={l.pr.locationId} /> },
      {
        key: 'qty',
        header: t('จำนวน'),
        card: 'value',
        align: 'right',
        className: 'num whitespace-nowrap font-semibold',
        cell: (l) => (
          <>
            {fmtQty(l.qty)} <span className="text-xs font-normal text-ink-soft">{l.item.entryUnit ?? l.item.unit}</span>
          </>
        ),
      },
      {
        key: 'supplier',
        header: t('ผู้ขาย'),
        cell: (l) => (
          <span className="block min-w-0">
            <span className="block truncate text-ink">{l.item.supplierName}</span>
            {l.item.supplierChoice === 'custom' && <span className="text-xs text-warn">{t('เลือกผู้ขายเอง')}</span>}
          </span>
        ),
      },
      {
        key: 'urgency',
        header: t('ความเร่งด่วน'),
        cell: (l) => <UrgencyChip value={l.item.urgency} />,
      },
      { key: 'by', header: t('ผู้ขอ'), card: 'hidden', className: 'hidden text-ink-soft 2xl:table-cell', headerClassName: 'hidden 2xl:table-cell', cell: (l) => l.pr.requestedByName },
      { key: 'date', header: t('วันที่ขอ'), card: 'hidden', className: 'hidden whitespace-nowrap text-ink-soft 2xl:table-cell', headerClassName: 'hidden 2xl:table-cell', cell: (l) => formatThaiDateShort(l.pr.submittedAt ?? l.pr.createdAt) },
      {
        key: 'status',
        header: t('สถานะ'),
        cell: (l) => (
          <span className="inline-flex flex-col gap-0.5">
            <Badge color={prBadgeColor(l.pr.status)}>{t(PR_STATUS_KEYS[l.pr.status])}</Badge>
            <span className="doc-no text-[11px] text-ink-faint">{l.pr.docNo}</span>
          </span>
        ),
      },
    ],
    [t, productById],
  )

  const heroActions = (
    <Button onClick={() => navigate('/requests/new')}>
      <Icon name="plus" size={16} />
      {t('สร้างรายการขอสั่งซื้อ')}
    </Button>
  )

  return (
    <FramePage>
      <PageHero icon="note" title={t('รายการขอสั่งซื้อ')} subtitle={t('พนักงานขอ → หัวหน้าตรวจและอนุมัติ → สร้างใบสั่งซื้อ → ส่ง LINE')} actions={heroActions} />

      <StatRow columns={4}>
        <StatTile icon="cart" tone="blue" label={t('รอส่งซื้อ')} value={readyCount} unit={t('ใบ')} hint={t('อนุมัติแล้ว ยังไม่สร้าง PO')} onClick={() => { setView('docs'); setParams({ filter: 'ready' }) }} selected={view === 'docs' && filter === 'ready'} />
        <StatTile icon="clock" tone="amber" label={t('รออนุมัติ')} value={pendingCount} unit={t('ใบ')} hint={t('รอหัวหน้าตรวจ')} onClick={() => { setView('docs'); setParams({ filter: 'pendingApproval' }) }} selected={view === 'docs' && filter === 'pendingApproval'} />
        <StatTile icon="alertCircle" tone="red" valueTone={urgentLines ? 'red' : undefined} label={t('ต้องเร่งด่วน')} value={urgentLines} unit={t('รายการ')} hint={t('เร่งด่วน + ด่วนมาก')} onClick={() => { setView('lines'); setUrgency('') }} />
        <StatTile icon="building" tone="purple" label={t('สาขาที่ขอซื้อ')} value={sites} unit={t('สาขา')} hint={t('จากใบที่ยังเปิดอยู่')} />
      </StatRow>

      <div className={`${frameCard} flex flex-wrap items-center gap-2 p-2`} role="radiogroup" aria-label={t('มุมมอง')}>
        {(['docs', 'lines'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={view === v}
            onClick={() => setView(v)}
            className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold sm:flex-none ${view === v ? 'bg-brand text-white' : 'text-ink-soft hover:bg-sunken'}`}
          >
            <Icon name={v === 'docs' ? 'note' : 'list'} size={17} />
            {v === 'docs' ? t('ตามใบขอ') : t('ตามรายการสินค้า')}
          </button>
        ))}
        <button type="button" onClick={() => void load(true)} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-ink-soft hover:bg-sunken">
          <Icon name="refresh" size={16} />
          <span className="hidden sm:inline">{t('โหลดใหม่')}</span>
        </button>
      </div>

      {view === 'docs' ? (
        <>
          <StatusTabs
            items={filters.map((f) => ({ key: f.key, label: f.label, count: f.n, icon: f.icon, tone: f.tone }))}
            value={filter}
            onChange={(k) => setParams({ filter: k })}
          />
          {loading ? (
            <Spinner label={t('กำลังโหลด...')} />
          ) : shown.length === 0 ? (
            <div className={frameCard}>
              <EmptyState icon="note" title={t('ไม่มีรายการในหมวดนี้')} hint={t('กด "สร้างรายการขอสั่งซื้อ" เพื่อเริ่ม')} />
            </div>
          ) : (
            <Card className="divide-y divide-line !rounded-2xl p-0">
              {shown.map((r) => {
                const live = liveItems(r.items)
                const suppliers = new Set(live.map((i) => i.supplierId)).size
                const urgent = live.filter((i) => (i.urgency ?? 'normal') !== 'normal').length
                return (
                  <button key={r.id} type="button" onClick={() => navigate(`/requests/${r.id}`)} className="flex w-full flex-wrap items-center gap-3 p-4 text-left hover:bg-sunken">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="doc-no font-semibold text-ink">{r.docNo}</span>
                        <Badge color={prBadgeColor(r.status)}>{t(PR_STATUS_KEYS[r.status])}</Badge>
                        {r.revision > 1 && <Badge>{t('ครั้งที่ {n}', { n: r.revision })}</Badge>}
                        {live.some((i) => i.supplierChoice === 'custom') && <Badge color="amber">{t('เลือกผู้ขายเอง')}</Badge>}
                        {urgent > 0 && <StatusChip tone="red" size="sm">{t('เร่งด่วน {n} รายการ', { n: urgent })}</StatusChip>}
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
        </>
      ) : (
        <WithSidePanel
          side={
            <>
              <SummaryList
                title={t('สรุป')}
                rows={[
                  { key: 'pending', icon: 'clock', tone: 'amber', label: t('รออนุมัติ'), value: t('{n} ใบ', { n: pendingCount }) },
                  { key: 'ready', icon: 'cart', tone: 'blue', label: t('รอส่งซื้อ'), value: t('{n} ใบ', { n: readyCount }) },
                  { key: 'sites', icon: 'building', tone: 'purple', label: t('สาขาที่ขอ'), value: t('{n} สาขา', { n: sites }) },
                  { key: 'products', icon: 'package', tone: 'green', label: t('สินค้า (ไม่ซ้ำ)'), value: t('{n} รายการ', { n: uniqueProducts }) },
                  { key: 'value', icon: 'chart', tone: 'red', label: t('มูลค่าประมาณการ'), value: `฿ ${fmtMoney(estValue)}`, strong: true }, // i18n-key
                ]}
              />
              <SectionCard icon="users" title={t('ผู้ขายที่มีรายการมากสุด')}>
                {topSuppliers.length === 0 ? (
                  <p className="py-4 text-center text-sm text-ink-faint">{t('ยังไม่มีรายการ')}</p>
                ) : (
                  <ol className="space-y-2.5">
                    {topSuppliers.map((s, i) => (
                      <li key={s.name} className="flex items-center gap-3 text-sm">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? 'bg-brand text-white' : 'bg-sunken text-ink-soft'}`}>{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-ink">{s.name}</span>
                          <span className="text-xs text-ink-faint">{t('{n} รายการ', { n: s.n })}</span>
                        </span>
                        {s.value > 0 && <span className="num text-xs text-ink-soft">฿ {fmtMoney(s.value)}</span> /* i18n-key */}
                      </li>
                    ))}
                  </ol>
                )}
              </SectionCard>
              <TipCard title={t('เคล็ดลับ')}>
                <p>{t('ติ๊กรายการของใบที่อนุมัติแล้ว แล้วกด "สร้างใบสั่งซื้อ" — ระบบแยกใบสั่งตามผู้ขายให้เอง')}</p>
                <p>{t('ความเร่งด่วนแก้ได้ในใบขอ: ผู้ขอตอนร่าง หัวหน้าตอนตรวจ')}</p>
              </TipCard>
            </>
          }
        >
          <FilterBar
            search={<SearchInput value={search} onChange={setSearch} placeholder={t('ค้นหาสินค้า, SKU, ผู้ขาย, เลขที่...')} />}
            onReset={() => {
              setSearch('')
              setSite('')
              setSupplierId('')
              setUrgency('')
            }}
          >
            <FilterField label={t('สาขา')}>
              <SiteSelect value={site} onChange={setSite} locations={locations} emptyLabel={t('ทุกสาขา')} className="w-full" />
            </FilterField>
            <FilterField label={t('ผู้ขาย')}>
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t('ทั้งหมด')}</option>
                {supplierOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label={t('ความเร่งด่วน')}>
              <Select value={urgency} onChange={(e) => setUrgency(e.target.value as '' | RequestUrgency)}>
                <option value="">{t('ทั้งหมด')}</option>
                {URGENCIES.map((u) => (
                  <option key={u.value} value={u.value}>
                    {t(u.label)}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>

          <SectionCard
            icon="list"
            title={t('รายการสินค้าที่ขอ')}
            count={t('({n} รายการ)', { n: lines.length })}
            flush
            actions={
              manager && (
                <Button size="sm" onClick={() => void convertChosen()} disabled={busy || chosenReady.length === 0}>
                  <Icon name="cart" size={16} />
                  {t('สร้างใบสั่งซื้อ ({n} ใบขอ)', { n: chosenReady.length })}
                </Button>
              )
            }
          >
            {loading ? (
              <Spinner />
            ) : (
              <div className="pb-2 md:px-5 md:pb-5">
                <DataTable
                  rows={lines}
                  columns={lineColumns}
                  rowKey={(l) => l.key}
                  minWidth={720}
                  onRowClick={(l) => navigate(`/requests/${l.pr.id}`)}
                  selection={manager ? { selected, onChange: setSelected } : undefined}
                  empty={<EmptyState icon="list" title={t('ไม่มีรายการที่ตรงกับตัวกรอง')} />}
                />
              </div>
            )}
          </SectionCard>
        </WithSidePanel>
      )}
    </FramePage>
  )
}

function urgencyRank(i: PurchaseRequestItem): number {
  return i.urgency === 'critical' ? 2 : i.urgency === 'urgent' ? 1 : 0
}
