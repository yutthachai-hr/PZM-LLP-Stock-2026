import { backend, BACKEND_MODE } from '../backend'
import { getBrand } from '../brand/brand'
import { GENERATE_AHEAD_DAYS, missingTasks, taskIdFor } from '../lib/inventoryRules/schedules'
import { bkkDayEnd, bkkDayKey, bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { COL, type InventorySchedule, type Role, type StockEvent } from '../types'
import { patchEvent } from '../data/eventCache'
import { loadScheduleConfig } from './schedules'

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
