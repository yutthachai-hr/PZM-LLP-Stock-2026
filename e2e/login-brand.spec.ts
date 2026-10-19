import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { putDoc, putMany } from './emulator'
import { PASSWORD, PEOPLE, seedStage } from './fixture'
import { open } from './app'

/**
 * The brand picked on the sign-in screen is the brand that opens (owner's Production
 * recording, 14 Oct 2026: Le Lapin picked, Pizza Mania's Dashboard opened, because the
 * device's last brand won). Checked through sign-in all the way to the data the app reads:
 * the label, the colour and the collections must be the same brand, and the brand that
 * was not picked must never be read on the way in.
 */

type BrandId = 'pizza' | 'lelapin' | 'rnd'
const NAME: Record<BrandId, RegExp> = { pizza: /Pizza Mania/, lelapin: /Le Lapin/, rnd: /R&D/ }
const RADIO: Record<BrandId, string> = { pizza: 'Pizza Mania', lelapin: 'Le Lapin Sandwich Delivery', rnd: 'R&D (Research & Development)' }
const ACCENT: Record<BrandId, string> = { pizza: '#b91c1c', lelapin: '#c2410c', rnd: '#003291' }
const ITEM: Record<BrandId, string> = { pizza: 'FLOUR', lelapin: 'BAGUETTE', rnd: 'SUMAC POWDER' }
const SHARED = new Set(['users', 'meta', 'revokedUsers'])

async function stage() {
  const seeded = await seedStage()
  const now = Date.now()
  const p = (path: string, name: string, sku: string) => ({
    path,
    data: { sku, name, category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now },
  })
  await putMany([
    { path: 'lelapin__locations/lwh', data: { name: 'Le Lapin Kitchen', type: 'warehouse', active: true, createdAt: now } },
    { path: 'rnd__locations/rwh', data: { name: 'R&D Kitchen', type: 'warehouse', active: true, createdAt: now } },
    p('lelapin__products/baguette', 'BAGUETTE', 'BAK-01-001'),
    p('rnd__products/sumac', 'SUMAC POWDER', 'RND-01-001'),
  ])
  return seeded
}

/** A device whose last-opened brand is `last` (what the old code let win). */
async function device(browser: import('@playwright/test').Browser, last: BrandId | null): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (last) await context.addInitScript((b) => { if (!localStorage.getItem('pmstock:v1:lastBrand')) localStorage.setItem('pmstock:v1:lastBrand', b) }, last)
  return context
}

const trigger = (page: Page) => page.getByRole('button', { name: /^แบรนด์: / }).locator('visible=true').first()

async function fillSignIn(page: Page, password = PASSWORD) {
  await page.getByRole('textbox', { name: /email|อีเมล/i }).fill(PEOPLE.admin.email)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
}

/** Collections this page has read or listened to since it loaded (brand-resolved names). */
async function readCollections(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const t = (window as unknown as { __pzmReads: { tally: () => { stats: { collection: string }[] } } }).__pzmReads.tally()
    return [...new Set(t.stats.map((s) => s.collection))].sort()
  })
}

/** The brand a resolved collection name belongs to (Pizza Mania is the unprefixed one). */
const ownerOf = (c: string): BrandId | 'shared' => (SHARED.has(c) ? 'shared' : c.startsWith('lelapin__') ? 'lelapin' : c.startsWith('rnd__') ? 'rnd' : 'pizza')

async function expectOpenIn(page: Page, brand: BrandId) {
  await expect(page.getByRole('textbox', { name: /email|อีเมล/i })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'เลือกแบรนด์' })).toHaveCount(0)
  await expect(trigger(page)).toHaveAccessibleName(NAME[brand])
  // The colour the interface is painted in (BrandContext) is the same brand.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-accent').trim())).toBe(ACCENT[brand])
  await expect(page.locator('main')).toBeVisible()
}

