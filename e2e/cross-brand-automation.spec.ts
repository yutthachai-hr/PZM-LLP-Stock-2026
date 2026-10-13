import { expect, test, type Page } from '@playwright/test'
import { listDocs, putMany } from './emulator'
import { PASSWORD, PEOPLE, seedStage } from './fixture'

/**
 * Background jobs and brand switching (owner, 12 Oct 2026). The notification jobs run as soon
 * as a brand opens (cloud mode, admin, no Worker report); the brand is switched back and forth
 * while they run. Every notification any brand ends up with must be about that brand's own
 * products and places — none filed under the brand switched to mid-job.
 *
 * Switches the way the app offers today: the in-app brand list when it exists (PR #10), else
 * the account menu's "สลับแบรนด์" and the full-screen picker (main before #10).
 */

const brands = { pizza: '', lelapin: 'lelapin__', rnd: 'rnd__' } as const
const LABEL: Record<keyof typeof brands, string> = { pizza: 'Pizza Mania', lelapin: 'Le Lapin', rnd: 'R&D' }

async function stage() {
  await seedStage()
  const now = Date.now()
  const product = (prefix: string, id: string, name: string) => ({
    path: `${prefix}products/${id}`,
    // A minimum and no stock: every brand has something to announce.
    data: { sku: id.toUpperCase(), name, category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 5, hasImage: false, active: true, createdAt: now, updatedAt: now },
  })
  await putMany([
    product('', 'pz-flour', 'PIZZA FLOUR'),
    { path: 'lelapin__locations/lwh', data: { name: 'Le Lapin Kitchen', type: 'warehouse', active: true, createdAt: now } },
    product('lelapin__', 'll-bread', 'LAPIN BREAD'),
    { path: 'rnd__locations/rwh', data: { name: 'R&D Kitchen', type: 'warehouse', active: true, createdAt: now } },
    product('rnd__', 'rd-sumac', 'RND SUMAC'),
  ])
}

async function switchTo(page: Page, brand: keyof typeof brands) {
  const list = page.getByRole('button', { name: /^แบรนด์: / }).locator('visible=true').first()
  if (await list.isVisible().catch(() => false)) {
    await list.click({ timeout: 20_000 })
    await page.getByRole('menuitemradio', { name: new RegExp(LABEL[brand].replace('&', '\\&')) }).click()
    await expect(list).toHaveAccessibleName(new RegExp(LABEL[brand].replace('&', '\\&')))
    return
  }
  await page.getByRole('button', { name: 'บัญชีผู้ใช้' }).click()
  await page.getByRole('menuitem', { name: 'สลับแบรนด์' }).click()
  await page.getByRole('button', { name: brand === 'pizza' ? 'Pizza Mania' : new RegExp(`^${LABEL[brand].replace('&', '\\&')}`), exact: brand === 'pizza' }).click()
  await expect(page.locator('main')).toBeVisible()
}

test('notifications written while switching brands stay with their own brand', async ({ browser }) => {
  test.setTimeout(180_000)
  await stage()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('/')
  await page.getByRole('textbox', { name: /email|อีเมล/i }).fill(PEOPLE.admin.email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await page.getByRole('button', { name: 'Pizza Mania', exact: true }).click()
  await expect(page.locator('main')).toBeVisible()

  // Rapid Pizza ↔ Le Lapin, then R&D, while each brand's jobs are starting.
  for (const b of ['lelapin', 'pizza', 'lelapin', 'pizza', 'rnd', 'lelapin', 'pizza'] as const) {
    await page.waitForTimeout(300 + Math.floor(Math.random() * 900))
    await switchTo(page, b)
  }
  // Then each brand opened once more and left to settle. A job a switch interrupted runs
  // again here (none lost); one whose "done" marker was filed under the wrong brand would be
  // skipped here for half an hour (the lost-run symptom) and leave that brand empty.
  for (const b of ['rnd', 'lelapin', 'pizza'] as const) {
    await switchTo(page, b)
    await page.waitForTimeout(6_000)
  }

  const found: Record<string, number> = {}
  for (const [brand, prefix] of Object.entries(brands)) {
    const products = new Set((await listDocs(`${prefix}products`)).map((p) => p.id))
    const places = new Set((await listDocs(`${prefix}locations`)).map((p) => p.id))
    const notes = await listDocs(`${prefix}notifications`)
    found[brand] = notes.length
    for (const n of notes) {
      const { productId, locationId } = n as { productId?: string; locationId?: string }
      if (productId) expect(products.has(productId), `${brand} notification ${n.id} is about product ${productId}`).toBe(true)
      if (locationId) expect(places.has(locationId), `${brand} notification ${n.id} is about place ${locationId}`).toBe(true)
    }
  }
  console.log('CROSS-BRAND', JSON.stringify(found))
  // The jobs did run in every brand (otherwise this proves nothing).
  for (const brand of Object.keys(brands)) expect(found[brand], `${brand} had no notifications at all`).toBeGreaterThan(0)
})
