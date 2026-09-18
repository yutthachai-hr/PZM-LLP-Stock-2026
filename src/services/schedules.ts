import { useEffect, useSyncExternalStore } from 'react'
import { backend } from '../backend'
import { DELETE_FIELD } from '../backend/types'
import { getBrand, onBrandChange } from '../brand/brand'
import { AppError } from '../i18n/AppError'
import {
  COL,
  DEFAULT_INVENTORY_SETTINGS,
  type InventorySchedule,
  type InventorySettings,
  type ScheduleFrequency,
  type StockEventPriority,
} from '../types'

/**
 * How the calendar is configured: the stock-count schedules and the thresholds. One
 * small collection per brand, read once per session and held — a dozen documents that
 * change a few times a year, the same way the supplier list is kept.
 */

const scoped = () => backend.forBrand(getBrand())

export interface ScheduleInput {
  name: string
  locationId: string
  frequency: ScheduleFrequency
  daysOfWeek?: number[]
  dayOfMonth?: number
  intervalDays?: number
  anchorDay?: number
  startTime: string
  durationMin?: number
  assignedTo?: string[]
  assignedToAll?: boolean
  assignedToName?: string
  requiresApproval?: boolean
  priority: StockEventPriority
  enabled: boolean
  note?: string
}

function validate(input: ScheduleInput): void {
  if (!input.name.trim()) throw new AppError('กรุณาตั้งชื่อตารางนับ')
  if (!input.locationId) throw new AppError('กรุณาเลือกคลัง')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) throw new AppError('เวลาเริ่มต้องเป็น HH:mm')
  if ((input.frequency === 'weekly' || input.frequency === 'biweekly') && !(input.daysOfWeek?.length)) {
    throw new AppError('กรุณาเลือกวันในสัปดาห์')
  }
  if (input.frequency === 'monthly' && !(input.dayOfMonth && input.dayOfMonth >= 1 && input.dayOfMonth <= 31)) {
    throw new AppError('วันที่ของเดือนต้องอยู่ระหว่าง 1–31')
  }
  if (input.frequency === 'custom' && !(input.intervalDays && input.intervalDays >= 1 && input.intervalDays <= 365)) {
    throw new AppError('ทุกกี่วันต้องอยู่ระหว่าง 1–365')
  }
}

/** The document, with every optional field either present and clean or absent. */
function shape(input: ScheduleInput): Record<string, unknown> {
  const days = [...new Set((input.daysOfWeek ?? []).filter((d) => d >= 0 && d <= 6))].sort()
  const out: Record<string, unknown> = {
    kind: 'stockCount',
    name: input.name.trim(),
    locationId: input.locationId,
    frequency: input.frequency,
    startTime: input.startTime,
    priority: input.priority,
    enabled: input.enabled,
  }
  if (days.length && (input.frequency === 'weekly' || input.frequency === 'biweekly')) out.daysOfWeek = days
  if (input.frequency === 'monthly') out.dayOfMonth = input.dayOfMonth
  if (input.frequency === 'custom') out.intervalDays = input.intervalDays
  if (input.anchorDay !== undefined) out.anchorDay = input.anchorDay
  if (input.durationMin) out.durationMin = input.durationMin
  if (input.assignedToAll) out.assignedToAll = true
  else if (input.assignedTo?.length) out.assignedTo = input.assignedTo
  if (input.assignedToName) out.assignedToName = input.assignedToName
  if (input.requiresApproval) out.requiresApproval = true
  if (input.note?.trim()) out.note = input.note.trim()
  return out
}

const OPTIONAL = ['daysOfWeek', 'dayOfMonth', 'intervalDays', 'anchorDay', 'durationMin', 'assignedTo', 'assignedToAll', 'assignedToName', 'requiresApproval', 'note']

export async function createSchedule(input: ScheduleInput, actor: { id: string }): Promise<string> {
  validate(input)
  const now = Date.now()
  const id = await scoped().add(COL.inventorySchedules, { ...shape(input), createdBy: actor.id, createdAt: now, updatedAt: now })
  invalidateScheduleCache()
  return id
}

