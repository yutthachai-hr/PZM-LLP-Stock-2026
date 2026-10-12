import { backend, BACKEND_MODE } from '../backend'
import { getBrand, type BrandId } from '../brand/brand'
import { inventoryInsights } from '../lib/inventoryRules/insights'
import { evaluate, plan, STATEFUL, weeklyFigures, type JobName } from '../lib/inventoryRules/notifications'
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
import { transferCache } from '../data/transferCache'
import { riskEngineInput } from '../lib/riskNotifications'
import { requestCache } from '../data/requestCache'
import { applyPlan, backfillAudience, getActiveNotifications, getNotifications } from './notifications'
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
 *
 * Every job takes the brand once, when it starts (owner, 12 Oct 2026), and uses that brand for
 * everything after: its reads and writes, and the markers it leaves on this device. Someone can
 * switch brand while a job waits on the network; before, the steps after that wait asked
 * getBrand() again and could file one brand's markers — or notifications — under the other. A
 * switch during the read phase now stops the job before it writes anything; it runs again,
 * under the right brand, the next time that brand is open.
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
  /** Set when the brand changed before anything was written: nothing done, nothing marked. */
  skipped?: 'brandChanged'
}

/**
 * Write every stock-count task the schedules call for between today and two weeks out
 * that does not exist yet. One range read for the window, one write per missing task.
 */
