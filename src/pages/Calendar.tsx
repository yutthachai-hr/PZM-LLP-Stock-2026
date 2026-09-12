import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Icon, type IconName } from '../components/Icon'
import { useToast } from '../components/Toast'
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SegTab,
  Select,
  Spinner,
  StatGroup,
  StatTile,
  Textarea,
} from '../components/ui'
import { useData } from '../data/DataContext'
import { fetchRange, hasRange, patchEvent, removeEvent } from '../data/eventCache'
import { errText } from '../i18n/AppError'
import { useT } from '../i18n/I18nContext'
import { formatThaiDateShort } from '../lib/format'
import {
  createEvent,
  dayBounds,
  deleteEvent,
  monthGridBounds,
  setEventStatus,
  updateEvent,
  weekBounds,
  type EventInput,
} from '../services/events'
import type {
  StockEvent,
  StockEventPriority,
  StockEventStatus,
  StockEventType,
} from '../types'

/**
 * What has to happen, and when.
 *
 * ## Reads
 *
 * One query per date range someone actually looks at, cached for the session by
 * src/data/eventCache.ts — so paging to next month and back costs one query, not two.
 * Nothing is subscribed and nothing is loaded while this screen is closed.
 *
 * The summary cards and every filter work on the range already in memory. Tapping one
 * never queries: that is the difference between a filter and a search.
 *
 * Low stock appears here as a single figure, linked to the screen that already shows it.
 * It is derived from balances the app holds anyway, so it costs nothing — and an event
 * document per low product per location would be over a thousand documents that then have
 * to be cleared again.
 */

type View = 'month' | 'week' | 'agenda'
type Quick = 'all' | 'today' | 'upcoming' | 'important' | 'completed'

const AGENDA_DAYS = 45

// Labels are translation keys — rendered through t() where they are used. i18n-key
const TYPE_LABEL: Record<StockEventType, string> = {
  stockCount: 'นับสต๊อก', // i18n-key
  audit: 'ตรวจนับ/ออดิท', // i18n-key
  delivery: 'ของเข้า', // i18n-key
  transfer: 'โอนสาขา', // i18n-key
  inventoryTask: 'งานคลัง', // i18n-key
  other: 'อื่น ๆ', // i18n-key
}

const TYPE_ICON: Record<StockEventType, IconName> = {
  stockCount: 'adjust',
  audit: 'report',
  delivery: 'receive',
  transfer: 'truck',
  inventoryTask: 'note',
  other: 'pin',
}

const STATUS_LABEL: Record<StockEventStatus, string> = {
  upcoming: 'ยังไม่เริ่ม', // i18n-key
  inProgress: 'กำลังทำ', // i18n-key
  completed: 'เสร็จแล้ว', // i18n-key
  cancelled: 'ยกเลิก', // i18n-key
}

const STATUS_COLOR: Record<StockEventStatus, 'slate' | 'blue' | 'green' | 'red'> = {
  upcoming: 'slate',
  inProgress: 'blue',
  completed: 'green',
  cancelled: 'red',
}

const PRIORITY_LABEL: Record<StockEventPriority, string> = {
  normal: 'ปกติ', // i18n-key
  high: 'สำคัญ', // i18n-key
  critical: 'ด่วนมาก', // i18n-key
}

const DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] // i18n-key

const startOfDay = (ms: number) => dayBounds(ms).from
const isSameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b)
const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

/** The range a view needs, so the query and the cache key are the same thing. */
function rangeFor(view: View, anchor: number): { from: number; to: number } {
  if (view === 'month') {
    const d = new Date(anchor)
    return monthGridBounds(d.getFullYear(), d.getMonth())
  }
  if (view === 'week') return weekBounds(anchor)
  const from = startOfDay(anchor)
  return { from, to: from + AGENDA_DAYS * 86_400_000 - 1 }
}

