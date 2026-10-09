import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { putMany } from './emulator'
import { seedStage } from './fixture'
import { open, signedIn } from './app'

/**
 * Suppliers master–detail (owner, 9 Oct 2026): picking a supplier low in a long list must show
 * its details at once — beside the list on a desktop (sticky under the top bar), in a drawer
 * below 1280px — without moving the list.
 *
 * 90 suppliers, named so the ones under test sit at the bottom of the list (NOBLE MONO, ZAKANA,
 * a Thai name), one of them with 70 products so its details scroll inside the panel.
 */

const EVIDENCE = process.env.SUPPLIER_EVIDENCE_DIR
const LABEL = process.env.SUPPLIER_EVIDENCE_LABEL ?? 'after'

const NAMES = [
  ...Array.from({ length: 86 }, (_, i) => `LUCKY SUPPLY ${String(i + 1).padStart(2, '0')}`),
  'NOBLE MONO',
  'Y-CUBE',
  'ZAKANA',
  'ณายลอย เบเกอรี่',
]
const idOf = (name: string) => `s-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}`

async function stage() {
  await seedStage()
  const now = Date.now()
  const docs: { path: string; data: Record<string, unknown> }[] = []
  for (const name of NAMES)
    docs.push({ path: `suppliers/${idOf(name)}`, data: { name, code: `SUP-${idOf(name).slice(-4)}`, contactNumber: '020000000', email: '', type: 'takingReturn', active: true, paymentTerms: 'Credit 30 days', createdAt: now, updatedAt: now } })
  // NOBLE MONO: a long product list, so its details scroll inside the panel.
  for (let i = 0; i < 70; i++)
    docs.push({ path: `products/nm-${i}`, data: { sku: `NM-${String(i).padStart(3, '0')}`, name: `NOBLE MONO ITEM ${String(i).padStart(2, '0')}`, category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, supplierId: idOf('NOBLE MONO'), createdAt: now, updatedAt: now } })
  docs.push({ path: 'products/zk-1', data: { sku: 'ZK-001', name: 'ZAKANA SALMON', category: 'Fish', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, supplierId: idOf('ZAKANA'), createdAt: now, updatedAt: now } })
  await putMany(docs)
}

/** The visible select button of a supplier (the table on wider screens, a card on a phone). */
const pick = (page: Page, name: string) => page.locator(`[data-supplier-select="${idOf(name)}"]:visible`).first()

async function shot(page: Page, name: string) {
  if (!EVIDENCE) return
  mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: `${EVIDENCE}/${LABEL}-${name}.png` })
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

for (const vp of [
  { w: 1366, h: 768 },
  { w: 1440, h: 900 },
  { w: 1920, h: 1080 },
]) {
  test(`desktop ${vp.w}x${vp.h}: a supplier picked at the bottom is shown beside the list, list unmoved`, async ({ browser }) => {
    await stage()
    const page = await signedIn(browser, 'admin')
    await page.setViewportSize({ width: vp.w, height: vp.h })
    await open(page, '/suppliers')
    await expect(pick(page, 'ZAKANA')).toBeVisible()

    // Down to the end of the list, then pick from there.
    await pick(page, 'ณายลอย เบเกอรี่').scrollIntoViewIfNeeded()
    await page.mouse.wheel(0, 4000)
    await page.waitForTimeout(200)
    const y0 = await page.evaluate(() => scrollY)
    expect(y0).toBeGreaterThan(400)
    await pick(page, 'NOBLE MONO').click()
    const panel = page.locator('[data-supplier-panel]')
    await expect(panel.getByText('NOBLE MONO', { exact: true }).first()).toBeVisible()
    // In view, under the top bar, without scrolling back up.
    const box = (await panel.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(60)
    expect(box.y + box.height).toBeLessThanOrEqual(vp.h + 1)
    expect(Math.abs((await page.evaluate(() => scrollY)) - y0)).toBeLessThan(4)
    await expect(panel.getByRole('link', { name: 'NOBLE MONO ITEM 00' })).toBeVisible()
    await shot(page, `${vp.w}x${vp.h}-bottom-pick`)

    // The long list scrolls inside the panel; heading and close stay put.
    const body = panel.locator('[data-detail-body]')
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await expect(panel.getByRole('button', { name: 'ปิด' })).toBeInViewport()
    expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

    // Another supplier low down: the list stays where it is; the details start at their top.
    await pick(page, 'ZAKANA').click()
    await expect(panel.getByText('ZAKANA', { exact: true }).first()).toBeVisible()
    await expect(panel.getByRole('link', { name: 'ZAKANA SALMON' })).toBeVisible()
    expect(Math.abs((await page.evaluate(() => scrollY)) - y0)).toBeLessThan(4)
    expect(await body.evaluate((el) => el.scrollTop)).toBe(0)
    await expect(pick(page, 'ZAKANA')).toHaveAttribute('aria-pressed', 'true')

    // Rapid switching does not move the list either.
    for (const n of ['Y-CUBE', 'NOBLE MONO', 'ZAKANA', 'LUCKY SUPPLY 80', 'NOBLE MONO']) await pick(page, n).click()
    await expect(panel.getByText('NOBLE MONO', { exact: true }).first()).toBeVisible()
    expect(Math.abs((await page.evaluate(() => scrollY)) - y0)).toBeLessThan(4)
  })
}

test('desktop: sort, search and a filtered-out choice keep the details sensible', async ({ browser }) => {
  await stage()
  const page = await signedIn(browser, 'admin')
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/suppliers')
  await pick(page, 'NOBLE MONO').click()
  const panel = page.locator('[data-supplier-panel]')
  // Sort by product count: NOBLE MONO (70) goes first, still chosen.
  await page.getByRole('combobox').filter({ hasText: 'ชื่อ ก–ฮ / A–Z' }).selectOption('products')
  await expect(pick(page, 'NOBLE MONO')).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByText('NOBLE MONO', { exact: true }).first()).toBeVisible()
  // A search that hides the chosen row: the details stay, nothing breaks.
  await page.getByPlaceholder(/ค้นหา/).first().fill('ZAKANA')
  await expect(pick(page, 'NOBLE MONO')).toHaveCount(0)
  await expect(panel.getByText('NOBLE MONO', { exact: true }).first()).toBeVisible()
  await pick(page, 'ZAKANA').click()
  await expect(panel.getByText('ZAKANA', { exact: true }).first()).toBeVisible()
})