export async function updateSchedule(id: string, input: ScheduleInput): Promise<void> {
  validate(input)
  const next = shape(input)
  const patch: Record<string, unknown> = { ...next, updatedAt: Date.now() }
  for (const k of OPTIONAL) if (!(k in next)) patch[k] = DELETE_FIELD
  await scoped().update(COL.inventorySchedules, id, patch)
  invalidateScheduleCache()
}

export async function deleteSchedule(id: string): Promise<void> {
  await scoped().remove(COL.inventorySchedules, id)
  invalidateScheduleCache()
}

/** Every schedule of the open brand, straight from the database. */
export async function listSchedules(): Promise<InventorySchedule[]> {
  const rows = await scoped().getAll<InventorySchedule & { kind: string }>(COL.inventorySchedules)
  return rows.filter((r) => r.kind === 'stockCount').sort((a, b) => a.name.localeCompare(b.name))
}

export async function getSettings(): Promise<InventorySettings> {
  const doc = await scoped().getOne<InventorySettings>(COL.inventorySchedules, 'settings')
  return { ...DEFAULT_INVENTORY_SETTINGS, updatedAt: 0, ...(doc ?? {}) }
}

export async function saveSettings(
  patch: Partial<Omit<InventorySettings, 'id' | 'kind' | 'updatedAt' | 'updatedBy'>>,
  actor: { id: string },
): Promise<void> {
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new AppError('ค่า {what} ต้องเป็นตัวเลขไม่ติดลบ', { what: k })
  }
  const cur = await getSettings()
  const { updatedBy: _u, ...rest } = cur
  void _u
  await scoped().set(COL.inventorySchedules, 'settings', { ...rest, ...patch, kind: 'settings', updatedBy: actor.id, updatedAt: Date.now() })
  invalidateScheduleCache()
}

// ---------------------------------------------------------------- session cache ----

let cached: InventorySchedule[] | null = null
let cachedSettings: InventorySettings | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()
const NONE: InventorySchedule[] = []
const DEFAULTS: InventorySettings = { ...DEFAULT_INVENTORY_SETTINGS, updatedAt: 0 }

function announce(): void {
  for (const fn of listeners) fn()
}

export function invalidateScheduleCache(): void {
  cached = null
  cachedSettings = null
  inflight = null
  announce()
}

onBrandChange(invalidateScheduleCache)

export async function loadScheduleConfig(): Promise<{ schedules: InventorySchedule[]; settings: InventorySettings }> {
  if (cached && cachedSettings) return { schedules: cached, settings: cachedSettings }
  if (!inflight) {
    inflight = (async () => {
      try {
        // One read of the whole collection: schedules and the settings document together.
        const rows = await scoped().getAll<Record<string, unknown> & { id: string; kind: string }>(COL.inventorySchedules)
        cached = rows
          .filter((r) => r.kind === 'stockCount')
          .map((r) => r as unknown as InventorySchedule)
          .sort((a, b) => a.name.localeCompare(b.name))
        const settings = rows.find((r) => r.id === 'settings') as unknown as InventorySettings | undefined
        cachedSettings = { ...DEFAULTS, ...(settings ?? {}) }
      } catch {
        // A refused read must not stop the calendar; it simply has no schedules to show.
        cached = NONE
        cachedSettings = DEFAULTS
      } finally {
        inflight = null
        announce()
      }
    })()
  }
  await inflight
  return { schedules: cached ?? NONE, settings: cachedSettings ?? DEFAULTS }
}

/** The schedules and settings, fetched the first time a screen asks. */
export function useScheduleConfig(): { schedules: InventorySchedule[]; settings: InventorySettings; loaded: boolean } {
  const snap = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => cached,
    () => cached,
  )
  // Again whenever the cache is emptied — a save or a brand switch — not only on mount,
  // or the screen that saved waits on a load nobody started.
  useEffect(() => {
    if (snap === null) void loadScheduleConfig()
  }, [snap])
  return { schedules: snap ?? NONE, settings: cachedSettings ?? DEFAULTS, loaded: snap !== null }
}