export function CalendarPage() {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const { locations, locationById, products, qtyAt, minFor } = useData()
  const isAdmin = user?.role === 'admin'

  // A phone gets the agenda: a month grid on a 375px screen is 43px-wide cells.
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'agenda' : 'month',
  )
  const [anchor, setAnchor] = useState(() => Date.now())
  const [events, setEvents] = useState<StockEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [quick, setQuick] = useState<Quick>('all')
  const [typeFilter, setTypeFilter] = useState<'' | StockEventType>('')
  const [locFilter, setLocFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<StockEvent | null>(null)
  const [editing, setEditing] = useState<StockEvent | null>(null)
  const [creating, setCreating] = useState(false)
  const [today, setToday] = useState<StockEvent[]>([])

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor])

  const load = useCallback(
    async (force = false) => {
      // Only show the spinner when the range has never been read — a cached month should
      // appear instantly rather than flashing.
      if (!hasRange(range.from, range.to)) setLoading(true)
      try {
        setEvents(await fetchRange(range.from, range.to, { force }))
      } catch (e) {
        toast.error(errText(e, t))
      } finally {
        setLoading(false)
      }
    },
    [range.from, range.to, toast, t],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Today, separately and once: the Today panel has to be right even while someone is
  // looking at next month, and the same cached range answers the sidebar's badge.
  useEffect(() => {
    const { from, to } = dayBounds(Date.now())
    fetchRange(from, to)
      .then(setToday)
      .catch(() => setToday([]))
  }, [])

  const refreshToday = useCallback(() => {
    const { from, to } = dayBounds(Date.now())
    fetchRange(from, to).then(setToday).catch(noop)
  }, [])

  const lowStockCount = useMemo(() => {
    let n = 0
    for (const p of products) {
      for (const l of locations) {
        const min = minFor(p, l.id)
        if (min > 0 && qtyAt(l.id, p.id) <= min) n++
      }
    }
    return n
  }, [products, locations, qtyAt, minFor])

  const counts = useMemo(() => {
    const now = Date.now()
    const open = (e: StockEvent) => e.status === 'upcoming' || e.status === 'inProgress'
    return {
      today: events.filter((e) => isSameDay(e.startAt, now)).length,
      upcoming: events.filter((e) => open(e) && e.startAt >= startOfDay(now)).length,
      important: events.filter((e) => open(e) && e.priority !== 'normal').length,
      completed: events.filter((e) => e.status === 'completed').length,
    }
  }, [events])

  const visible = useMemo(() => {
    const now = Date.now()
    const open = (e: StockEvent) => e.status === 'upcoming' || e.status === 'inProgress'
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false
      if (locFilter && e.locationId !== locFilter) return false
      if (quick === 'today' && !isSameDay(e.startAt, now)) return false
      if (quick === 'upcoming' && !(open(e) && e.startAt >= startOfDay(now))) return false
      if (quick === 'important' && !(open(e) && e.priority !== 'normal')) return false
      if (quick === 'completed' && e.status !== 'completed') return false
      if (q && !e.title.toLowerCase().includes(q) && !(e.note ?? '').toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [events, typeFilter, locFilter, quick, search])

  function shift(dir: -1 | 1) {
    const d = new Date(anchor)
    if (view === 'month') setAnchor(new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime())
    else if (view === 'week') setAnchor(anchor + dir * 7 * 86_400_000)
    else setAnchor(anchor + dir * AGENDA_DAYS * 86_400_000)
  }

  async function move(event: StockEvent, status: StockEventStatus) {
    try {
      await setEventStatus(event.id, status)
      const next = { ...event, status, updatedAt: Date.now() }
      // Patch in place rather than re-reading the month for one changed row.
      patchEvent(next)
      setEvents((cur) => cur.map((e) => (e.id === next.id ? next : e)))
      setToday((cur) => cur.map((e) => (e.id === next.id ? next : e)))
      setSelected(next)
      toast.success(t('บันทึกแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  async function remove(event: StockEvent) {
    try {
      await deleteEvent(event.id)
      removeEvent(event.id)
      setEvents((cur) => cur.filter((e) => e.id !== event.id))
      setToday((cur) => cur.filter((e) => e.id !== event.id))
      setSelected(null)
      toast.success(t('ลบแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  const label = useMemo(() => {
    const d = new Date(anchor)
    if (view === 'month') {
      return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
    }
    const { from, to } = range
    return `${formatThaiDateShort(from)} – ${formatThaiDateShort(to)}`
  }, [anchor, view, range])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          icon="calendar"
          title={t('ปฏิทินคลัง')}
          subtitle={t('งานที่ต้องทำ ของที่จะเข้า และการนับสต๊อก')}
        />
        {isAdmin && (
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />
            {t('เพิ่มงาน')}
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <StatGroup title={t('สรุปช่วงที่ดูอยู่')}>
            <SummaryTile
              icon="history"
              active={quick === 'today'}
              onClick={() => setQuick(quick === 'today' ? 'all' : 'today')}
              value={counts.today}
              label={t('วันนี้')}
            />
            <SummaryTile
              icon="arrowRight"
              active={quick === 'upcoming'}
              onClick={() => setQuick(quick === 'upcoming' ? 'all' : 'upcoming')}
              value={counts.upcoming}
              label={t('ที่จะถึง')}
            />
            <SummaryTile
              icon="warning"
              tone="warn"
              active={quick === 'important'}
              onClick={() => setQuick(quick === 'important' ? 'all' : 'important')}
              value={counts.important}
              label={t('สำคัญ')}
            />
            <SummaryTile
              icon="check"
              tone="in"
              active={quick === 'completed'}
              onClick={() => setQuick(quick === 'completed' ? 'all' : 'completed')}
              value={counts.completed}
              label={t('เสร็จแล้ว')}
            />
          </StatGroup>
        </div>

        <Card className="flex flex-col p-4">
          <CardTitle
            title={t('วันนี้')}
            className="mb-3"
            action={<span className="text-xs text-ink-faint">{formatThaiDateShort(Date.now())}</span>}
          />
          {today.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-soft">{t('วันนี้ไม่มีงาน')}</p>
          ) : (
            <ul className="-mx-1 max-h-[220px] divide-y divide-line overflow-auto">
              {today.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => setSelected(e)}
                    className="flex w-full items-center gap-2 px-1 py-2 text-left hover:bg-sunken"
                  >
                    <span className="num w-12 shrink-0 text-xs font-semibold text-ink-soft">
                      {timeOf(e.startAt)}
                    </span>
                    <Icon name={TYPE_ICON[e.type]} size={15} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.title}</span>
                    <Badge color={STATUS_COLOR[e.status]}>{t(STATUS_LABEL[e.status])}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/"
            className="mt-3 flex items-center justify-between rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn hover:bg-warn-soft/70"
          >
            <span className="flex items-center gap-2">
              <Icon name="warning" size={15} />
              {t('ของใกล้หมด')}
            </span>
            <span className="num font-bold">{lowStockCount}</span>
          </Link>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="flex gap-1 rounded-lg bg-sunken p-1">
            <SegTab grow={false} label={t('เดือน')} active={view === 'month'} onClick={() => setView('month')} />
            <SegTab grow={false} label={t('สัปดาห์')} active={view === 'week'} onClick={() => setView('week')} />
            <SegTab grow={false} label={t('รายการ')} active={view === 'agenda'} onClick={() => setView('agenda')} />
          </div>

          <div className="flex items-center gap-1">
            <IconButton label={t('ก่อนหน้า')} icon="arrowRight" flip onClick={() => shift(-1)} />
            <button
              onClick={() => setAnchor(Date.now())}
              className="min-h-11 cursor-pointer rounded-lg px-3 text-sm font-medium text-ink-soft hover:bg-sunken"
            >
              {t('วันนี้')}
            </button>
            <IconButton label={t('ถัดไป')} icon="arrowRight" onClick={() => shift(1)} />
          </div>

          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{label}</span>

          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as '' | StockEventType)}
              className="sm:w-40"
            >
              <option value="">{t('ทุกประเภท')}</option>
              {(Object.keys(TYPE_LABEL) as StockEventType[]).map((k) => (
                <option key={k} value={k}>
                  {t(TYPE_LABEL[k])}
                </option>
              ))}
            </Select>
            <Select
              value={locFilter}
              onChange={(e) => setLocFilter(e.target.value)}
              className="sm:w-40"
            >
              <option value="">{t('ทุกคลัง')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            <Input
              placeholder={t('ค้นหางาน…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:w-44"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8">
            <Spinner label={t('กำลังโหลดปฏิทิน...')} />
          </div>
        ) : view === 'month' ? (
          <MonthGrid
            anchor={anchor}
            range={range}
            events={visible}
            onPick={setSelected}
            onPickDay={(ms) => {
              setAnchor(ms)
              setView('agenda')
            }}
          />
        ) : (
          <AgendaList
            events={visible}
            locationName={(id) => (id ? locationById(id)?.name : undefined)}
            onPick={setSelected}
            empty={
              <EmptyState
                icon="calendar"
                title={t('ไม่มีงานในช่วงนี้')}
                hint={isAdmin ? t('กด "เพิ่มงาน" เพื่อสร้าง') : undefined}
              />
            }
          />
        )}
      </Card>

      {selected && (
        <EventDrawer
          event={selected}
          locationName={selected.locationId ? locationById(selected.locationId)?.name : undefined}
          canEdit={!!isAdmin}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected)
            setSelected(null)
          }}
          onMove={move}
          onDelete={remove}
        />
      )}

      {(creating || editing) && user && (
        <EventEditor
          event={editing}
          userId={user.id}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={(saved) => {
            patchEvent(saved)
            void load(true)
            refreshToday()
          }}
        />
      )}
    </div>
  )
}

function noop() {}

// ---------------------------------------------------------------- pieces

function IconButton({
  label,
  icon,
  onClick,
  flip,
}: {
  label: string
  icon: IconName
  onClick: () => void
  flip?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-soft outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <Icon name={icon} size={18} className={flip ? 'rotate-180' : ''} />
    </button>
  )
}

function SummaryTile({
  icon,
  value,
  label,
  tone,
  active,
  onClick,
}: {
  icon: IconName
  value: number
  label: string
  tone?: 'warn' | 'in'
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
        active ? 'bg-brand-soft ring-1 ring-brand/30' : 'hover:bg-sunken'
      }`}
    >
      <StatTile icon={icon} value={`${value}`} label={label} tone={tone} />
    </button>
  )
}

function MonthGrid({
  anchor,
  range,
  events,
  onPick,
  onPickDay,
}: {
  anchor: number
  range: { from: number; to: number }
  events: StockEvent[]
  onPick: (e: StockEvent) => void
  onPickDay: (ms: number) => void
}) {
  const t = useT()
  const month = new Date(anchor).getMonth()
  const days = useMemo(() => {
    const out: number[] = []
    for (let d = range.from; d <= range.to; d += 86_400_000) out.push(startOfDay(d))
    return out
  }, [range.from, range.to])

  const byDay = useMemo(() => {
    const map = new Map<number, StockEvent[]>()
    for (const e of events) {
      const k = startOfDay(e.startAt)
      const list = map.get(k)
      if (list) list.push(e)
      else map.set(k, [e])
    }
    return map
  }, [events])

  const todayKey = startOfDay(Date.now())

  return (
    // A month grid needs seven columns at any width; below sm it scrolls sideways rather
    // than squeezing a day into 43px. The agenda is the phone default for this reason.
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-line bg-sunken text-center text-xs font-medium uppercase text-ink-soft">
          {DAY_NAMES.map((d) => (
            <div key={d} className="px-1 py-2">
              {t(d)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const list = byDay.get(day) ?? []
            const outside = new Date(day).getMonth() !== month
            return (
              <div
                key={day}
                className={`min-h-24 border-b border-r border-line p-1 last:border-r-0 ${
                  outside ? 'bg-sunken/50' : ''
                } ${day === todayKey ? 'bg-brand-soft/40' : ''}`}
              >
                <button
                  onClick={() => onPickDay(day)}
                  className={`num mb-1 block rounded px-1 text-xs hover:bg-sunken ${
                    day === todayKey
                      ? 'font-bold text-brand'
                      : outside
                        ? 'text-ink-faint'
                        : 'text-ink-soft'
                  }`}
                >
                  {new Date(day).getDate()}
                </button>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onPick(e)}
                      title={e.title}
                      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight hover:brightness-95 ${
                        e.status === 'completed'
                          ? 'bg-in-soft text-in'
                          : e.status === 'cancelled'
                            ? 'bg-sunken text-ink-faint line-through'
                            : e.priority === 'critical'
                              ? 'bg-out-soft text-out'
                              : e.priority === 'high'
                                ? 'bg-warn-soft text-warn'
                                : 'bg-sunken text-ink-soft'
                      }`}
                    >
                      <Icon name={TYPE_ICON[e.type]} size={11} />
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                    </button>
                  ))}
                  {list.length > 3 && (
                    <button
                      onClick={() => onPickDay(day)}
                      className="px-1 text-[11px] text-ink-faint hover:underline"
                    >
                      {t('อีก {n} งาน', { n: list.length - 3 })}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AgendaList({
  events,
  locationName,
  onPick,
  empty,
}: {
  events: StockEvent[]
  locationName: (id?: string) => string | undefined
  onPick: (e: StockEvent) => void
  empty: React.ReactNode
}) {
  const t = useT()
  if (events.length === 0) return <>{empty}</>

  const groups: { day: number; rows: StockEvent[] }[] = []
  for (const e of events) {
    const day = startOfDay(e.startAt)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(e)
    else groups.push({ day, rows: [e] })
  }

  return (
    <div className="divide-y divide-line">
      {groups.map(({ day, rows }) => (
        <div key={day}>
          <div className="flex items-center gap-2 bg-sunken px-3 py-1.5 text-xs font-medium text-ink-soft">
            {formatThaiDateShort(day)}
            {day === startOfDay(Date.now()) && <Badge color="blue">{t('วันนี้')}</Badge>}
          </div>
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => onPick(e)}
                  className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-sunken"
                >
                  <span className="num w-12 shrink-0 pt-0.5 text-xs font-semibold text-ink-soft">
                    {timeOf(e.startAt)}
                  </span>
                  <Icon name={TYPE_ICON[e.type]} size={16} className="mt-0.5 shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{e.title}</span>
                    <span className="block truncate text-xs text-ink-faint">
                      {t(TYPE_LABEL[e.type])}
                      {e.locationId && ` · ${locationName(e.locationId) ?? ''}`}
                      {e.assignedToName && ` · ${e.assignedToName}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge color={STATUS_COLOR[e.status]}>{t(STATUS_LABEL[e.status])}</Badge>
                    {e.priority !== 'normal' && (
                      <Badge color={e.priority === 'critical' ? 'red' : 'amber'}>
                        {t(PRIORITY_LABEL[e.priority])}
                      </Badge>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function EventDrawer({
  event,
  locationName,
  canEdit,
  onClose,
  onEdit,
  onMove,
  onDelete,
}: {
  event: StockEvent
  locationName?: string
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
  onMove: (e: StockEvent, s: StockEventStatus) => Promise<void>
  onDelete: (e: StockEvent) => Promise<void>
}) {
  const t = useT()
  const open = event.status === 'upcoming' || event.status === 'inProgress'

  return (
    <Modal open side onClose={onClose} title={event.title}>
      <dl className="space-y-3 text-sm">
        <Row label={t('ประเภท')}>
          <span className="flex items-center gap-1.5">
            <Icon name={TYPE_ICON[event.type]} size={15} className="text-ink-faint" />
            {t(TYPE_LABEL[event.type])}
          </span>
        </Row>
        <Row label={t('สถานะ')}>
          <Badge color={STATUS_COLOR[event.status]}>{t(STATUS_LABEL[event.status])}</Badge>
        </Row>
        <Row label={t('ความสำคัญ')}>
          {event.priority === 'normal' ? (
            <span className="text-ink-soft">{t(PRIORITY_LABEL.normal)}</span>
          ) : (
            <Badge color={event.priority === 'critical' ? 'red' : 'amber'}>
              {t(PRIORITY_LABEL[event.priority])}
            </Badge>
          )}
        </Row>
        <Row label={t('วันเวลา')}>
          {formatThaiDateShort(event.startAt)} {timeOf(event.startAt)}
        </Row>
        {event.dueAt !== undefined && (
          <Row label={t('กำหนดเสร็จ')}>
            {formatThaiDateShort(event.dueAt)} {timeOf(event.dueAt)}
          </Row>
        )}
        <Row label={t('คลัง/สาขา')}>{locationName ?? <Muted>{t('ไม่ระบุ')}</Muted>}</Row>
        <Row label={t('ผู้รับผิดชอบ')}>
          {event.assignedToName ?? <Muted>{t('ยังไม่มอบหมาย')}</Muted>}
        </Row>
        <Row label={t('หมายเหตุ')}>
          {event.note ? (
            <span className="whitespace-pre-line">{event.note}</span>
          ) : (
            <Muted>{t('ไม่มี')}</Muted>
          )}
        </Row>
      </dl>

      <div className="mt-6 space-y-2 border-t border-line pt-4">
        {open && (
          <div className="flex flex-wrap gap-2">
            {event.status === 'upcoming' && (
              <Button variant="secondary" onClick={() => void onMove(event, 'inProgress')}>
                <Icon name="arrowRight" size={15} />
                {t('เริ่มทำ')}
              </Button>
            )}
            <Button variant="success" onClick={() => void onMove(event, 'completed')}>
              <Icon name="check" size={15} />
              {t('ทำเสร็จแล้ว')}
            </Button>
          </div>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onEdit}>
              <Icon name="pencil" size={15} />
              {t('แก้ไข')}
            </Button>
            {open && (
              <Button variant="secondary" onClick={() => void onMove(event, 'cancelled')}>
                {t('ยกเลิกงาน')}
              </Button>
            )}
            <Button variant="danger" onClick={() => void onDelete(event)}>
              <Icon name="trash" size={15} />
              {t('ลบ')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-2">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-ink-faint">{children}</span>
}

// ---------------------------------------------------------------- editor

function toDateInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function toTimeInput(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function fromInputs(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (time || '09:00').split(':').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 9, mm ?? 0).getTime()
}

function EventEditor({
  event,
  userId,
  onClose,
  onSaved,
}: {
  event: StockEvent | null
  userId: string
  onClose: () => void
  onSaved: (saved: StockEvent) => void
}) {
  const t = useT()
  const toast = useToast()
  const { locations, users } = useData()
  const start = event?.startAt ?? Date.now()

  const [title, setTitle] = useState(event?.title ?? '')
  const [type, setType] = useState<StockEventType>(event?.type ?? 'stockCount')
  const [locationId, setLocationId] = useState(event?.locationId ?? '')
  const [date, setDate] = useState(toDateInput(start))
  const [time, setTime] = useState(toTimeInput(start))
  const [dueDate, setDueDate] = useState(event?.dueAt ? toDateInput(event.dueAt) : '')
  const [priority, setPriority] = useState<StockEventPriority>(event?.priority ?? 'normal')
  const [assignedTo, setAssignedTo] = useState(event?.assignedTo ?? '')
  const [note, setNote] = useState(event?.note ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const startAt = fromInputs(date, time)
      const input: EventInput = {
        title,
        type,
        locationId: locationId || undefined,
        startAt,
        dueAt: dueDate ? fromInputs(dueDate, '23:59') : undefined,
        priority,
        assignedTo: assignedTo || undefined,
        // Stored so a staff member holding a uid does not have to read `users` to show it.
        assignedToName: assignedTo
          ? users.find((u) => u.id === assignedTo)?.name || undefined
          : undefined,
        note,
      }
      const now = Date.now()
      if (event) {
        await updateEvent(event.id, input)
        onSaved({ ...event, ...input, updatedAt: now } as StockEvent)
      } else {
        const id = await createEvent(input, userId)
        onSaved({
          id,
          ...input,
          status: 'upcoming',
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        } as StockEvent)
      }
      toast.success(t('บันทึกแล้ว'))
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={event ? t('แก้ไขงาน') : t('เพิ่มงาน')}>
      <div className="space-y-3">
        <Field label={t('ชื่องาน')} required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('เช่น นับสต๊อกคลังหลัก')}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ประเภท')}>
            <Select value={type} onChange={(e) => setType(e.target.value as StockEventType)}>
              {(Object.keys(TYPE_LABEL) as StockEventType[]).map((k) => (
                <option key={k} value={k}>
                  {t(TYPE_LABEL[k])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('ความสำคัญ')}>
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value as StockEventPriority)}
            >
              {(Object.keys(PRIORITY_LABEL) as StockEventPriority[]).map((k) => (
                <option key={k} value={k}>
                  {t(PRIORITY_LABEL[k])}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('วันที่')} required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('เวลา')}>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label={t('กำหนดเสร็จ (ไม่บังคับ)')}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label={t('คลัง/สาขา')}>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('ไม่ระบุ')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('ผู้รับผิดชอบ')}>
          <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">{t('ยังไม่มอบหมาย')}</option>
            {users
              .filter((u) => u.active !== false)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('หมายเหตุ')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ยกเลิก')}
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? t('กำลังบันทึก...') : t('บันทึก')}
        </Button>
      </div>
    </Modal>
  )
}
