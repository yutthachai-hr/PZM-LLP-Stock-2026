import type {
  AppNotification,
  AppUser,
  NotificationAudience,
  NotificationCategory,
  NotificationKind,
  NotificationPrefs,
  NotificationPriority,
  PurchaseOrder,
  PurchaseRequest,
  Role,
  StockEvent,
  Supplier,
} from '../../types'
import type { Insights } from './insights'
import { deliveryState, daysLate, cutoffInstants } from './purchasing'
import { taskDueAt } from './calendarFeed'
import { bkkAtTime, bkkDayEnd, bkkDayKey, bkkDayStart, bkkTimeOf, bkkWeekday, DAY_MS } from './time'

/**
 * What should be announced, and to whom — as data.
 *
 * `evaluate` looks at what is true now and returns drafts, each under the id that makes it
 * unique: a date-instanced fact carries its day (`cutoffToday__<supplier>__<yyyymmdd>`), a
 * state carries only its subject (`lowStock__<product>__<location>`). `plan` compares the
 * drafts with what already exists and says what to write: nothing already said is said
 * again, a state that cleared is marked resolved, and one that comes back is re-armed.
 *
 * Pure. The app runs it (demo mode, and live when the Worker is late) and so does the cron
 * Worker; both write the same ids, so whichever runs second writes nothing.
 */

export const MANAGERS: Role[] = ['manager', 'admin']
export const NOTIFICATION_TTL_MS = 30 * DAY_MS
/** The in-app list reads notifications created in the last this-many days. */
export const NOTIFICATION_WINDOW_DAYS = 7
/** The daily brief goes out from this time, Bangkok. */
export const BRIEF_TIME = '07:00'
export const WEEKLY_TIME = '07:30'

/** States: said once while true, resolved when they clear, said again if they come back. */
export const STATEFUL: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  'taskOverdue',
  'poDelayed',
  'lowStock',
  'outOfStock',
  'stockoutSoon',
  'reorder',
])

export const CATEGORY: Record<NotificationKind, NotificationCategory> = {
  taskSoon: 'task',
  taskOverdue: 'task',
  taskEscalated: 'task',
  taskApproval: 'task',
  prSubmitted: 'purchasing',
  poArriving: 'purchasing',
  poDelayed: 'purchasing',
  cutoffToday: 'supplier',
  lowStock: 'inventory',
  outOfStock: 'inventory',
  stockoutSoon: 'inventory',
  reorder: 'inventory',
  adjustment: 'inventory',
  waste: 'inventory',
  dailyBrief: 'system',
  weeklySummary: 'system',
}

/** Which job evaluates which kinds — a job may only resolve the kinds it looked at. */
export const JOB_KINDS = {
  tasks: ['taskSoon', 'taskOverdue', 'taskEscalated', 'taskApproval'],
  purchasing: ['prSubmitted', 'poArriving', 'poDelayed', 'cutoffToday'],
  inventory: ['lowStock', 'outOfStock', 'stockoutSoon', 'reorder', 'adjustment', 'waste'],
  brief: ['dailyBrief'],
  weekly: ['weeklySummary'],
} satisfies Record<string, NotificationKind[]>

export type JobName = keyof typeof JOB_KINDS

export interface NotificationDraft {
  id: string
  kind: NotificationKind
  priority: NotificationPriority
  to: NotificationAudience
  params: Record<string, string | number>
  link: string
  locationId?: string
  productId?: string
  supplierId?: string
}

export interface WeeklyFigures {
  tasksDone: number
  tasksMissed: number
  deliveries: number
  lateDeliveries: number
  adjustments: number
  wasteValue: number
}

export interface EngineInput {
  now: number
  jobs: readonly JobName[]
  events?: readonly StockEvent[]
  orders?: readonly PurchaseOrder[]
  requests?: readonly PurchaseRequest[]
  suppliers?: readonly Supplier[]
  insights?: Insights
  weekly?: WeeklyFigures
  locationName: (id: string | undefined) => string
  settings: { reminderBeforeMin: number; escalateAfterHours: number }
}

const OPEN_TASK = (e: StockEvent) => e.status === 'upcoming' || e.status === 'inProgress'

/** A task's own people: named, or everyone when it names nobody. */
export function taskAudience(e: StockEvent): NotificationAudience {
  const to = e.assignedTo as string[] | string | undefined
  const uids = Array.isArray(to) ? to : to ? [to] : []
  return e.assignedToAll || uids.length === 0 ? { all: true } : { uids }
}

const PRIORITY_OF_TASK: Record<StockEvent['priority'], NotificationPriority> = { normal: 'medium', high: 'high', critical: 'critical' }
const up = (p: NotificationPriority): NotificationPriority => (p === 'info' ? 'medium' : p === 'medium' ? 'high' : 'critical')