/** Every brand-scoped read so far belongs to `brand`, and its products were read. */
async function expectOnlyRead(page: Page, brand: BrandId) {
  const products = brand === 'pizza' ? 'products' : `${brand}__products`
  // Another brand's reads fail the test as soon as they appear, not only after this brand's
  // own products have loaded (a late switch would load them too).
  let seen: string[] = []
  await expect
    .poll(
      async () => {
        seen = await readCollections(page)
        const foreign = seen.filter((c) => ownerOf(c) !== 'shared' && ownerOf(c) !== brand)
        return foreign.length > 0 ? `foreign: ${foreign.join(', ')}` : seen.includes(products) ? 'ok' : 'waiting'
      },
      { timeout: 15_000 },
    )
    .toBe('ok')
  const foreign = seen.filter((c) => ownerOf(c) !== 'shared' && ownerOf(c) !== brand)
  expect(foreign, `collections of another brand read on the way in: ${foreign.join(', ')}`).toEqual([])
}

async function catalogue(page: Page, brand: BrandId): Promise<string> {
  await open(page, '/products')
  // Wait for actual data, not absence of a loading node before the route has mounted.
  await expect(page.locator('main')).toContainText(ITEM[brand])
  return page.locator('main').innerText()
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

for (const [last, pick, width] of [
  ['pizza', 'lelapin', 1440],
  ['lelapin', 'pizza', 1440],
  ['pizza', 'rnd', 1440],
  ['pizza', 'lelapin', 390],
] as [BrandId, BrandId, number][]) {
  test(`last brand ${last}, ${pick} picked at ${width}px: ${pick} opens, and only ${pick} is read`, async ({ browser }) => {
    await stage()
    const context = await device(browser, last)
    const page = await context.newPage()
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.goto('/')
    await page.getByRole('radio', { name: RADIO[pick], exact: true }).click()
    await expect(page.getByRole('radio', { name: RADIO[pick], exact: true })).toHaveAttribute('aria-checked', 'true')
    await fillSignIn(page)
    await expectOpenIn(page, pick)
    await expectOnlyRead(page, pick)
    const text = await catalogue(page, pick)
    expect(text).toContain(ITEM[pick])
    for (const other of (['pizza', 'lelapin', 'rnd'] as BrandId[]).filter((b) => b !== pick)) expect(text).not.toContain(ITEM[other])
    await context.close()
  })
}
test('a failed sign-in keeps the device on its last brand; the next sign-in without a pick opens it', async ({ browser }) => {
  await stage()
  const context = await device(browser, 'pizza')
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('radio', { name: RADIO.lelapin, exact: true }).click()
  await fillSignIn(page, 'wrong-password-1')
  await expect(page.getByRole('textbox', { name: /email|อีเมล/i })).toBeVisible()
  await expect(page.getByRole('alert')).toBeVisible()
  // Nothing about the business context was saved by the attempt.
  expect(await page.evaluate(() => [localStorage.getItem('pmstock:v1:lastBrand'), sessionStorage.getItem('pmstock:v1:tabBrand')])).toEqual(['pizza', null])
  // A fresh visit, no pick: the device's last brand, as before.
  await page.reload()
  await fillSignIn(page)
  await expectOpenIn(page, 'pizza')
  await context.close()
})

test('after a pick, a refresh stays in that brand and a new tab opens it as the last brand', async ({ browser }) => {
  await stage()
  const context = await device(browser, 'pizza')
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('radio', { name: RADIO.lelapin, exact: true }).click()
  await fillSignIn(page)
  await expectOpenIn(page, 'lelapin')
  await page.reload()
  await expectOpenIn(page, 'lelapin')
  await expectOnlyRead(page, 'lelapin')
  const tab = await context.newPage()
  await tab.goto('/')
  await expectOpenIn(tab, 'lelapin')
  await expectOnlyRead(tab, 'lelapin')
  await context.close()
})

test('a LINE resume link opens its own brand, and the sign-in screen shows that brand', async ({ browser }) => {
  await stage()
  const context = await device(browser, 'pizza')
  const page = await context.newPage()
  await page.goto('/orders?send=po1&brand=rnd')
  await expect(page.getByRole('radio', { name: RADIO.rnd, exact: true })).toHaveAttribute('aria-checked', 'true')
  await fillSignIn(page)
  await expectOpenIn(page, 'rnd')
  await expectOnlyRead(page, 'rnd')
  await context.close()
})

test('brand selection stays locked while the successful credential request awaits its business profile', async ({ browser }) => {
  await stage()
  const context = await device(browser, 'pizza')
  const page = await context.newPage()
  let release!: () => void
  let started!: () => void
  const hold = new Promise<void>((resolve) => { release = resolve })
  const listening = new Promise<void>((resolve) => { started = resolve })
  let released = false
  await page.route('**/Listen/channel**', async (route) => {
    if (!released) { started(); await hold }
    await route.continue().catch(() => {})
  })
  try {
    await page.goto('/')
    await page.getByRole('radio', { name: RADIO.lelapin, exact: true }).click()
    const credentialsAccepted = page.waitForResponse((r) => r.url().includes('accounts:signInWithPassword') && r.status() === 200)
    await fillSignIn(page)
    await credentialsAccepted
    await listening
    // The profile listener cannot return yet: authenticating is not finished just because
    // Firebase accepted the credentials. The displayed choice must not drift from intent.
    await expect(page.getByRole('radio', { name: RADIO.lelapin, exact: true })).toBeDisabled()
    await expect(page.getByRole('radio', { name: RADIO.rnd, exact: true })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: /email|อีเมล/i })).toBeVisible()
    expect((await readCollections(page)).filter((c) => !SHARED.has(c))).toEqual([])
    released = true
    release()
    await expectOpenIn(page, 'lelapin')
    await expectOnlyRead(page, 'lelapin')
  } finally {
    released = true
    release()
    await context.close()
  }
})

