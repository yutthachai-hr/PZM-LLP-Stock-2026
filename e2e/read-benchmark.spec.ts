import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { seedBigBrand, BIG } from './bigFixture'
import { open, signedIn } from './app'

/**
 * The Firestore read benchmark (release gate). On a production-sized brand (bigFixture),
 * each scenario's document reads are counted where they happen: the app's own tally
 * (data/readMeter — listeners, queries, single reads, transaction reads) and the stock
 * commands' reads on the server (e2e/command-server.mjs). Nothing is estimated from code.
 *
 * Cold = a fresh browser (what a phone pays opening the app from its home screen, and what
 * a listener costs again after 30 minutes away). Warm = moving around inside the app.
 *
 *   READ_BENCH_LABEL=after npx playwright test read-benchmark
 */

type Tally = { total: number; byCollection: Record<string, number> }

async function settle(page: Page): Promise<Tally> {
  // Listeners deliver their first snapshot a moment after the screen draws: wait for that,
  // then until the count has not moved for 3 seconds.
  await page.waitForTimeout(2500)
  let last = -1
  let stable = 0
  for (let i = 0; i < 60 && stable < 6; i++) {
    await page.waitForTimeout(500)
    const t = await page.evaluate(() => (window as unknown as { __pzmReads: { tally: () => { total: number } } }).__pzmReads.tally().total)
    stable = t === last ? stable + 1 : 0
    last = t
  }
  return page.evaluate(() => (window as unknown as { __pzmReads: { tally: () => Tally } }).__pzmReads.tally())
}
const reset = (page: Page) => page.evaluate(() => (window as unknown as { __pzmReads: { reset: () => void } }).__pzmReads.reset())
const serverReads = async (resetIt = false): Promise<number> => ((await (await fetch('http://127.0.0.1:5177/__reads', { method: resetIt ? 'POST' : 'GET' })).json()) as { total: number }).total
const goWarm = async (page: Page, path: string) => {
  await page.evaluate((p) => {
    history.pushState({}, '', p)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

const ROUTES = ['/', '/products', '/receive', '/orders', '/movements', '/suppliers/performance', '/calendar', '/inbox', '/products/p1/card']

test('read benchmark: production-sized brand', async ({ browser }) => {
  test.setTimeout(600_000)
  await seedBigBrand()
  const out: Record<string, unknown> = { label: process.env.READ_BENCH_LABEL ?? 'run', sizes: BIG }
  const row = (name: string, client: Tally, server = 0) => {
    out[name] = { client: client.total, server, total: client.total + server, byCollection: client.byCollection }
  }

  // Cold start: sign in, land on the dashboard.
  await serverReads(true)
  const page = await signedIn(browser, 'manager')
  row('coldStart.dashboard', await settle(page), await serverReads())

  // Each screen cold (a fresh page load straight to it) and warm (navigated to in-app).
  for (const path of ROUTES.slice(1)) {
    await reset(page)
    await serverReads(true)
    await goWarm(page, path)
    row(`warm.${path}`, await settle(page), await serverReads())
  }
  // The whole round again: what switching between screens costs once each was visited.
  await reset(page)
  for (const path of ROUTES) await goWarm(page, path).then(() => page.waitForTimeout(600))
  row('routeSwitching.secondRound', await settle(page))

  // The bell: opening it reads nothing new (its notifications are already held).
  await goWarm(page, '/')
  await settle(page)
  await reset(page)
  await page.getByRole('button', { name: /การแจ้งเตือน/ }).first().click()
  row('notifications.openBell', await settle(page))
  await page.keyboard.press('Escape')

  // Reconnect inside the session (the listeners resume).
  await reset(page)
  await page.context().setOffline(true)
  await page.waitForTimeout(3000)
  await page.context().setOffline(false)
  row('reconnect.inSession', await settle(page))

  // A second tab in the same browser.
  const tab = await page.context().newPage()
  await open(tab, '/')
  row('secondTab.dashboard', await settle(tab))

  // Cold straight to each screen: what a reload or a fresh open of that screen costs.
  for (const path of ROUTES.slice(1)) {
    await serverReads(true)
    const p2 = await page.context().newPage()
    await open(p2, path)
    row(`cold.${path}`, await settle(p2), await serverReads())
    await p2.close()
  }

  // Listeners left behind after closing the extra tab and moving to a quiet screen.
  await goWarm(page, '/settings')
  await page.waitForTimeout(1500)
  out.liveListenersOnSettings = await page.evaluate(() => (window as unknown as { __pzmReads: { listeners: () => unknown } }).__pzmReads.listeners())

  mkdirSync('test-results', { recursive: true })
  writeFileSync(`test-results/read-benchmark-${out.label}.json`, JSON.stringify(out, null, 1))
  expect((out['coldStart.dashboard'] as { total: number }).total).toBeGreaterThan(0)
})
