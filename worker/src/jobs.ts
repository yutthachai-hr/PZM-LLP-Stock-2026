import { inventoryInsights } from '../../src/lib/inventoryRules/insights'
import { evaluate, plan, STATEFUL, weeklyFigures, type JobName, type NotificationDraft } from '../../src/lib/inventoryRules/notifications'
import { buildTaskDoc, GENERATE_AHEAD_DAYS, occurrencesBetween, taskIdFor } from '../../src/lib/inventoryRules/schedules'
import { stockView } from '../../src/lib/inventoryRules/stockView'
import { bkkDayEnd, bkkDayStart, DAY_MS } from '../../src/lib/inventoryRules/time'
import {
  COL,
  DEFAULT_INVENTORY_SETTINGS,
  type AppNotification,
  type InventorySchedule,
  type InventorySettings,
  type MinOverride,
  type Product,
  type PurchaseOrder,
  type PurchaseRequest,
  type ReorderSnooze,
  type StockEvent,
  type StockLevel,
  type StockLocation,
  type StockMovement,
  type Supplier,
} from '../../src/types'
import type { Store, WriteOp } from './store'

/**
 * The cron jobs, per brand. Each reads only what its question needs — open tasks, open
 * orders, pending requests by status, not whole histories — and writes through
 * exists:false preconditions, so a job that runs twice, or alongside the app standing in
 * for it, writes nothing the second time and spends no reads finding that out.
 */

export const BRANDS = ['', 'lelapin__'] as const
export const WORKER_ACTOR = { id: 'worker', name: 'ระบบอัตโนมัติ' }

export type JobKind = 'frequent' | 'morning' | 'generate' | 'weekly'

/** UTC cron expressions (wrangler.toml) to the job each one runs. Bangkok is UTC+7. */
export const CRONS: Record<string, JobKind> = {
  '*/30 * * * *': 'frequent', // task reminders, overdue, escalation
  '0 0 * * *': 'morning', // 07:00 — stock, purchasing, the daily brief
  '5 17 * * *': 'generate', // 00:05 — stock-count tasks two weeks ahead, purge
  '30 0 * * 1': 'weekly', // Monday 07:30 — the weekly summary
}

export interface JobReport {
  tasksWritten: number
  notificationsWritten: number
  purged: number
}

const OPEN_TASK = ['upcoming', 'inProgress', 'waitingApproval']
const OPEN_PR = ['draft', 'pendingApproval', 'returned', 'approved']

export async function runJob(store: Store, kind: JobKind, now: number): Promise<JobReport> {
  const total: JobReport = { tasksWritten: 0, notificationsWritten: 0, purged: 0 }
  for (const prefix of BRANDS) {
    const r = await runForBrand(store, kind, prefix, now)
    total.tasksWritten += r.tasksWritten
    total.notificationsWritten += r.notificationsWritten
    total.purged += r.purged
  }
  return total
}

