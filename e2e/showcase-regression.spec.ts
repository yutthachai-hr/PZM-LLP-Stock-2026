import { expect, test, type Page, type Request } from '@playwright/test'
import { putDoc } from './emulator'
import { PASSWORD, PEOPLE, seedStage } from './fixture'
import { open, signedIn } from './app'

/**
 * Combined early-release regression (owner, 9 Oct 2026, Step 2): every feature PR together on
 * the emulators — sign-in and brand switching, three-brand separation, smart supplier, global
 * search, notifications that arrive while the app starts — and not one request to a real
 * production service.
 */

// Each test signs in on its own browser context. Close them all afterwards: an app left running
// sees the next test reset the emulator under it, and its own sign-in logic then races the
// next test's (a vanished profile is re-requested as inactive staff).
test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

const DAY = 86_400_000

/** Hosts a test run must never reach: the live Firebase project, Google APIs, the production site. */
const PRODUCTION = /(^|\.)(googleapis\.com|firebaseio\.com|firebaseapp\.com|pzmstock\.pages\.dev|generativelanguage\.googleapis\.com)$/

function watchHosts(page: Page): Set<string> {
  const hosts = new Set<string>()
  page.on('request', (r: Request) => {
    const u = new URL(r.url())
    if (u.protocol === 'http:' || u.protocol === 'https:') hosts.add(u.hostname)
  })
  return hosts
}

async function stage() {
  const s = await seedStage()
  const now = Date.now()
  // Smart supplier: each product mapped to its usual supplier; a second supplier to disagree with.
  await putDoc('suppliers/sup2', { name: 'OTHER SUPPLIER', contactNumber: '020000001', type: 'takingReturn', active: true, createdAt: now, updatedAt: now })
  await putDoc('products/flour', { sku: 'DRY-01-001', name: 'FLOUR', category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, supplierId: 'sup1', createdAt: now, updatedAt: now })
  await putDoc('products/bread', { sku: 'DRY-01-002', name: 'BREAD CRUMB', category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, supplierId: 'sup2', createdAt: now, updatedAt: now })
  // A second brand's own catalogue (brand-scoped collection), never visible from Pizza Mania.
  await putDoc('lelapin__locations/lwh', { name: 'Le Lapin Kitchen', type: 'warehouse', active: true, createdAt: now })
  await putDoc('lelapin__products/baguette', { sku: 'BAK-01-001', name: 'BAGUETTE', category: 'Bakery', unit: 'Piece', unitType: 'EA', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now })
  return s
}

test('sign-in, brand switch and three-brand separation; global search stays inside the brand', async ({ browser }) => {
  await stage()
  const page = await signedIn(browser, 'admin')
  const hosts = watchHosts(page)
  const box = page.getByRole('combobox')

  // Pizza Mania: its product is found, Le Lapin's is not.
  await page.keyboard.press('Control+k')
  await expect(box).toBeFocused()
  await box.fill('flour')
  await expect(page.getByRole('option', { name: /FLOUR/ })).toBeVisible()
  await box.fill('baguette')
  await expect(page.getByRole('option', { name: /BAGUETTE/ })).toHaveCount(0)
  await expect(page.getByText('ไม่พบในข้อมูลที่โหลดไว้')).toBeVisible()
  // A page by its name, and Enter on a product opens its stock card.
  await box.fill('รับสินค้า')
  await expect(page.getByRole('option', { name: 'รับสินค้าเข้า' })).toBeVisible()
  await box.fill('flour')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/products\/flour\/card/)

  // Switch to Le Lapin from the account menu: the other brand's catalogue, and only it.
  await page.getByRole('button', { name: 'บัญชีผู้ใช้' }).click()
  await page.getByRole('menuitem', { name: 'สลับแบรนด์' }).click()
  await page.getByRole('button', { name: /Le Lapin/ }).click()
  await expect(page.locator('main')).toBeVisible()
  await page.keyboard.press('Control+k')
  await box.fill('baguette')
  await expect(page.getByRole('option', { name: /BAGUETTE/ })).toBeVisible()
  await box.fill('flour')
  await expect(page.getByRole('option', { name: /FLOUR/ })).toHaveCount(0)

  expect([...hosts].filter((h) => PRODUCTION.test(h))).toEqual([])
})

test('smart supplier: products pick an empty supplier, a disagreeing product never switches it, a PO locks it', async ({ browser }) => {
  await stage()
  const page = await signedIn(browser, 'staffA', '/receive')
  const hosts = watchHosts(page)
  await page.getByText('รับนอกใบสั่งซื้อ').first().click()
  const search = page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)')

  await search.fill('FLOUR')
  await page.getByRole('button', { name: /FLOUR/ }).first().click()
  await expect(page.getByText('เลือกให้อัตโนมัติจากสินค้าที่เลือก')).toBeVisible()
  await expect(page.locator('select').filter({ hasText: 'E2E SUPPLIER' }).first()).toHaveValue('sup1')

  // A product mapped to another supplier: a conflict is shown, the supplier is not switched.
  await search.fill('BREAD')
  await page.getByRole('button', { name: /BREAD CRUMB/ }).first().click()
  await expect(page.getByText(/BREAD CRUMB ผูกกับ OTHER SUPPLIER/)).toBeVisible()
  await expect(page.locator('select').filter({ hasText: 'E2E SUPPLIER' }).first()).toHaveValue('sup1')

  // A person's own choice stands: picking the other supplier is not undone by the app.
  await page.locator('select').filter({ hasText: 'E2E SUPPLIER' }).first().selectOption('sup2')
  await page.waitForTimeout(300)
  await expect(page.locator('select').filter({ hasText: 'E2E SUPPLIER' }).first()).toHaveValue('sup2')
  await expect(page.getByText('เลือกให้อัตโนมัติจากสินค้าที่เลือก')).toHaveCount(0)

  // Receiving against the order: the order's supplier, labelled with the order.
  await open(page, '/receive?po=po1')
  await expect(page.getByText('จาก PO-00001')).toBeVisible()

  expect([...hosts].filter((h) => PRODUCTION.test(h))).toEqual([])
})

test('an alert written while the app is still starting pops (not swallowed into the first snapshot)', async ({ browser }) => {
  await stage()
  const context = await browser.newContext()
  const page = await context.newPage()
  const hosts = watchHosts(page)
  await page.goto('/')
  await page.getByRole('textbox', { name: /email|อีเมล/i }).fill(PEOPLE.manager.email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  // Created "after the app opened" (createdAt ahead of the listener), but already in the
  // database by the time the first snapshot arrives — the race the fix closes.
  const at = Date.now() + 15_000
  await putDoc('notifications/lowStock__flour__startup', {
    kind: 'lowStock', category: 'inventory', priority: 'high', to: { all: true }, audienceKeys: ['all'],
    params: { product: 'FLOUR', location: 'Main Warehouse', qty: 1, unit: 'KG', min: 5 },
    link: '/products/flour/card', productId: 'flour', locationId: 'wh', active: true, readBy: {},
    source: 'worker', createdBy: 'worker', createdAt: at, updatedAt: at, expiresAt: at + 7 * DAY,
  }, { stampId: false })
  await page.getByRole('button', { name: 'Pizza Mania' }).click()
  await expect(page.locator('main')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'FLOUR' }).first()).toBeVisible({ timeout: 20_000 })
  expect([...hosts].filter((h) => PRODUCTION.test(h))).toEqual([])
})
