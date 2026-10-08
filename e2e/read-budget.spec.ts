import { writeFileSync, mkdirSync } from 'node:fs'
import { test, type Page } from '@playwright/test'
import { backupPath, seedFromBackup } from './backupStage'
import { listDocs, putDoc, putPaths } from './emulator'
import { open, signedIn } from './app'
import type { Person } from './fixture'

/**
 * Read-cost benchmark (perf/firestore-read-budget, 6 Oct 2026): what each everyday
 * workflow costs in Firestore reads, measured by the app's own read meter
 * (data/readMeter.ts, `window.__pzmReads`) against a real brand's data in the emulator.
 *
 *   PZM_BACKUP="D:\AI Solution\pzm-stock-pizza-....json" READ_BENCH_LABEL=before \
 *     npm run test:e2e -- e2e/read-budget.spec.ts
 *
 * Skipped without PZM_BACKUP. Writes e2e-results/read-budget-<label>.json.
 */

const file = backupPath()
const label = process.env.READ_BENCH_LABEL ?? 'run'
test.skip(!file, 'set PZM_BACKUP to a backup file to run the read benchmark')
test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

interface Tally {
  total: number
  docs: number
  listeners: { active: number; bootstraps: number; updates: number; resumes: number }
  stats: { label: string; collection: string; kind: string; queries: number; docs: number; billed: number }[]
}

const results: Record<string, { billed: number; docs: number; listeners: Tally['listeners']; top: Tally['stats'] }> = {}

async function tally(page: Page): Promise<Tally> {
  return page.evaluate(() => (window as unknown as { __pzmReads: { tally: () => Tally } }).__pzmReads.tally())
}
async function reset(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __pzmReads: { reset: () => void } }).__pzmReads.reset())
}
/** Settle: no new reads for 2.5 s (or 20 s at most). */
async function settle(page: Page): Promise<void> {
  let last = -1
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(1250)
    const t = (await tally(page)).total
    if (t === last) {
      await page.waitForTimeout(1250)
      if ((await tally(page)).total === t) return
    }
    last = t
  }
}
async function record(name: string, page: Page): Promise<void> {
  await settle(page)
  const t = await tally(page)
  results[name] = { billed: t.total, docs: t.docs, listeners: t.listeners, top: t.stats.slice(0, 8) }
  save()
}
function save(): void {
  mkdirSync('e2e-results', { recursive: true })
  writeFileSync(`e2e-results/read-budget-${label}.json`, JSON.stringify({ label, at: new Date().toISOString(), backupCounts: counts, results }, null, 2))
}
/** In-app navigation: no reload, the way a person taps the menu. */
async function go(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    history.pushState({}, '', p)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}
async function scenario(page: Page, name: string, path: string): Promise<void> {
  await reset(page)
  await go(page, path)
  await record(name, page)
}

let counts: Record<string, number> = {}

test('read budget: everyday workflows on real data', async ({ browser }) => {
  counts = (await seedFromBackup(file!)).counts

  // Warm-up, not measured: a manager's browser has already run the notification jobs once,
  // as it has in production, so the measured sessions see the steady state rather than the
  // first-ever burst of ~130 notifications an empty emulator produces.
  const warm = await signedIn(browser, 'manager')
  await settle(warm)
  await warm.context().close()
  // …and those notifications were written hours ago, not seconds: age them two hours.
  const aged = (await listDocs('notifications')).map((n) => ({
    path: `notifications/${n.id}`,
    data: { ...n, createdAt: Number(n.createdAt) - 2 * 3_600_000, updatedAt: Number(n.updatedAt) - 2 * 3_600_000 } as Record<string, unknown>,
  }))
  await putPaths(aged)

  // 1, 15. Cold open as a manager — includes the background jobs a manager's browser runs.
  const manager = await signedIn(browser, 'manager')
  await record('01 cold open (manager)', manager)

  // 1b. The same device opening the app again later (a reload: a new session, the device's
  // own copies kept) — the everyday case of a phone reopening the PWA.
  await reset(manager)
  await open(manager, '/')
  await record('01b reopen app (same device)', manager)

  // 2–6, 9, 11. Screens, one at a time, without reloading.
  await scenario(manager, '02 dashboard', '/')
  await scenario(manager, '03 products', '/products')
  await scenario(manager, '04 receiving', '/receive')
  await scenario(manager, '05 purchase orders', '/orders')
  await scenario(manager, '06 suppliers', '/suppliers')
  await scenario(manager, '06b supplier performance', '/suppliers/performance')
  await scenario(manager, '09 movement history', '/movements')
  await scenario(manager, '11 calendar', '/calendar')

  // 12. Switching routes repeatedly.
  await reset(manager)
  for (let i = 0; i < 3; i++) for (const p of ['/', '/products', '/orders', '/movements', '/calendar']) await go(manager, p)
  await record('12 switching routes x3', manager)

  // 7. A notification arrives (written by someone else) — what each open device pays.
  await go(manager, '/')
  await reset(manager)
  const now = Date.now()
  await putDoc(`notifications/bench-${now}`, {
    kind: 'poDelayed', category: 'purchasing', link: '/orders',
    to: { roles: ['manager', 'admin'] }, audienceKeys: ['role:manager', 'role:admin'], params: {}, active: true, readBy: {},
    priority: 'high', createdBy: 'bench', expiresAt: now + 7 * 86_400_000, createdAt: now, updatedAt: now, source: 'worker',
  })
  await record('07 notification arrival', manager)

  // 8. Opening the notification centre (bell).
  await reset(manager)
  await manager.getByRole('button', { name: /แจ้งเตือน/ }).first().click().catch(() => {})
  await record('08 open notification centre', manager)

  // 13. Back after a long absence (>30 min): listeners are billed in full again.
  await reset(manager)
  await manager.context().setOffline(true)
  await manager.evaluate(() => (window as unknown as { __pzmReads: { markLongAbsence: () => void } }).__pzmReads.markLongAbsence())
  await manager.waitForTimeout(1500)
  await manager.context().setOffline(false)
  // The SDK backs off before reconnecting; give every listener time to hear from the server.
  await manager.waitForTimeout(15_000)
  await record('13 reconnect after long absence', manager)

  // 14. A second tab of the same person.
  const tab2 = await manager.context().newPage()
  await open(tab2, '/')
  await record('14 second tab', tab2)

  // 16. Cold open as staff.
  const staff = await signedIn(browser, 'staffA' as Person)
  await record('16 cold open (staff)', staff)

  save()
  console.log(`\nREAD BUDGET (${label})`)
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(36)} billed ${String(v.billed).padStart(6)}  docs ${String(v.docs).padStart(6)}  listeners ${v.listeners.active}`)
})