export async function runForBrand(store: Store, kind: JobKind, prefix: string, now: number): Promise<JobReport> {
  const col = (name: string) => prefix + name
  const report: JobReport = { tasksWritten: 0, notificationsWritten: 0, purged: 0 }
  // Every half hour only the settings document is needed (one read); the other jobs take
  // the whole configuration — schedules, settings, snoozes — in one query.
  const config =
    kind === 'frequent'
      ? [await store.get<Record<string, unknown> & { id: string; kind: string }>(col(COL.inventorySchedules), 'settings')].filter((d) => d !== null)
      : await store.query<Record<string, unknown> & { id: string; kind: string }>(col(COL.inventorySchedules))
  const settings: InventorySettings = { ...DEFAULT_INVENTORY_SETTINGS, updatedAt: 0, ...((config.find((d) => d.id === 'settings') ?? {}) as Partial<InventorySettings>) }
  const today = bkkDayStart(now)

  if (kind === 'generate') {
    const schedules = config.filter((d) => d.kind === 'stockCount') as unknown as InventorySchedule[]
    const ops: WriteOp[] = []
    for (const s of schedules) {
      for (const day of occurrencesBetween(s, now, bkkDayEnd(now + GENERATE_AHEAD_DAYS * DAY_MS))) {
        const doc = buildTaskDoc(s, day, WORKER_ACTOR, now)
        ops.push({ type: 'create', collection: col(COL.events), id: taskIdFor(s.id, day), doc: doc as unknown as Record<string, unknown> })
      }
    }
    report.tasksWritten = (await store.write(ops)).filter(Boolean).length
    // Past their 30 days. A handful a day; capped so one run cannot spend the budget.
    const old = await store.query<{ id: string }>(col(COL.notifications), [{ field: 'expiresAt', op: '<', value: now }], { limit: 200 })
    report.purged = (await store.write(old.map((n) => ({ type: 'delete' as const, collection: col(COL.notifications), id: n.id })))).filter(Boolean).length
    return report
  }

  const locations = await store.query<StockLocation>(col(COL.locations))
  const locationName = (id: string | undefined) => locations.find((l) => l.id === id)?.name ?? ''

  if (kind === 'frequent') {
    const [events, overdue] = await Promise.all([
      store.query<StockEvent>(col(COL.events), [{ field: 'status', op: 'in', value: OPEN_TASK }]),
      store.query<AppNotification>(col(COL.notifications), [
        { field: 'kind', op: '==', value: 'taskOverdue' },
        { field: 'active', op: '==', value: true },
      ]),
    ])
    const jobs: JobName[] = ['tasks']
    const drafts = evaluate({ now, jobs, events, locationName, settings })
    report.notificationsWritten = await apply(store, col(COL.notifications), drafts, overdue, jobs, now)
    return report
  }

  if (kind === 'morning') {
    const [products, levels, minOverrides, movements, suppliers, orders, requests, events, active] = await Promise.all([
      store.query<Product>(col(COL.products)),
      store.query<StockLevel>(col(COL.stockLevels)),
      store.query<MinOverride>(col(COL.minOverrides)),
      store.query<StockMovement>(col(COL.movements), [{ field: 'date', op: '>=', value: today - Math.max(7, settings.usageWindowDays) * DAY_MS }]),
      store.query<Supplier>(col(COL.suppliers)),
      store.query<PurchaseOrder>(col(COL.purchaseOrders), [{ field: 'status', op: '==', value: 'ordered' }]),
      store.query<PurchaseRequest>(col(COL.purchaseRequests), [{ field: 'status', op: 'in', value: OPEN_PR }]),
      store.query<StockEvent>(col(COL.events), [{ field: 'status', op: 'in', value: OPEN_TASK }]),
      store.query<AppNotification>(col(COL.notifications), [{ field: 'active', op: '==', value: true }]),
    ])
    const insights = inventoryInsights({
      ...stockView({ locations, levels, minOverrides }),
      products,
      locations,
      movements,
      orders,
      requests,
      suppliers,
      settings,
      snoozes: config.filter((d) => d.kind === 'snooze') as unknown as ReorderSnooze[],
      now,
      adjustmentsSince: today - 2 * DAY_MS,
    })
    const jobs: JobName[] = ['tasks', 'purchasing', 'inventory', 'brief']
    const drafts = evaluate({ now, jobs, events, orders, requests, suppliers, insights, locationName, settings })
    report.notificationsWritten = await apply(store, col(COL.notifications), drafts, active, jobs, now)
    return report
  }

  // weekly
  const from = today - 7 * DAY_MS
  const [events, orders, movements, products, levels] = await Promise.all([
    store.query<StockEvent>(col(COL.events), [
      { field: 'startAt', op: '>=', value: from },
      { field: 'startAt', op: '<', value: today },
    ]),
    store.query<PurchaseOrder>(col(COL.purchaseOrders), [{ field: 'receivedAt', op: '>=', value: from }]),
    store.query<StockMovement>(col(COL.movements), [{ field: 'date', op: '>=', value: from }]),
    store.query<Product>(col(COL.products)),
    store.query<StockLevel>(col(COL.stockLevels)),
  ])
  const suppliers = await store.query<Supplier>(col(COL.suppliers))
  const insights = inventoryInsights({
    ...stockView({ locations, levels, minOverrides: [] }),
    products,
    locations,
    movements,
    orders,
    requests: [],
    suppliers,
    settings,
    now,
    adjustmentsSince: from,
  })
  const jobs: JobName[] = ['weekly']
  const weekly = weeklyFigures({ now, events, orders, adjustments: insights.adjustments, leadTimeOf: (id) => suppliers.find((s) => s.id === id)?.leadTimeDays })
  const drafts = evaluate({ now, jobs, weekly, locationName, settings })
  report.notificationsWritten = await apply(store, col(COL.notifications), drafts, [], jobs, now)
  return report
}

/**
 * Write a plan with no dedup reads: every new one as a create that the database refuses
 * if the id exists. A refused state (low stock, a late order…) exists but is resolved —
 * the active ones were all read — so it is re-armed in place.
 */
async function apply(
  store: Store,
  collection: string,
  drafts: NotificationDraft[],
  active: AppNotification[],
  jobs: JobName[],
  now: number,
): Promise<number> {
  const p = plan(drafts, new Map(active.map((n) => [n.id, n])), jobs, now, 'worker', WORKER_ACTOR.id)
  const creates: WriteOp[] = p.create.map((doc) => ({ type: 'create', collection, id: doc.id, doc: doc as unknown as Record<string, unknown> }))
  const resolves: WriteOp[] = p.resolve.map((id) => ({ type: 'patch', collection, id, fields: { active: false, resolvedAt: now, updatedAt: now } }))
  const results = await store.write([...creates, ...resolves])
  let written = results.filter(Boolean).length
  const rearm: WriteOp[] = []
  p.create.forEach((doc, i) => {
    if (!results[i] && STATEFUL.has(doc.kind)) rearm.push({ type: 'set', collection, id: doc.id, doc: doc as unknown as Record<string, unknown> })
  })
  if (rearm.length) written += (await store.write(rearm)).filter(Boolean).length
  return written
}
