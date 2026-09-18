import { backend, BACKEND_MODE } from '../backend'
import { getBrand } from '../brand/brand'
import { inventoryInsights } from '../lib/inventoryRules/insights'
import { evaluate, plan, weeklyFigures, type JobName } from '../lib/inventoryRules/notifications'
import { GENERATE_AHEAD_DAYS, missingTasks, taskIdFor } from '../lib/inventoryRules/schedules'
import { stockView } from '../lib/inventoryRules/stockView'
import { bkkDayEnd, bkkDayKey, bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import {
  COL,
  type AppNotification,
  type InventorySchedule,
  type MinOverride,
  type Product,
  type Role,
  type StockEvent,
  type StockLevel,
  type StockLocation,
  type StockMovement,
} from '../types'
import { fetchRange as fetchEvents, patchEvent } from '../data/eventCache'
import { orderCache } from '../data/orderCache'
import { requestCache } from '../data/requestCache'
import { applyPlan, getNotifications } from './notifications'
import { loadScheduleConfig } from './schedules'
import { loadSuppliers } from './suppliers'

/**
 * The background jobs, run from the browser.
 *
 * The cron Worker does this every night for the live system. The browser does the same
 * job — the same pure function on the same data under the same ids — in demo mode, where
 * there is no Worker; and in cloud mode as a fallback, when a manager opens the calendar
 * and the Worker has not reported in for more than a day. Writing under a deterministic
 * id makes the two safe to overlap: whoever runs first wins, and the other writes nothing.
 */

export interface CronStatus {
  lastRunAt?: number
  lastJob?: string
  tasksWritten?: number
  error?: string
}

/** The Worker is late when its last heartbeat is older than this. */
export const WORKER_STALE_MS = 26 * 3_600_000

export interface GenerateResult {
  written: number
  scanned: number
  from: number
  to: number
}

/**
 * Write every stock-count task the schedules call for between today and two weeks out
 * that does not exist yet. One range read for the window, one write per missing task.
 */
export async function generateStockCountTasks(
  actor: { id: string; name: string },
  now = Date.now(),
  schedules?: InventorySchedule[],
): Promise<GenerateResult> {
  const list = schedules ?? (await loadScheduleConfig()).schedules
  const from = bkkDayStart(now)
  const to = bkkDayEnd(now + GENERATE_AHEAD_DAYS * DAY_MS)
  const enabled = list.filter((s) => s.enabled)
  if (enabled.length === 0) return { written: 0, scanned: 0, from, to }
  const db = backend.forBrand(getBrand())
  const existing = await db.getRange<StockEvent>(COL.events, 'startAt', from, to)
  // A task moved out of the window still exists under its id — checked so a reschedule
  // to next month does not make the day come back.
  const ids = new Set(existing.map((e) => e.id))
  const wanted = missingTasks(enabled, ids, from, to, actor, now)
  const missing: StockEvent[] = []
  for (const task of wanted) {
    if (ids.has(task.id)) continue
    const moved = await db.getOne<StockEvent>(COL.events, task.id)
    if (moved) continue
    missing.push(task)
  }
  for (const task of missing) {
    const { id, ...doc } = task
    await db.set(COL.events, id, { id, ...doc })
    patchEvent(task)
  }
  return { written: missing.length, scanned: existing.length, from, to }
}

/** The Worker's last heartbeat, if it has ever run. Cloud mode only; local has no Worker. */
export async function readCronStatus(): Promise<CronStatus | null> {
  if (BACKEND_MODE === 'local') return null
  try {
    return await backend.getOne<CronStatus>('meta', 'cronStatus')
  } catch {
    return null
  }
}

const RAN_KEY = 'pzm.automation.ranDay'

/**
 * Whether this device should run the generator now: always in local mode; in cloud mode
 * only for a manager or admin, only when the Worker is late, and only once a Bangkok day.
 */
export async function shouldRunOnOpen(role: Role, now = Date.now()): Promise<boolean> {
  const day = `${getBrand()}:${bkkDayKey(now)}`
  let ran: string | null = null
  try {
    ran = localStorage.getItem(RAN_KEY)
  } catch {
    // no storage: run, it is harmless
  }
  if (ran === day) return false
  if (BACKEND_MODE !== 'local') {
    if (role !== 'admin' && role !== 'manager') return false
    const status = await readCronStatus()
    if (status?.lastRunAt && now - status.lastRunAt < WORKER_STALE_MS) return false
  }
  return true
}

export function markRanToday(now = Date.now()): void {
  try {
    localStorage.setItem(RAN_KEY, `${getBrand()}:${bkkDayKey(now)}`)
  } catch {
    // no storage: it will run again next open, which is harmless
  }
}

/** The generator, gated as `shouldRunOnOpen` says. Called when the calendar opens. */
export async function runOnOpen(actor: { id: string; name: string; role: Role }, now = Date.now()): Promise<GenerateResult | null> {
  if (!(await shouldRunOnOpen(actor.role, now))) return null
  const result = await generateStockCountTasks(actor, now)
  markRanToday(now)
  return result
}

/** The id the generator will use for a schedule on a day — for "preview next dates". */
export { taskIdFor }

// ---------------------------------------------------------------- notifications ----

/** How often the app re-checks what to announce while it is open (live fallback only). */
export const CLIENT_NOTIFY_EVERY_MS = 30 * 60_000
const NOTIFY_KEY = 'pzm.automation.notifiedAt'

/** How far back tasks are looked at for overdue and escalation. */
export const TASK_LOOKBACK_DAYS = 14

export interface NotifyData {
  products: readonly Product[]
  locations: readonly StockLocation[]
  levels: readonly StockLevel[]
  minOverrides: readonly MinOverride[]
  movements: readonly StockMovement[]
  notifications: readonly AppNotification[]
}

/**
 * Whether this device should run the notification jobs now: in local mode, whenever asked;
 * live, only a manager or admin, only while the Worker is late, and at most every half
 * hour per device and brand.
 */
export async function shouldRunNotifications(role: Role, now = Date.now()): Promise<boolean> {
  if (BACKEND_MODE === 'local') return true
  if (role !== 'admin' && role !== 'manager') return false
  let last = 0
  try {
    const raw = localStorage.getItem(`${NOTIFY_KEY}:${getBrand()}`)
    last = raw ? Number(raw) : 0
  } catch {
    // no storage: fall through to the Worker check
  }
  if (now - last < CLIENT_NOTIFY_EVERY_MS) return false
  const status = await readCronStatus()
  return !(status?.lastRunAt && now - status.lastRunAt < WORKER_STALE_MS)
}

function markNotified(now: number): void {
  try {
    localStorage.setItem(`${NOTIFY_KEY}:${getBrand()}`, String(now))
  } catch {
    // harmless
  }
}

/**
 * Every notification job, from the browser: the Worker's work, on the same pure rules and
 * under the same ids. Reads: three range queries through the session caches (usually
 * already held), the configuration (held), and one read per announcement not already in
 * the week the bell holds. Returns the number of documents written.
 */
export async function runNotificationJobs(
  actor: { id: string; name: string },
  data: NotifyData,
  now = Date.now(),
): Promise<number> {
  const today = bkkDayStart(now)
  const [events, orders, requests, suppliers, config] = await Promise.all([
    fetchEvents(today - TASK_LOOKBACK_DAYS * DAY_MS, bkkDayEnd(now) + DAY_MS),
    orderCache.fetchRange(today - 45 * DAY_MS, bkkDayEnd(now)),
    requestCache.fetchRange(today - 30 * DAY_MS, bkkDayEnd(now)),
    loadSuppliers(),
    loadScheduleConfig(),
  ])
  const view = stockView(data)
  const insights = inventoryInsights({
    ...view,
    products: data.products,
    locations: data.locations,
    movements: data.movements,
    orders,
    requests,
    suppliers,
    settings: config.settings,
    snoozes: config.snoozes,
    now,
    adjustmentsSince: today - 7 * DAY_MS,
  })
  const locationName = (id: string | undefined) => data.locations.find((l) => l.id === id)?.name ?? ''
  const jobs: JobName[] = ['tasks', 'purchasing', 'inventory', 'brief', 'weekly']
  const drafts = evaluate({
    now,
    jobs,
    events,
    orders,
    requests,
    suppliers,
    // Announce only the last two days' adjustments; the week is for the Monday figures.
    insights: { ...insights, adjustments: insights.adjustments.filter((a) => a.movement.date >= today - 2 * DAY_MS) },
    weekly: weeklyFigures({
      now,
      events,
      orders,
      adjustments: insights.adjustments,
      leadTimeOf: (id) => suppliers.find((s) => s.id === id)?.leadTimeDays,
    }),
    locationName,
    settings: config.settings,
  })
  const known = new Map(data.notifications.map((n) => [n.id, n]))
  const missing = drafts.map((d) => d.id).filter((id) => !known.has(id))
  for (const n of await getNotifications(missing)) known.set(n.id, n)
  const written = await applyPlan(plan(drafts, known, jobs, now, 'client', actor.id))
  markNotified(now)
  return written
}
