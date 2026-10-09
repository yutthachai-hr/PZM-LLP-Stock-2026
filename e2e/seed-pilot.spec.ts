import { expect, test, type Browser, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { seedBigBrand, BIG } from './bigFixture'
import { listDocs } from './emulator'
import { PASSWORD, PEOPLE } from './fixture'

/**
 * P1 cold-start seed pilot: measured Firestore reads with the pilot off and on, on the SAME
 * production-sized brand and the same cold opens as the read benchmark (read-benchmark.spec).
 * Each case is a fresh browser context — a new device, or the daily full re-read — which is
 * the only moment the pilot changes anything.
 *
 * The shadow is a stand-in served here from the emulator's own data (so it is exactly what
 * the Worker would have replicated), with a proof 30 minutes old: the device must then read
 * every change since from Firestore. What it measures: Firestore reads (the app's meter) and
 * the bytes the shadow sent. What it cannot: a real Supabase project's latency and its
 * free-tier limits (no project exists yet).
 */
type Stat = { label: string; billed: number }
type Tally = { total: number; byCollection: Record<string, number>; stats: Stat[] }

async function settle(page: Page): Promise<Tally> {
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

const PROOF_AGE_MS = 30 * 60_000

/** A new device: fresh context, nothing on it; signs in and lands on the dashboard (coldStart.dashboard). */
async function device(browser: Browser, shadow: { rows: Map<string, unknown>; bytes: number[] } | null) {
  const context = await browser.newContext()
  if (shadow) {
    await context.addInitScript(() => localStorage.setItem('pzm.shadowSeed.e2e', JSON.stringify({ brands: ['pizza'] })))
    await context.route('https://shadow.e2e.test/**', async (route) => {
      const url = new URL(route.request().url())
      let body: unknown
      if (url.pathname.endsWith('/rpc/seed_status')) {
        const { p_entity } = route.request().postDataJSON() as { p_entity: string }
        body = { completeThrough: Date.now() - PROOF_AGE_MS, unresolved: 0, syncedAt: Date.now() - 60_000, parityPassedAt: Date.now() - 1000, rows: (shadow.rows.get(p_entity) as unknown[]).length }
      } else {
        const entity = url.pathname.endsWith('/products') ? 'products' : 'stockLevels'
        const all = shadow.rows.get(entity) as unknown[]
        const offset = Number(url.searchParams.get('offset') ?? 0)
        body = all.slice(offset, offset + Number(url.searchParams.get('limit') ?? 1000))
      }
      const text = JSON.stringify(body)
      shadow.bytes.push(text.length)
      await route.fulfill({ status: 200, contentType: 'application/json', body: text, headers: { 'access-control-allow-origin': '*' } })
    })
  }
  const page = await context.newPage()
  await page.goto('/')
  await page.getByPlaceholder('you@email.com').fill(PEOPLE.manager.email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await page.getByRole('button', { name: 'Pizza Mania' }).click()
  await expect(page.locator('main')).toBeVisible()
  const tally = await settle(page)
  const seeds = await page.evaluate(() => (window as unknown as { __pzmReads: { seeds: () => unknown[] } }).__pzmReads.seeds())
  await context.close()
  return { tally, seeds }
}

test('seed pilot: Firestore reads on a cold device, off vs on, production-sized brand', async ({ browser }) => {
  test.setTimeout(600_000)
  await seedBigBrand()
  const products = await listDocs('products')
  const levels = await listDocs('stockLevels')
  const shadow = {
    rows: new Map<string, unknown>([
      ['products', products.map((p) => ({ id: p.id, doc: p }))],
      ['stockLevels', levels.map((l) => {
        const unit = l.id.includes('#') ? l.id.slice(l.id.indexOf('#') + 1) : ''
        return { location_id: l.locationId, product_id: l.productId, unit_key: unit, qty: l.qty, version: l.updatedAt }
      })],
    ]),
    bytes: [] as number[],
  }
  const out: Record<string, unknown> = { sizes: BIG, proofAgeMinutes: PROOF_AGE_MS / 60_000, cases: {} }
  for (const path of ['run1', 'run2', 'run3']) {
    const off = await device(browser, null)
    shadow.bytes.length = 0
    const on = await device(browser, shadow)
    const pick = (t: Tally) => Object.fromEntries(t.stats.filter((s) => /^(products|stockLevels)\./.test(s.label)).map((s) => [s.label, s.billed]))
    ;(out.cases as Record<string, unknown>)[path] = {
      off: { firestore: off.tally.total, productsAndLevels: pick(off.tally) },
      on: { firestore: on.tally.total, productsAndLevels: pick(on.tally), seeds: on.seeds, shadowBytes: shadow.bytes.reduce((a, b) => a + b, 0), shadowRequests: shadow.bytes.length },
      saved: off.tally.total - on.tally.total,
    }
  }
  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/seed-pilot.json', JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out.cases))
  const dash = (out.cases as Record<string, { on: { seeds: { outcome: string }[] }; saved: number }>).run1
  expect(dash.on.seeds.map((s) => s.outcome)).toContain('used')
  expect(dash.saved).toBeGreaterThan(0)
})
