import { useCallback, useEffect, useMemo, useState } from 'react'
import { SiteSelect } from '../../components/SiteChip'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useConfirm } from '../../components/Confirm'
import { Icon, type IconName } from '../../components/Icon'
import { useToast } from '../../components/Toast'
import { Button, Card, EmptyState, Input, Modal, Select, Spinner } from '../../components/ui'
import { ChipRow, FramePage, PageHero, SectionCard, SeeAll, WithSidePanel, frameCard } from '../../components/frame'
import { useData } from '../../data/DataContext'
import { useCalendarFeed } from '../../data/useCalendarFeed'
import { errText } from '../../i18n/AppError'
import { useI18n } from '../../i18n/I18nContext'
import { formatThaiDateShort } from '../../lib/format'
import { canManageTasks } from '../../lib/inventoryRules/permissions'
import { bkkDayEnd, bkkDayStart, DAY_MS, isSameBkkDay } from '../../lib/inventoryRules/time'
import type { CalendarItem, CalendarKind, ItemPriority, ItemStatus } from '../../lib/inventoryRules/types'
import { looseMatch } from '../../lib/search'
import { assigneesOf, dayBounds, deleteEvent, monthGridBounds, weekBounds } from '../../services/events'
import { useSuppliers } from '../../services/suppliers'
import type { Role, StockEvent } from '../../types'
import { AgendaList } from './AgendaList'
import { KIND_ICON, KIND_LABEL, PRIORITY_LABEL, STATUS_LABEL, chipClass, timeOf } from './chips'
import { CompactMonth } from './CompactMonth'
import { EventEditor } from './EventEditor'
import { ItemDrawer } from './ItemDrawer'
import { ItemRow, itemIcon, itemSubtitle, itemTitle } from './ItemRow'
import { MonthGrid } from './MonthGrid'
import { WeekView } from './WeekView'

/**
 * What has to happen, and when — tasks, deliveries due, requests waiting, supplier
 * cut-offs, and what is running low, on one calendar.
 *
 * Reads: three date-range queries through the session caches in src/data (tasks, orders,
 * requests); everything else is in memory already. Paging back to a month costs nothing,
 * and nothing is subscribed. The summary cards and every filter work on what is loaded.
 */

type View = 'month' | 'week' | 'day' | 'agenda'
type Quick = 'all' | 'today' | 'attention' | 'tasks' | 'purchasing' | 'stock' | 'completed'

const AGENDA_DAYS = 45
const KINDS: CalendarKind[] = ['task', 'poExpected', 'prPending', 'cutoff', 'lowStock', 'outOfStock', 'reorder', 'stockoutEstimate', 'adjustment', 'waste']
const STATUSES: ItemStatus[] = ['pending', 'inProgress', 'waitingApproval', 'completed', 'overdue', 'cancelled']
const PRIORITIES: ItemPriority[] = ['critical', 'high', 'medium', 'normal']

