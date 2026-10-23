import { test, expect, type Page, type TestInfo } from '@playwright/test'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

async function excelRows(page: Page, info: TestInfo) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Excel', exact: true }).click()
  const file = await pending
  const path = info.outputPath('stock.xlsx')
  await file.saveAs(path)
  const book = XLSX.read(readFileSync(path), { type: 'buffer' })
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]])
}

/**
 * Owner definition (docs/design/stock-buckets.md): branch = qtyAt(site, product); in transit =
 * every location of type transit; company total = every site (open or closed) + transit, once,
 * for every product still on the catalogue. Hiding a product or closing a site never disposes of
 * what is on the shelf.
 *
 * Fixture (all synthetic, browser storage only):
 *   Flour   cost 37.25  wh 10, br 5, closed 4, transit 3, transit-b 2  -> company 24, in transit 5
 *   Khaki   cost  5.01  hidden (active: false), wh 6                  -> company 6
 *   Salt    cost  5.00  transit -2                                    -> company -2 (integrity anomaly)
 *   company value = 24x37.25 + 6x5.01 + (-2)x5 = 894 + 30.06 - 10 = 914.06
 */
const COMPANY_VALUE = /฿\s*914\.06/
const FLOUR_VALUE = /฿\s*894\.00/
const TRANSIT = 'transit'

async function stage(page: Page) {
  await page.addInitScript(
    ({ transit }) => {
      if (localStorage.getItem('stock-transit-fixture')) return
      localStorage.setItem('stock-transit-fixture', '1')
      const now = Date.now()
      // Today in Bangkok, never yesterday: the as-of test rewinds exactly this row (R40 review).
      const today = Math.max(now - 60_000, Math.floor((now + 7 * 3_600_000) / 86_400_000) * 86_400_000 - 7 * 3_600_000 + 1)
      const store = (name: string, rows: Record<string, unknown>) =>
        localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
      const user = { id: 'transit-user', email: 'demo@inventory-pzm.local', name: 'Transit QA', role: 'admin', active: true, createdAt: now }
      store('users', { 'transit-user': user })
      localStorage.setItem('pmstock:v1:session', user.id)
      localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
      store('locations', {
        wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now },
        br: { id: 'br', name: 'Branch One', active: true, type: 'branch', createdAt: now + 1 },
        closed: { id: 'closed', name: 'Closed Branch', active: false, type: 'branch', createdAt: now + 2 },
        [transit]: { id: transit, name: 'In transit', active: true, type: 'transit', createdAt: now + 3 },
        'transit-b': { id: 'transit-b', name: 'In transit (imported)', active: true, type: 'transit', createdAt: now + 4 },
      })
      const base = { category: 'Dry', minStock: 0, hasImage: false, createdAt: now, updatedAt: now }
      store('products', {
        p1: { ...base, id: 'p1', sku: 'QA-001', name: 'QA Flour', unit: 'Kilogram', unitType: 'KG', active: true, cost: 37.25 },
        p2: { ...base, id: 'p2', sku: 'QA-002', name: 'QA Salt', category: 'Negative', unit: 'Kilogram', unitType: 'KG', active: true, cost: 5 },
        hidden: { ...base, id: 'hidden', sku: 'QA-003', name: 'QA Khaki (hidden)', unit: 'Kilogram', unitType: 'KG', active: false, cost: 5.01 },
      })
      const levels: Record<string, unknown> = {}
      for (const [locationId, productId, qty] of [
        ['wh', 'p1', 10], ['br', 'p1', 5], ['closed', 'p1', 4], [transit, 'p1', 3], ['transit-b', 'p1', 2],
        ['wh', 'hidden', 6], [transit, 'p2', -2],
      ] as const) levels[`${locationId}__${productId}`] = { id: `${locationId}__${productId}`, locationId, productId, qty, updatedAt: now, updatedBy: user.id }
      store('stockLevels', levels)
      store('stockMovements', {
        imported: { id: 'imported', docNo: 'IS-QA-001', type: 'issue', productId: 'p1', productName: 'QA Flour', unit: 'KG', qty: 2, fromLocationId: 'transit-b', toLocationId: 'br', date: today, createdAt: today, byUserId: user.id, byUserName: user.name },
      })
      localStorage.setItem('pmstock:lang', 'en')
      localStorage.setItem('pzm:products:view', 'table')
    },
    { transit: TRANSIT },
  )
}