export async function generateStockCountTasks(
  actor: { id: string; name: string },
  now = Date.now(),
  schedules?: InventorySchedule[],
  brand: BrandId = getBrand(),
): Promise<GenerateResult> {
  const from = bkkDayStart(now)
  const to = bkkDayEnd(now + GENERATE_AHEAD_DAYS * DAY_MS)
  const list = schedules ?? (await loadScheduleConfig()).schedules
  // The schedules are the open brand's: if that is no longer the brand this run is for, stop.
  if (getBrand() !== brand) return { written: 0, scanned: 0, from, to, skipped: 'brandChanged' }
  const enabled = list.filter((s) => s.enabled)
  if (enabled.length === 0) return { written: 0, scanned: 0, from, to }
  const db = backend.forBrand(brand)
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
    // The calendar's cache is the open brand's: only told when that is still this brand.
    if (getBrand() === brand) patchEvent(task)
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
export async function shouldRunOnOpen(role: Role, now = Date.now(), brand: BrandId = getBrand()): Promise<boolean> {
  const day = `${brand}:${bkkDayKey(now)}`
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

export function markRanToday(now = Date.now(), brand: BrandId = getBrand()): void {
  try {
    localStorage.setItem(RAN_KEY, `${brand}:${bkkDayKey(now)}`)
  } catch {
    // no storage: it will run again next open, which is harmless
  }
}

/** The generator, gated as `shouldRunOnOpen` says. Called when the calendar opens. */
export async function runOnOpen(
  actor: { id: string; name: string; role: Role },
  now = Date.now(),
  brand: BrandId = getBrand(),
): Promise<GenerateResult | null> {
  if (!(await shouldRunOnOpen(actor.role, now, brand))) return null
  const result = await generateStockCountTasks(actor, now, undefined, brand)
  // Marked for the brand it ran for — and not at all when it stopped for a brand change.
  if (!result.skipped) markRanToday(now, brand)
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
export async function shouldRunNotifications(role: Role, now = Date.now(), brand: BrandId = getBrand()): Promise<boolean> {
  if (BACKEND_MODE === 'local') return true
  if (role !== 'admin' && role !== 'manager') return false
  let last = 0
  try {
    const raw = localStorage.getItem(`${NOTIFY_KEY}:${brand}`)
    last = raw ? Number(raw) : 0
  } catch {
    // no storage: fall through to the Worker check
  }
  if (now - last < CLIENT_NOTIFY_EVERY_MS) return false
  const status = await readCronStatus()
  return !(status?.lastRunAt && now - status.lastRunAt < WORKER_STALE_MS)
}

function markNotified(now: number, brand: BrandId): void {
  try {
    localStorage.setItem(`${NOTIFY_KEY}:${brand}`, String(now))
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
  brand: BrandId = getBrand(),
): Promise<number> {
  const today = bkkDayStart(now)
  const [events, orders, requests, suppliers, config, riskOrders, transfers] = await Promise.all([
    fetchEvents(today - TASK_LOOKBACK_DAYS * DAY_MS, bkkDayEnd(now) + DAY_MS),
    orderCache.fetchRange(today - 45 * DAY_MS, bkkDayEnd(now)),
    requestCache.fetchRange(today - 30 * DAY_MS, bkkDayEnd(now)),
    loadSuppliers(),
    loadScheduleConfig(),
    // The risk rules look back 90 days; one wider read that covers the 45 above too.
    orderCache.fetchRange(today - 120 * DAY_MS, bkkDayEnd(now) + DAY_MS),
    transferCache.fetchRange(today - 30 * DAY_MS, bkkDayEnd(now) + DAY_MS),
  ])
  // Everything above was read for the open brand. A switch meanwhile: stop before any write or
  // marker; the next run under this brand does the work (none is lost, none is doubled).
  if (getBrand() !== brand) return 0
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
  const jobs: JobName[] = ['tasks', 'purchasing', 'inventory', 'brief', 'weekly', 'risk']
  const risk = riskEngineInput({
    orders: riskOrders,
    transfers,
    suppliers,
    products: data.products,
    locations: data.locations,
    qtyAt: view.qtyAt,
    minFor: view.minFor,
    tracksProduct: view.tracksProduct,
    movements: data.movements,
    usageWindowDays: config.settings.usageWindowDays,
    now,
  })
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
    risk,
  })
  // What is on file among the drafts and the live states. The bell's own list is now only
  // this person's newest (perf/firestore-read-budget), so the rest is looked up: the drafts
  // and the states this device saw last run, 30 ids a query; and every six hours one sweep
  // of everything active, for states another device raised and nobody here has seen.
  const known = new Map(data.notifications.map((n) => [n.id, n]))
  // From here every read, write and marker is pinned to `brand`, whatever is open by then.
  const sweep = sweepDue(now, brand)
  if (sweep) for (const n of await getActiveNotifications(brand)) known.set(n.id, n)
  const wanted = [...new Set([...drafts.map((d) => d.id), ...lastActive(brand)])].filter((id) => !known.has(id))
  for (const n of await getNotifications(wanted, brand)) known.set(n.id, n)
  const written = await applyPlan(plan(drafts, known, jobs, now, 'client', actor.id), brand)
  await backfillAudience([...known.values()], brand)
  rememberActive([...known.values()].filter((n) => n.active && STATEFUL.has(n.kind)).map((n) => n.id), drafts.map((d) => d.id), brand)
  if (sweep) markSwept(now, brand)
  markNotified(now, brand)
  return written
}

// ------------------------------------------------- what the job saw last time (device) ----

const ACTIVE_KEY = 'pzm.automation.activeStates'
const SWEEP_KEY = 'pzm.automation.sweptAt'
/** How often a device re-reads every active notification to catch states raised elsewhere. */
export const SWEEP_EVERY_MS = 6 * 60 * 60_000

function lastActive(brand: BrandId): string[] {
  try {
    const raw = localStorage.getItem(`${ACTIVE_KEY}:${brand}`)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').slice(0, 500) : []
  } catch {
    return []
  }
}

function rememberActive(active: readonly string[], drafted: readonly string[], brand: BrandId): void {
  try {
    localStorage.setItem(`${ACTIVE_KEY}:${brand}`, JSON.stringify([...new Set([...active, ...drafted])].slice(0, 500)))
  } catch {
    // harmless: the sweep catches up
  }
}

function sweepDue(now: number, brand: BrandId): boolean {
  try {
    return now - Number(localStorage.getItem(`${SWEEP_KEY}:${brand}`) ?? 0) >= SWEEP_EVERY_MS
  } catch {
    return true
  }
}

function markSwept(now: number, brand: BrandId): void {
  try {
    localStorage.setItem(`${SWEEP_KEY}:${brand}`, String(now))
  } catch {
    // harmless
  }
}