test('inactive business profile rejection clears intent and leaves the last brand unchanged', async ({ browser }) => {
  const seeded = await stage()
  await putDoc(`users/${seeded.uid.admin}`, {
    name: PEOPLE.admin.name, email: PEOPLE.admin.email, role: 'admin', active: false, createdAt: Date.now(),
  }, { stampId: false })
  const context = await device(browser, 'pizza')
  const page = await context.newPage()
  try {
    await page.goto('/')
    await page.getByRole('radio', { name: RADIO.lelapin, exact: true }).click()
    await fillSignIn(page)
    await expect(page.getByText('บัญชีนี้ยังไม่ได้เปิดใช้งาน', { exact: false }).or(
      page.getByText('บัญชีนี้ยังไม่ถูกเปิดใช้งาน', { exact: false }),
    )).toBeVisible()
    await expect.poll(() => page.evaluate(async () => {
      const modulePath = '/src/brand/brand.ts'
      return (await import(modulePath)).pendingSignInBrand()
    })).toBeNull()
    expect(await page.evaluate(() => [localStorage.getItem('pmstock:v1:lastBrand'), sessionStorage.getItem('pmstock:v1:tabBrand')])).toEqual(['pizza', null])
    expect((await readCollections(page)).filter((c) => !SHARED.has(c))).toEqual([])
    await expect(page.getByRole('radio', { name: RADIO.lelapin, exact: true })).toBeEnabled()
  } finally { await context.close() }
})

test('an explicit pick conflicting with a LINE resume opens that brand without reusing the resume document ID', async ({ browser }) => {
  await stage() // Pizza has po1; the resume refers to R&D's namespace, not Pizza's po1.
  const context = await device(browser, 'pizza')
  const page = await context.newPage()
  try {
    await page.goto('/orders?send=po1&brand=rnd')
    await page.getByRole('radio', { name: RADIO.pizza, exact: true }).click()
    await fillSignIn(page)
    await expectOpenIn(page, 'pizza')
    await expect(page).toHaveURL(/\/$/)
    await expectOnlyRead(page, 'pizza')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally { await context.close() }
})

test('a device that has never opened a brand still gets the picker when nothing is picked', async ({ browser }) => {
  await stage()
  const context = await device(browser, null)
  const page = await context.newPage()
  await page.goto('/')
  await fillSignIn(page)
  await expect(page.getByRole('heading', { name: 'เลือกแบรนด์' })).toBeVisible()
  await page.getByRole('button', { name: 'Pizza Mania', exact: true }).click()
  await expectOpenIn(page, 'pizza')
  await context.close()
})