test('dashboard: the value tile is what the company owns, hidden products and closed sites included', async ({ page }) => {
  await stage(page)
  await page.goto('/')
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('main')).toContainText(COMPANY_VALUE)
})

test('products: the company value tile counts closed sites, transit and hidden products once', async ({ page }) => {
  await stage(page)
  await page.goto('/products')
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('main')).toContainText(COMPANY_VALUE)
})

test('stock card: headline is the company total, in transit is its own line, the value matches', async ({ page }) => {
  await stage(page)
  await page.goto('/products/p1/card')
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('main')).toContainText(/\b24\b/)
  await expect(page.locator('main')).toContainText(FLOUR_VALUE)
  // 3 at the canonical transit location + 2 at the second transit-type location, shown once.
  await expect(page.locator('main')).toContainText(/\b5\b/)
})

test('stock card: a negative transit balance stays on screen, signed', async ({ page }) => {
  await stage(page)
  await page.goto('/products/p2/card')
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('main')).toContainText(/-2|-2\.00/)
})

test('reports overview: the all-sites value is the same company figure', async ({ page }) => {
  await stage(page)
  await page.goto('/reports')
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('main')).toContainText(COMPANY_VALUE)
})

test('phone: hidden stock, negative transit and cents survive the category summary', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stage(page)
  await page.goto('/')
  const label = page.getByText('Stock value by category', { exact: true })
  await expect(label).toBeVisible()
  const card = label.locator('..').locator('..')
  await expect(card).toContainText(COMPANY_VALUE)
  const negative = card.locator('li').filter({ hasText: 'Negative' })
  await expect(negative).toContainText(/฿\s*-10\.00/)
  expect(await negative.locator('.bg-brand').evaluate(el => el.getBoundingClientRect().width)).toBe(0)
})

test('snapshot: an imported transit location is rewound separately, not using the canonical delta', async ({ page }, info) => {
  await stage(page)
  await page.goto('/reports')
  await page.getByRole('button', { name: 'Stock on hand', exact: true }).click()
  const yesterday = await page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await page.getByLabel(/^As at end of day/).fill(yesterday)
  const row = page.locator('tbody tr').filter({ hasText: 'QA Flour' }).filter({ hasText: 'In transit' })
  // Today: 3 canonical + 2 imported. Yesterday: 3 canonical + 4 imported = 7, not 5.
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('cell', { name: '7 KG', exact: true })).toBeVisible()
  await expect(row.getByRole('cell', { name: '260.75', exact: true })).toBeVisible()
  const exported = (await excelRows(page, info)).find(r => r.Product === 'QA Flour' && r.Location === 'In transit')
  expect(exported).toMatchObject({ 'On hand': 7, Value: 260.75 })
})

test('transit-only stock is owned but cannot make an empty branch available', async ({ page }) => {
  await stage(page)
  await page.addInitScript(() => {
    const products = JSON.parse(localStorage.getItem('pmstock:v1:products')!)
    products.p2.minStock = 1
    localStorage.setItem('pmstock:v1:products', JSON.stringify(products))
    const levels = JSON.parse(localStorage.getItem('pmstock:v1:stockLevels')!)
    levels.transit__p2.qty = 5
    levels.wh__p2 = { ...levels.transit__p2, id: 'wh__p2', locationId: 'wh', qty: 0 }
    localStorage.setItem('pmstock:v1:stockLevels', JSON.stringify(levels))
  })
  await page.goto('/products/p2/card')
  await expect(page.locator('main')).toContainText('Incl. 5 KG in transit')
  await expect(page.getByText('Out of stock', { exact: true })).toBeVisible()
})

