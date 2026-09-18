// The free plan allows 50,000 reads and 20,000 writes a day, shared by both brands. This
// models what the calendar, the notifications and the cron Worker add, from the real
// constants, and fails when the day goes over 30,000 reads or 5,000 writes — the margin
// the owner's other use needs. Sizes are the live catalogue's (Sept 2026), rounded up.
//
//   npm test

import { expect, test, vi } from 'vitest'
import { NOTIFICATION_WINDOW_DAYS } from '../src/lib/inventoryRules/notifications'
import { CRONS } from '../worker/src/jobs'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'cloud' }
})
const { CLIENT_NOTIFY_EVERY_MS } = await import('../src/services/automation')

const BRANDS = 2
const DEVICES = 4 // tablets and phones that open the app each day, per brand
const SIZE = {
  products: 460,
  locations: 3,
  stockLevels: 1400,
  minOverrides: 50,
  suppliers: 30,
  movementsPerDay: 60,
  openTasks: 20,
  openOrders: 15,
  openRequests: 10,
  activeNotifications: 80,
  notificationsPerDay: 40,
  configDocs: 15,
  tasksPerDay: 3,
}

test('the day stays inside the free quota with room to spare', () => {
  const runsPerDay = (kind: string) => {
    const cron = Object.entries(CRONS).find(([, k]) => k === kind)![0]
    if (cron.startsWith('*/30')) return 48
    return cron.endsWith('* * 1') ? 1 / 7 : 1
  }

  // Worker, per brand.
  const frequent = runsPerDay('frequent') * (1 + SIZE.locations + SIZE.openTasks + 5)
  const morning =
    runsPerDay('morning') *
    (SIZE.configDocs + SIZE.locations + SIZE.products + SIZE.stockLevels + SIZE.minOverrides + SIZE.movementsPerDay * 30 + SIZE.suppliers + SIZE.openOrders + SIZE.openRequests + SIZE.openTasks + SIZE.activeNotifications)
  const generate = runsPerDay('generate') * (SIZE.configDocs + SIZE.notificationsPerDay)
  const weekly = runsPerDay('weekly') * (SIZE.configDocs + SIZE.locations + SIZE.tasksPerDay * 7 + 30 + SIZE.movementsPerDay * 7 + SIZE.products + SIZE.stockLevels + SIZE.suppliers)
  const worker = BRANDS * (frequent + morning + generate + weekly) + 48 // + its status writes' reads (none) / margin

  // The app, per device: the bell's week of notifications once, then each new one; the
  // calendar's three range reads; the configuration.
  const bell = SIZE.notificationsPerDay * NOTIFICATION_WINDOW_DAYS + SIZE.notificationsPerDay
  const calendar = SIZE.tasksPerDay * 35 + SIZE.openOrders * 3 + SIZE.openRequests * 2
  const app = BRANDS * DEVICES * (bell + calendar + SIZE.configDocs)

  // What the app read before any of this (listeners on products, balances, the 30-day ledger…).
  const baseline = 12_000
  const reads = baseline + worker + app

  // Writes: tasks generated, notifications created and resolved, read marks, heartbeats.
  const writes = BRANDS * (SIZE.tasksPerDay + SIZE.notificationsPerDay * 2 + SIZE.notificationsPerDay * DEVICES) + 48 + 3

  // The app standing in for the Worker is off while the Worker reports in; when it does
  // run it is at most every half hour, on managers' devices only.
  expect(CLIENT_NOTIFY_EVERY_MS).toBeGreaterThanOrEqual(30 * 60_000)

  expect(reads).toBeLessThan(30_000)
  expect(writes).toBeLessThan(5_000)
  // Printed for HANDOFF's quota table when the sizes change.
  console.info(JSON.stringify({ reads: Math.round(reads), worker: Math.round(worker), app: Math.round(app), writes }))
})