test('deep link /suppliers?id= opens the details in view (desktop and phone)', async ({ browser }) => {
  await stage()
  const page = await signedIn(browser, 'admin')
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, `/suppliers?id=${idOf('ZAKANA')}`)
  await expect(page.locator('[data-supplier-panel]').getByText('ZAKANA', { exact: true }).first()).toBeInViewport()
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, `/suppliers?id=${idOf('NOBLE MONO')}`)
  await expect(page.getByRole('dialog').getByText('NOBLE MONO', { exact: true }).first()).toBeInViewport()
})

for (const vp of [
  { w: 1024, h: 768, kind: 'tablet' },
  { w: 768, h: 1024, kind: 'tablet' },
  { w: 390, h: 844, kind: 'phone' },
  { w: 375, h: 812, kind: 'phone' },
]) {
  test(`${vp.kind} ${vp.w}x${vp.h}: a drawer, background still, Escape and focus back to the row`, async ({ browser }) => {
    await stage()
    const page = await signedIn(browser, 'admin')
    await page.setViewportSize({ width: vp.w, height: vp.h })
    await open(page, '/suppliers')
    const row = pick(page, 'ZAKANA')
    await row.scrollIntoViewIfNeeded()
    const y0 = await page.evaluate(() => scrollY)
    expect(y0).toBeGreaterThan(300)
    await row.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('ZAKANA', { exact: true }).first()).toBeInViewport()
    await expect(dialog.getByRole('link', { name: 'ZAKANA SALMON' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden')
    const box = (await dialog.locator('> div').first().boundingBox()) ?? (await dialog.boundingBox())!
    if (vp.kind === 'tablet') expect(box.x).toBeGreaterThan(vp.w / 3) // from the right
    await shot(page, `${vp.w}x${vp.h}-drawer`)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('')
    await expect(row).toBeFocused()
    expect(Math.abs((await page.evaluate(() => scrollY)) - y0)).toBeLessThan(4)

    // The ✕ in the drawer works the same, for another supplier.
    await pick(page, 'Y-CUBE').click()
    await expect(dialog.getByText('Y-CUBE', { exact: true }).first()).toBeVisible()
    await dialog.getByRole('button', { name: 'ปิด' }).first().click()
    await expect(dialog).toHaveCount(0)
    await expect(pick(page, 'Y-CUBE')).toBeFocused()
  })
}

test('the supplier name is reachable with the keyboard and opens the details', async ({ browser }) => {
  await stage()
  const page = await signedIn(browser, 'admin')
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, '/suppliers')
  await pick(page, 'Y-CUBE').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-supplier-panel]').getByText('Y-CUBE', { exact: true }).first()).toBeVisible()
})