test('top bar: product search separates company stock from transit', async ({ page }) => {
  await stage(page)
  await page.goto('/products')
  await page.getByRole('combobox', { name: 'Search products, pages, documents, suppliers…' }).fill('QA Flour')
  const option = page.getByRole('option').filter({ hasText: 'QA Flour' })
  await expect(option).toContainText(/24\s*KG/)
  await expect(option).toContainText('Incl. 5 KG in transit')
})

test('costs: hidden stock remains owned, and no-history Excel rows retain stock buckets', async ({ page }, info) => {
  await stage(page)
  await page.goto('/reports')
  await page.getByRole('button', { name: 'Costs', exact: true }).click()
  const flour = page.locator('tbody tr[data-row-key="p1"]')
  await expect(flour).toContainText(FLOUR_VALUE)
  await expect(flour).toContainText('Incl. 5 KG in transit')
  await expect.soft(page.locator('tbody tr[data-row-key="hidden"]')).toBeVisible()
  const rows = await excelRows(page, info)
  expect.soft(rows.find(r => r.SKU === 'QA-001')).toMatchObject({ 'On hand': '24', 'In transit': '5' })
  expect.soft(rows.find(r => r.SKU === 'QA-003')).toMatchObject({ 'On hand': '6', 'In transit': '0' })
})

test('reports overview: the branch table says what the company figure adds, so the two reconcile', async ({ page }) => {
  await stage(page)
  await page.goto('/reports')
  // Tile 914.06 vs open-branch rows 558.75: the gap is transit, the closed branch and the hidden product.
  await expect(page.locator('main')).toContainText('Open branches only. The company value above also counts goods in transit, closed branches and hidden products.')
})

test('snapshot: with only an imported transit location, the transit line still names its location', async ({ page }) => {
  await stage(page)
  await page.addInitScript(() => {
    const locations = JSON.parse(localStorage.getItem('pmstock:v1:locations')!)
    delete locations.transit
    localStorage.setItem('pmstock:v1:locations', JSON.stringify(locations))
    const levels = JSON.parse(localStorage.getItem('pmstock:v1:stockLevels')!)
    delete levels.transit__p1
    delete levels.transit__p2
    localStorage.setItem('pmstock:v1:stockLevels', JSON.stringify(levels))
  })
  await page.goto('/reports')
  await page.getByRole('button', { name: 'Stock on hand', exact: true }).click()
  const row = page.locator('tbody tr').filter({ hasText: 'QA Flour' }).filter({ hasText: 'In transit' })
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('cell', { name: '2 KG', exact: true })).toBeVisible()
})

test('costs: a product with no cost history still shows what is in transit', async ({ page }) => {
  await stage(page)
  await page.addInitScript(() => {
    const products = JSON.parse(localStorage.getItem('pmstock:v1:products')!)
    products.nocost = { ...products.p1, id: 'nocost', sku: 'QA-004', name: 'QA Yeast (no cost)', cost: undefined }
    localStorage.setItem('pmstock:v1:products', JSON.stringify(products))
    const levels = JSON.parse(localStorage.getItem('pmstock:v1:stockLevels')!)
    levels['transit-b__nocost'] = { ...levels['transit-b__p1'], id: 'transit-b__nocost', productId: 'nocost', qty: 4 }
    localStorage.setItem('pmstock:v1:stockLevels', JSON.stringify(levels))
  })
  await page.goto('/reports')
  await page.getByRole('button', { name: 'Costs', exact: true }).click()
  await expect(page.locator('tbody tr[data-row-key="nocost"]')).toContainText('Incl. 4 KG in transit')
})