function rangeFor(view: View, anchor: number): { from: number; to: number } {
  if (view === 'month') {
    const d = new Date(anchor)
    return monthGridBounds(d.getFullYear(), d.getMonth())
  }
  if (view === 'week') return weekBounds(anchor)
  if (view === 'day') return dayBounds(anchor)
  const from = bkkDayStart(anchor)
  return { from, to: from + AGENDA_DAYS * DAY_MS - 1 }
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const on = () => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

const isOpen = (i: CalendarItem) => i.status === 'pending' || i.status === 'inProgress' || i.status === 'waitingApproval' || i.status === 'overdue'
const needsAttention = (i: CalendarItem) => i.status === 'overdue' || i.priority === 'critical' || (i.priority === 'high' && isOpen(i))
const isPurchasing = (i: CalendarItem) => i.kind === 'poExpected' || i.kind === 'prPending' || i.kind === 'cutoff'
const isStock = (i: CalendarItem) =>
  i.kind === 'lowStock' || i.kind === 'outOfStock' || i.kind === 'stockoutEstimate' || i.kind === 'reorder' || i.kind === 'adjustment' || i.kind === 'waste'

export function CalendarPage() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const { locations, locationById, productById } = useData()
  const suppliers = useSuppliers()
  const phone = usePhone()
  const [params, setParams] = useSearchParams()
  const canManage = !!user && canManageTasks(user.role as Role)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const [view, setView] = useState<View>(() => (phone ? 'agenda' : 'month'))
  const [anchor, setAnchor] = useState(() => Date.now())
  const [quick, setQuick] = useState<Quick>('all')
  const [kind, setKind] = useState<'' | CalendarKind>('')
  const [status, setStatus] = useState<'' | ItemStatus>('')
  const [priority, setPriority] = useState<'' | ItemPriority>('')
  const [loc, setLoc] = useState('')
  const [supplier, setSupplier] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pickedDay, setPickedDay] = useState<number | null>(null)
  const [editing, setEditing] = useState<StockEvent | null>(null)
  const [creating, setCreating] = useState(false)
  const [newStart, setNewStart] = useState<number | null>(null)
  // On a phone the selects fold behind one button, so the lists come first.
  const [showFilters, setShowFilters] = useState(false)

  // Opened from a dashboard tile: ?filter=today|attention|tasks|purchasing|stock — the
  // list view with that filter on, then the parameter is dropped.
  useEffect(() => {
    const f = params.get('filter') as Quick | null
    const item = params.get('item')
    if (!f && !item) return
    if (f && ['today', 'attention', 'tasks', 'purchasing', 'stock', 'completed'].includes(f)) {
      setQuick(f)
      setView('agenda')
      setAnchor(Date.now())
    }
    if (item) setSelectedId(item)
    setParams({}, { replace: true })
  }, [params, setParams])

  // The phone draws its own month, so it reads the month grid whatever the view says.
  const range = useMemo(() => (phone ? rangeFor('month', anchor) : rangeFor(view, anchor)), [phone, view, anchor])
  const feed = useCalendarFeed(range, now)

  const locationName = useCallback((id?: string) => (id ? locationById(id)?.name : undefined), [locationById])

  const visible = useMemo(() => {
    const q = search.trim()
    return feed.items.filter((i) => {
      if (kind && i.kind !== kind) return false
      if (status && i.status !== status) return false
      if (priority && i.priority !== priority) return false
      if (loc && i.locationId !== loc) return false
      if (supplier && i.supplierId !== supplier) return false
      if (quick === 'today' && !isSameBkkDay(i.at, now)) return false
      if (quick === 'attention' && !needsAttention(i)) return false
      if (quick === 'tasks' && !(i.kind === 'task' && isOpen(i))) return false
      if (quick === 'purchasing' && !isPurchasing(i)) return false
      if (quick === 'stock' && !isStock(i)) return false
      if (quick === 'completed' && !(i.status === 'completed' && i.kind !== 'cutoff')) return false
      if (q) {
        const product = i.productId ? productById(i.productId) : undefined
        const fields = [
          itemTitle(i, t),
          itemSubtitle(i, t, locationName),
          product?.name,
          product?.sku,
          suppliers.find((s) => s.id === i.supplierId)?.name,
          i.meta.kind === 'poExpected' ? i.meta.order.docNo : undefined,
          i.meta.kind === 'prPending' ? i.meta.request.docNo : undefined,
          i.meta.kind === 'task' ? i.meta.event.note : undefined,
        ]
        if (!looseMatch(fields, q)) return false
      }
      return true
    })
  }, [feed.items, kind, status, priority, loc, supplier, quick, search, now, t, locationName, productById, suppliers])

  const counts = useMemo(
    () => ({
      today: feed.items.filter((i) => isSameBkkDay(i.at, now)).length,
      attention: feed.items.filter(needsAttention).length,
      tasks: feed.items.filter((i) => i.kind === 'task' && isOpen(i)).length,
      purchasing: feed.items.filter((i) => isPurchasing(i) && isOpen(i)).length,
      stock: feed.items.filter(isStock).length,
      // A cut-off that has passed is over, not achieved; it does not count as done.
      completed: feed.items.filter((i) => i.status === 'completed' && i.kind !== 'cutoff').length,
    }),
    [feed.items, now],
  )

  const selected = useMemo(() => feed.items.find((i) => i.id === selectedId) ?? null, [feed.items, selectedId])

  function pickQuick(k: Exclude<Quick, 'all'>) {
    if (quick === k) {
      setQuick('all')
      return
    }
    setQuick(k)
    if (!phone) setView('agenda')
  }

  function shift(dir: -1 | 1) {
    const d = new Date(anchor)
    if (view === 'month' || phone) setAnchor(new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime())
    else if (view === 'week') setAnchor(anchor + dir * 7 * DAY_MS)
    else if (view === 'day') setAnchor(anchor + dir * DAY_MS)
    else setAnchor(anchor + dir * AGENDA_DAYS * DAY_MS)
  }

  async function remove(item: CalendarItem) {
    if (item.meta.kind !== 'task') return
    const ok = await confirm({ title: t('ลบงาน'), message: t('ลบ "{title}" ?', { title: item.meta.event.title }), danger: true, confirmText: t('ลบ') })
    if (!ok) return
    try {
      await deleteEvent(item.meta.event.id)
      feed.removeTask(item.meta.event.id)
      setSelectedId(null)
      toast.success(t('ลบแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  const label = useMemo(() => {
    const d = new Date(anchor)
    if (view === 'month' || phone) return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'th-TH', { month: 'long', year: 'numeric' })
    if (view === 'day') return formatThaiDateShort(anchor)
    return `${formatThaiDateShort(range.from)} – ${formatThaiDateShort(range.to)}`
  }, [anchor, view, range, phone, lang])

  const empty = (
    <EmptyState
      icon="calendar"
      title={t('ไม่มีงานในช่วงนี้')}
      hint={quick !== 'all' || kind || status || priority || loc || supplier || search ? t('ลองล้างตัวกรอง') : canManage ? t('กด "เพิ่มงาน" เพื่อสร้าง') : undefined}
    />
  )

  const filtersOn = !!(kind || status || priority || loc || supplier)
  const filterBar = (
    <div className={phone ? 'grid grid-cols-2 gap-2' : 'flex w-full flex-wrap gap-2'}>
      <Select value={kind} onChange={(e) => setKind(e.target.value as '' | CalendarKind)} className="sm:w-36" aria-label={t('ประเภท')}>
        <option value="">{t('ทุกประเภท')}</option>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {t(KIND_LABEL[k])}
          </option>
        ))}
      </Select>
      <Select value={status} onChange={(e) => setStatus(e.target.value as '' | ItemStatus)} className="sm:w-36" aria-label={t('สถานะ')}>
        <option value="">{t('ทุกสถานะ')}</option>
        {STATUSES.map((k) => (
          <option key={k} value={k}>
            {t(STATUS_LABEL[k])}
          </option>
        ))}
      </Select>
      <Select value={priority} onChange={(e) => setPriority(e.target.value as '' | ItemPriority)} className="sm:w-32" aria-label={t('ความสำคัญ')}>
        <option value="">{t('ทุกระดับ')}</option>
        {PRIORITIES.map((k) => (
          <option key={k} value={k}>
            {t(PRIORITY_LABEL[k])}
          </option>
        ))}
      </Select>
      <SiteSelect value={loc} onChange={setLoc} locations={locations} emptyLabel={t('ทุกคลัง')} className="sm:w-36" aria-label={t('คลัง/สาขา')} />
      <Select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="sm:w-40" aria-label={t('ผู้ขาย')}>
        <option value="">{t('ทุกผู้ขาย')}</option>
        {suppliers
          .filter((s) => s.active !== false)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </Select>
      {!phone && <Input placeholder={t('ค้นหา สินค้า / ผู้ขาย / เลขที่…')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:w-52" />}
    </div>
  )

  const drawer = selected && (
    <ItemDrawer
      item={selected}
      orders={feed.orders}
      requests={feed.requests}
      onClose={() => setSelectedId(null)}
      onChanged={feed.patchTask}
      onEdit={(i) => {
        if (i.meta.kind === 'task') setEditing(i.meta.event)
        setSelectedId(null)
      }}
      onDelete={remove}
    />
  )

  const editor = (creating || editing) && user && (
    <EventEditor
      event={editing}
      initialStart={newStart ?? undefined}
      actor={{ id: user.id, name: user.name }}
      onClose={() => {
        setCreating(false)
        setEditing(null)
        setNewStart(null)
      }}
      onSaved={(saved) => feed.patchTask(saved)}
    />
  )

  const dayPanel = pickedDay !== null && (
    <Modal open sheet onClose={() => setPickedDay(null)} title={formatThaiDateShort(pickedDay)}>
      <div className="-mx-5">
        <AgendaList
          items={visible.filter((i) => isSameBkkDay(i.at, pickedDay))}
          now={now}
          onPick={(i) => {
            setPickedDay(null)
            setSelectedId(i.id)
          }}
          empty={<p className="py-6 text-center text-sm text-ink-soft">{t('วันนี้ไม่มีงาน')}</p>}
        />
      </div>
      {canManage && (
        <div className="mt-4 border-t border-line pt-4">
          <Button
            className="w-full"
            onClick={() => {
              setNewStart(pickedDay)
              setPickedDay(null)
              setCreating(true)
            }}
          >
            <Icon name="plus" size={16} />
            {t('เพิ่มงานวันนี้')}
          </Button>
        </div>
      )}
    </Modal>
  )

  const header = (
    <PageHero
      icon="calendar"
      title={t('ปฏิทินคลัง')}
      subtitle={t('ดูแผนงานและกิจกรรมที่เกี่ยวข้องกับคลังสินค้าในแบบรายเดือน')}
      actions={
        canManage && (
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />
            {t('เพิ่มงาน')}
          </Button>
        )
      }
    />
  )

  const errorBox = feed.error ? (
    <Card tone="quiet" className="flex flex-wrap items-center justify-between gap-3 p-4">
      <span className="text-sm text-out">{t('โหลดปฏิทินไม่สำเร็จ: {what}', { what: errText(feed.error, t) })}</span>
      <Button variant="secondary" onClick={() => void feed.reload()}>
        <Icon name="refresh" size={15} />
        {t('ลองอีกครั้ง')}
      </Button>
    </Card>
  ) : null

  // ------------------------------------------------------------------ phone
  if (phone) {
    const mine = (i: CalendarItem) =>
      i.meta.kind === 'task' && isOpen(i) && !!user && (i.meta.event.assignedToAll || assigneesOf(i.meta.event).includes(user.id))
    const upcomingTo = bkkDayEnd(now) + 7 * DAY_MS
    const sections: { key: string; title: string; icon: IconName; rows: CalendarItem[]; tone?: 'out' | 'warn' }[] = [
      { key: 'today', title: t('วันนี้'), icon: 'calendar', rows: visible.filter((i) => isSameBkkDay(i.at, now)) },
      { key: 'attention', title: t('ต้องดูก่อน'), icon: 'warning', tone: 'out', rows: visible.filter((i) => needsAttention(i) && !isSameBkkDay(i.at, now)) },
      { key: 'mine', title: t('งานของฉัน'), icon: 'note', rows: visible.filter(mine) },
      { key: 'upcoming', title: t('7 วันข้างหน้า'), icon: 'arrowRight', rows: visible.filter((i) => i.at > bkkDayEnd(now) && i.at <= upcomingTo && !needsAttention(i)) },
    ]
    return (
      <FramePage>
        {header}
        {errorBox}
        <Card className="space-y-2 p-2">
          <div className="flex gap-2">
            <Input placeholder={t('ค้นหา สินค้า / ผู้ขาย / เลขที่…')} value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-0 flex-1" />
            <Button variant={filtersOn ? 'primary' : 'secondary'} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
              <Icon name="adjust" size={16} />
              {t('ตัวกรอง')}
            </Button>
          </div>
          {showFilters && filterBar}
        </Card>
        {feed.loading ? (
          <Spinner label={t('กำลังโหลดปฏิทิน...')} />
        ) : (
          sections.map((s) => (
            <Card key={s.key} className="overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm font-semibold text-ink">
                <Icon name={s.icon} size={16} className={s.tone === 'out' ? 'text-out' : 'text-ink-faint'} />
                {s.title}
                <span className="num ml-auto text-xs text-ink-faint">{s.rows.length}</span>
              </div>
              {s.rows.length === 0 ? (
                <p className="px-3 py-3 text-sm text-ink-faint">{t('ไม่มี')}</p>
              ) : s.key === 'upcoming' || s.key === 'attention' ? (
                // Rows from several days carry their day as a heading.
                <AgendaList items={s.rows.slice(0, 12)} now={now} onPick={(x) => setSelectedId(x.id)} empty={null} compact />
              ) : (
                <ul className="divide-y divide-line">
                  {s.rows.slice(0, 8).map((i) => (
                    <li key={i.id}>
                      <ItemRow item={i} onPick={(x) => setSelectedId(x.id)} compact />
                    </li>
                  ))}
                  {s.rows.length > 8 && <li className="px-3 py-2 text-xs text-ink-faint">{t('อีก {n} รายการ', { n: s.rows.length - 8 })}</li>}
                </ul>
              )}
            </Card>
          ))
        )}
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <IconButton label={t('ก่อนหน้า')} icon="arrowRight" flip onClick={() => shift(-1)} />
            <span className="text-sm font-semibold text-ink">{label}</span>
            <IconButton label={t('ถัดไป')} icon="arrowRight" onClick={() => shift(1)} />
          </div>
          <CompactMonth anchor={anchor} range={range} items={visible} now={now} onPickDay={setPickedDay} />
        </Card>
        {dayPanel}
        {drawer}
        {editor}
      </FramePage>
    )
  }

  // ---------------------------------------------------------------- desktop
  // The owner's mock-up 05: filters and a colour legend on top, the month as cards, and a
  // column of what is coming and what this month held. The quick filters that used to be
  // six tiles are a row of chips — the dashboard still links straight to each of them.
  const quickChips = [
    { key: 'all' as Quick, label: t('ทั้งหมด') },
    { key: 'today' as Quick, label: t('วันนี้'), count: counts.today },
    { key: 'attention' as Quick, label: t('ต้องดูก่อน'), count: counts.attention },
    { key: 'tasks' as Quick, label: t('งานค้าง'), count: counts.tasks },
    { key: 'purchasing' as Quick, label: t('จัดซื้อ'), count: counts.purchasing },
    { key: 'stock' as Quick, label: t('ใกล้หมด/หมด'), count: counts.stock },
    { key: 'completed' as Quick, label: t('เสร็จแล้ว'), count: counts.completed },
  ]
  const upcoming = feed.items
    .filter((i) => i.at >= bkkDayStart(now) && (isOpen(i) || i.status === 'info') && i.kind !== 'lowStock' && i.kind !== 'outOfStock')
    .sort((x, y) => x.at - y.at)
    .slice(0, 5)
  const monthRange = (() => {
    const d = new Date(anchor)
    const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    return { from, to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1 }
  })()
  const inMonth = visible.filter((i) => i.at >= monthRange.from && i.at <= monthRange.to)
  const byKind = KINDS.map((k) => ({ k, n: inMonth.filter((i) => i.kind === k).length })).filter((x) => x.n > 0)
  const legend: { label: string; cls: string }[] = [
    { label: t('งาน'), cls: 'bg-brand' },
    { label: t('รับของ'), cls: 'bg-in' },
    { label: t('จัดซื้อ / ใกล้หมด'), cls: 'bg-warn' },
    { label: t('หมด / ล่าช้า'), cls: 'bg-out' },
    { label: t('เสร็จแล้ว'), cls: 'bg-line-strong' },
  ]
  const views: { key: View; label: string }[] = [
    { key: 'month', label: t('เดือน') },
    { key: 'week', label: t('สัปดาห์') },
    { key: 'day', label: t('วัน') },
    { key: 'agenda', label: t('รายการ') },
  ]

  return (
    <FramePage>
      {header}
      {errorBox}

      <div className={`${frameCard} space-y-3 p-4`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {filterBar}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <ChipRow<Quick> label={t('ตัวกรองด่วน')} chips={quickChips} value={quick} onChange={(k) => (k === 'all' ? setQuick('all') : pickQuick(k))} />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-label={t('คำอธิบายสี')}>
            {legend.map((l) => (
              <li key={l.label} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${l.cls}`} />
                {l.label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <WithSidePanel
        side={
          <>
            <SectionCard icon="calendar" title={t('งานที่จะมาถึง')} actions={<SeeAll to="/calendar?filter=tasks" />}>
              {upcoming.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-faint">{t('ไม่มีงานที่จะมาถึง')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {upcoming.map((i) => (
                    <li key={i.id}>
                      <button type="button" onClick={() => setSelectedId(i.id)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-sunken">
                        <span className="w-16 shrink-0 text-xs font-semibold text-brand">
                          {isSameBkkDay(i.at, now) ? t('วันนี้') : isSameBkkDay(i.at, now + DAY_MS) ? t('พรุ่งนี้') : formatThaiDateShort(i.at)}
                        </span>
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${chipClass(i)}`}>
                          <Icon name={itemIcon(i)} size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{itemTitle(i, t)}</span>
                          <span className="block truncate text-xs text-ink-faint">
                            {i.allDay ? t('ทั้งวัน') : timeOf(i.at)} · {itemSubtitle(i, t, locationName)}
                          </span>
                        </span>
                        <Icon name="chevronRight" size={16} className="shrink-0 text-ink-faint" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <SectionCard icon="chart" title={t('สรุปกิจกรรมเดือนนี้')}>
              {byKind.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-faint">{t('ไม่มีกิจกรรมในเดือนนี้')}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {byKind.map(({ k, n }) => (
                    <li key={k} className="flex items-center gap-3 py-2">
                      <Icon name={KIND_ICON[k]} size={16} className="text-ink-faint" />
                      <span className="flex-1 text-ink-soft">{t(KIND_LABEL[k])}</span>
                      <span className="num font-semibold text-ink">{t('{n} รายการ', { n })}</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-3 py-2 font-bold text-ink">
                    <span className="w-4 text-center">Σ</span>
                    <span className="flex-1">{t('รวมทั้งหมด')}</span>
                    <span className="num">{t('{n} รายการ', { n: inMonth.length })}</span>
                  </li>
                </ul>
              )}
            </SectionCard>
          </>
        }
      >
        <div className={`${frameCard} overflow-hidden`}>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-line p-3">
            <div className="flex items-center gap-1">
              <IconButton label={t('ก่อนหน้า')} icon="chevronLeft" onClick={() => shift(-1)} />
              <IconButton label={t('ถัดไป')} icon="chevronRight" onClick={() => shift(1)} />
              <button
                type="button"
                onClick={() => setAnchor(Date.now())}
                className="min-h-11 cursor-pointer rounded-lg border border-line px-3 text-sm font-medium text-ink-soft hover:bg-sunken"
              >
                {t('วันนี้')}
              </button>
            </div>
            <span className="min-w-0 truncate text-center text-lg font-bold text-ink md:text-xl">{label}</span>
            <div role="group" aria-label={t('มุมมอง')} className="flex overflow-hidden rounded-lg border border-line">
              {views.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  aria-pressed={view === v.key}
                  onClick={() => setView(v.key)}
                  className={`min-h-11 cursor-pointer px-3 text-sm font-medium ${view === v.key ? 'bg-brand-soft text-brand' : 'bg-surface text-ink-soft hover:bg-sunken'}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {feed.loading ? (
            <div className="p-8">
              <Spinner label={t('กำลังโหลดปฏิทิน...')} />
            </div>
          ) : view === 'month' ? (
            <MonthGrid anchor={anchor} range={range} items={visible} now={now} onPick={(i) => setSelectedId(i.id)} onPickDay={setPickedDay} onShift={shift} />
          ) : view === 'week' ? (
            <WeekView range={range} items={visible} now={now} onPick={(i) => setSelectedId(i.id)} onPickDay={(d) => { setAnchor(d); setView('day') }} />
          ) : (
            <AgendaList items={visible} now={now} onPick={(i) => setSelectedId(i.id)} empty={empty} />
          )}
        </div>
      </WithSidePanel>

      {dayPanel}
      {drawer}
      {editor}
    </FramePage>
  )
}

function IconButton({ label, icon, onClick, flip }: { label: string; icon: IconName; onClick: () => void; flip?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-soft outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <Icon name={icon} size={18} className={flip ? 'rotate-180' : ''} />
    </button>
  )
}
