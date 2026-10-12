import { expect, test, type Page } from '@playwright/test'
import { listDocs, putMany } from './emulator'
import { PASSWORD, PEOPLE, seedStage } from './fixture'

/**
 * #10 + #11 together (owner, 12 Oct 2026): the background notification jobs run while the
 * brand is switched back and forth. Every notification any brand ends up with must be about
 * that brand's own products — none filed under the brand switched to mid-job.
 */

const brands = { pizza: '', lelapin: 'lelapin__', rnd: 'rnd__' } as const

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

const trigger = (page: Page) => page.getByRole('button', { name: /^แบรนด์: / }).locator('visible=true').first()

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

  // Switch while each brand's jobs are starting (they run as soon as a brand opens).
  for (const name of [/Le Lapin/, /R&D/, /Pizza Mania/, /Le Lapin/, /Pizza Mania/, /R&D/, /Le Lapin/]) {
    await page.waitForTimeout(400 + Math.floor(Math.random() * 900))
    await trigger(page).click({ timeout: 20_000 })
    await page.getByRole('menuitemradio', { name }).click()
    await expect(trigger(page)).toHaveAccessibleName(name)
  }
  // Let the last jobs finish.
  await page.waitForTimeout(8_000)

  const productsOf: Record<string, Set<string>> = {}
  const found: Record<string, number> = {}
  for (const [brand, prefix] of Object.entries(brands)) {
    productsOf[brand] = new Set((await listDocs(`${prefix}products`)).map((p) => p.id))
    const notes = await listDocs(`${prefix}notifications`)
    found[brand] = notes.length
    for (const n of notes) {
      const productId = (n as { productId?: string }).productId
      if (productId) expect(productsOf[brand].has(productId), `${brand} notification ${n.id} is about ${productId}`).toBe(true)
    }
  }
  console.log('CROSS-BRAND', JSON.stringify(found))
  // The jobs did run (otherwise this test proves nothing).
  expect(Object.values(found).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
})