export function evaluate(input: EngineInput): NotificationDraft[] {
  const { now } = input
  const jobs = new Set(input.jobs)
  const out: NotificationDraft[] = []
  const today = bkkDayKey(now)
  const loc = input.locationName

  if (jobs.has('tasks')) {
    for (const e of input.events ?? []) {
      const due = taskDueAt(e)
      const base = { params: { title: e.title, time: bkkTimeOf(e.startAt), location: loc(e.locationId) }, link: `/calendar?item=task__${e.id}`, locationId: e.locationId }
      if (OPEN_TASK(e) && due < now) {
        out.push({ id: `taskOverdue__${e.id}`, kind: 'taskOverdue', priority: up(PRIORITY_OF_TASK[e.priority]), to: taskAudience(e), ...base })
        if (now - due >= input.settings.escalateAfterHours * 3_600_000) {
          out.push({ id: `taskEscalated__${e.id}`, kind: 'taskEscalated', priority: e.priority === 'critical' ? 'critical' : 'high', to: { roles: MANAGERS }, ...base })
        }
      } else if (OPEN_TASK(e) && e.startAt - input.settings.reminderBeforeMin * 60_000 <= now) {
        out.push({ id: `taskSoon__${e.id}__${bkkDayKey(e.startAt)}`, kind: 'taskSoon', priority: PRIORITY_OF_TASK[e.priority], to: taskAudience(e), ...base })
      }
      if (e.status === 'waitingApproval') out.push(taskApprovalDraft(e, input.locationName))
    }
  }

  if (jobs.has('purchasing')) {
    const lead = (id: string) => (input.suppliers ?? []).find((s) => s.id === id)?.leadTimeDays
    for (const po of input.orders ?? []) {
      if (po.status !== 'ordered') continue
      const state = deliveryState(po, now, lead(po.supplierId))
      const params = { supplier: po.supplierName, docNo: po.docNo, location: loc(po.locationId), n: po.lines.length }
      const common = { link: `/orders?po=${po.id}`, locationId: po.locationId, supplierId: po.supplierId }
      if (state === 'arrivingToday') {
        out.push({ id: `poArriving__${po.id}__${today}`, kind: 'poArriving', priority: 'info', to: { all: true }, params, ...common })
      } else if (state === 'delayed') {
        out.push({ id: `poDelayed__${po.id}`, kind: 'poDelayed', priority: 'high', to: { roles: MANAGERS }, params: { ...params, days: daysLate(po, now, lead(po.supplierId)) }, ...common })
      }
    }
    for (const pr of input.requests ?? []) {
      if (pr.status === 'pendingApproval') out.push(prSubmittedDraft(pr, loc))
    }
    for (const s of input.suppliers ?? []) {
      for (const at of cutoffInstants(s, { from: bkkDayStart(now), to: bkkDayEnd(now) })) {
        if (at < now) continue
        out.push({ id: `cutoffToday__${s.id}__${today}`, kind: 'cutoffToday', priority: 'medium', to: { roles: MANAGERS }, params: { supplier: s.name, time: bkkTimeOf(at) }, link: '/requests', supplierId: s.id })
      }
    }
  }

  const ins = input.insights
  if (jobs.has('inventory') && ins) {
    for (const s of ins.shortages) {
      const kind = s.out ? 'outOfStock' : 'lowStock'
      out.push({
        id: `${kind}__${s.product.id}__${s.location.id}`,
        kind,
        priority: s.out ? 'critical' : 'medium',
        to: { roles: MANAGERS },
        params: { product: s.product.name, location: s.location.name, qty: round(s.qty), min: round(s.min), unit: s.product.unitType },
        link: `/calendar?item=${kind}__${s.product.id}__${s.location.id}`,
        locationId: s.location.id,
        productId: s.product.id,
        supplierId: s.product.supplierId,
      })
    }
    for (const r of ins.reorders) {
      // Already asked for or on order: saying it again is how things get ordered twice.
      if (r.inProgress) continue
      out.push({
        id: `reorder__${r.product.id}__${r.location.id}`,
        kind: 'reorder',
        priority: 'medium',
        to: { roles: MANAGERS },
        params: { product: r.product.name, location: r.location.name, qty: r.recommendedQty, unit: r.product.unitType },
        link: `/calendar?item=reorder__${r.product.id}__${r.location.id}`,
        locationId: r.location.id,
        productId: r.product.id,
        supplierId: r.supplier?.id,
      })
    }
    for (const s of ins.stockouts) {
      out.push({
        id: `stockoutSoon__${s.product.id}__${s.location.id}`,
        kind: 'stockoutSoon',
        priority: 'high',
        to: { roles: MANAGERS },
        params: { product: s.product.name, location: s.location.name, days: Math.max(0, Math.floor(s.daysLeft)) },
        link: `/calendar?item=stockoutEstimate__${s.product.id}__${s.location.id}`,
        locationId: s.location.id,
        productId: s.product.id,
      })
    }
    for (const a of ins.adjustments) out.push(adjustmentDraft(a.movement, a.kind, a.value, loc))
  }

  if (jobs.has('brief') && now >= bkkAtTime(bkkDayStart(now), BRIEF_TIME)) {
    const events = input.events ?? []
    const todays = events.filter((e) => OPEN_TASK(e) && bkkDayKey(e.startAt) === today).length
    const overdue = events.filter((e) => OPEN_TASK(e) && taskDueAt(e) < now).length
    const orders = input.orders ?? []
    const lead = (id: string) => (input.suppliers ?? []).find((s) => s.id === id)?.leadTimeDays
    const arriving = orders.filter((o) => o.status === 'ordered' && deliveryState(o, now, lead(o.supplierId)) === 'arrivingToday').length
    const late = orders.filter((o) => o.status === 'ordered' && deliveryState(o, now, lead(o.supplierId)) === 'delayed').length
    const pending = (input.requests ?? []).filter((r) => r.status === 'pendingApproval').length
    out.push({
      id: `dailyBrief__${today}`,
      kind: 'dailyBrief',
      priority: 'info',
      to: { roles: MANAGERS },
      params: {
        tasks: todays,
        overdue,
        arriving,
        late,
        pending,
        low: ins?.shortages.filter((s) => !s.out).length ?? 0,
        out: ins?.shortages.filter((s) => s.out).length ?? 0,
        reorder: ins?.reorders.filter((r) => !r.inProgress).length ?? 0,
      },
      link: '/calendar?filter=today',
    })
  }

  if (jobs.has('weekly') && input.weekly && bkkWeekday(now) === 1 && now >= bkkAtTime(bkkDayStart(now), WEEKLY_TIME)) {
    const w = input.weekly
    out.push({
      id: `weeklySummary__${today}`,
      kind: 'weeklySummary',
      priority: 'info',
      to: { roles: MANAGERS },
      params: { done: w.tasksDone, missed: w.tasksMissed, deliveries: w.deliveries, late: w.lateDeliveries, adjustments: w.adjustments, waste: round(w.wasteValue) },
      link: '/reports',
    })
  }

  return out
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Said the moment a task is handed in, and again by the job if that write was missed. */
export function taskApprovalDraft(e: StockEvent, locationName: (id: string | undefined) => string): NotificationDraft {
  return {
    id: `taskApproval__${e.id}__${e.completedAt ?? e.updatedAt}`,
    kind: 'taskApproval',
    priority: 'medium',
    to: { roles: MANAGERS },
    params: { title: e.title, by: e.completedByName ?? '', location: locationName(e.locationId) },
    link: `/calendar?item=task__${e.id}`,
    locationId: e.locationId,
  }
}

export function prSubmittedDraft(pr: PurchaseRequest, locationName: (id: string | undefined) => string): NotificationDraft {
  return {
    id: `prSubmitted__${pr.id}__${pr.submittedAt ?? pr.createdAt}`,
    kind: 'prSubmitted',
    priority: 'medium',
    to: { roles: MANAGERS },
    params: { docNo: pr.docNo, by: pr.requestedByName, location: locationName(pr.locationId), n: pr.items.filter((i) => !i.removed).length },
    link: `/requests/${pr.id}`,
    locationId: pr.locationId,
  }
}

export function adjustmentDraft(
  m: { docNo: string; productId: string; productName: string; qty: number; unit: string; reason?: string; fromLocationId?: string; toLocationId?: string; byUserName: string },
  kind: 'adjustment' | 'waste',
  value: number | null,
  locationName: (id: string | undefined) => string,
): NotificationDraft {
  const locationId = m.fromLocationId ?? m.toLocationId
  return {
    // By document number: the adjust screen knows it the moment the save returns, and the
    // job reads it off the movement — one id for both, so it is said once.
    id: `${kind}__${m.docNo}__${m.productId}`,
    kind,
    priority: 'high',
    to: { roles: MANAGERS },
    params: {
      product: m.productName,
      qty: m.qty,
      unit: m.unit,
      sign: m.fromLocationId ? '-' : '+',
      value: value === null ? '' : Math.round(value),
      reason: m.reason ?? '',
      by: m.byUserName,
      location: locationName(locationId),
    },
    link: `/movements?product=${m.productId}${locationId ? `&location=${locationId}` : ''}`,
    locationId,
    productId: m.productId,
  }
}

// ------------------------------------------------------------------- what to write ----

export interface WritePlan {
  create: AppNotification[]
  rearm: AppNotification[]
  resolve: string[]
}

export function toDoc(d: NotificationDraft, now: number, source: AppNotification['source'], createdBy: string): AppNotification {
  const doc: AppNotification = {
    id: d.id,
    kind: d.kind,
    category: CATEGORY[d.kind],
    priority: d.priority,
    to: d.to,
    params: d.params,
    link: d.link,
    active: true,
    readBy: {},
    source,
    createdBy,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + NOTIFICATION_TTL_MS,
  }
  if (d.locationId) doc.locationId = d.locationId
  if (d.productId) doc.productId = d.productId
  if (d.supplierId) doc.supplierId = d.supplierId
  return doc
}

/**
 * From drafts and what is on file to the writes. `existing` holds every notification the
 * caller knows of among the drafts' ids and the active states; an id missing from it is
 * treated as never written (the Worker's write carries an exists:false precondition, so a
 * wrong guess costs a refused write, not a duplicate).
 */
export function plan(
  drafts: readonly NotificationDraft[],
  existing: ReadonlyMap<string, AppNotification>,
  jobs: readonly JobName[],
  now: number,
  source: AppNotification['source'],
  createdBy: string,
): WritePlan {
  const out: WritePlan = { create: [], rearm: [], resolve: [] }
  const ids = new Set<string>()
  for (const d of drafts) {
    if (ids.has(d.id)) continue
    ids.add(d.id)
    const ex = existing.get(d.id)
    if (!ex) out.create.push(toDoc(d, now, source, createdBy))
    else if (STATEFUL.has(d.kind) && !ex.active) out.rearm.push(toDoc(d, now, source, createdBy))
  }
  const looked = new Set<NotificationKind>(jobs.flatMap((j) => JOB_KINDS[j] as NotificationKind[]))
  for (const ex of existing.values()) {
    if (ex.active && STATEFUL.has(ex.kind) && looked.has(ex.kind) && !ids.has(ex.id)) out.resolve.push(ex.id)
  }
  return out
}

// ------------------------------------------------------------------ who sees what ----

export function isAddressedTo(to: NotificationAudience, user: Pick<AppUser, 'id' | 'role'>): boolean {
  return !!to.all || !!to.roles?.includes(user.role) || !!to.uids?.includes(user.id)
}

/** In this person's list: addressed to them, still true, and not a priority they muted. Critical cannot be muted. */
export function isFor(n: AppNotification, user: Pick<AppUser, 'id' | 'role'>, prefs?: NotificationPrefs | null): boolean {
  if (!n.active || !isAddressedTo(n.to, user)) return false
  if (n.priority === 'critical') return true
  return !prefs?.mute?.[n.category]?.includes(n.priority)
}

export const isUnread = (n: AppNotification, uid: string) => !n.readBy?.[uid]

/** Figures for the Monday summary, from last week's tasks, orders and adjustments. */
export function weeklyFigures(input: {
  now: number
  events: readonly StockEvent[]
  orders: readonly PurchaseOrder[]
  adjustments: readonly { kind: 'adjustment' | 'waste'; value: number | null; movement: { date: number } }[]
  leadTimeOf: (supplierId: string) => number | undefined
}): WeeklyFigures {
  const to = bkkDayStart(input.now)
  const from = to - 7 * DAY_MS
  const inWeek = (ms?: number) => ms !== undefined && ms >= from && ms < to
  const tasks = input.events.filter((e) => inWeek(e.startAt) && e.status !== 'cancelled')
  const received = input.orders.filter((o) => o.status === 'received' && inWeek(o.receivedAt))
  const late = received.filter((o) => {
    const due = o.expectedAt ?? (input.leadTimeOf(o.supplierId) !== undefined ? bkkDayStart(o.orderedAt) + (input.leadTimeOf(o.supplierId) ?? 0) * DAY_MS : undefined)
    return due !== undefined && o.receivedAt !== undefined && bkkDayStart(o.receivedAt) > bkkDayStart(due)
  })
  const adj = input.adjustments.filter((a) => inWeek(a.movement.date))
  return {
    tasksDone: tasks.filter((e) => e.status === 'completed').length,
    tasksMissed: tasks.filter((e) => e.status !== 'completed').length,
    deliveries: received.length,
    lateDeliveries: late.length,
    adjustments: adj.filter((a) => a.kind === 'adjustment').length,
    wasteValue: adj.filter((a) => a.kind === 'waste').reduce((n, a) => n + (a.value ?? 0), 0),
  }
}
