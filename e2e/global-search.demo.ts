import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const DAY = 86_400_000
const AUG5 = Date.parse('2026-08-05T03:00:00Z')

/** Synthetic records only. The August receipt is far outside the seven-day ledger window. */
async function stage(page: Page, brand = 'pizza') {
  await page.addInitScript(({ brand, AUG5, DAY }) => {
    if (localStorage.getItem('search-fixture')) return
    localStorage.setItem('search-fixture', '1')
    const now = Date.now()
    const user = { id: 'u', email: 'demo@inventory-pzm.local', name: 'Search QA', role: 'staff', active: true, createdAt: now }
    const put = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    put('users', { u: user })
    localStorage.setItem('pmstock:v1:session', 'u')
    localStorage.setItem('pmstock:v1:lastBrand', brand)
    const mv = (id: string, docNo: string, invoiceNo: string, supplierName: string, date: number, productName = 'FLOUR') =>
      ({ id, docNo, type: 'receive', productId: 'flour', productName, unit: 'KG', qty: 5, toLocationId: 'wh', date, createdAt: date,
        byUserId: 'u', byUserName: 'Search QA', invoiceNo, supplierName, supplierId: 'sup' })
    for (const [prefix, rows] of [
      ['', { a: mv('a', 'RC-00041', 'INV2026080528', 'SIAMFOOD', AUG5), r: mv('r', 'RC-00050', 'INV2026101401', 'SIAMFOOD', now - DAY) }],
      ['lelapin__', { l: mv('l', 'RC-00099', 'INV2026080528', 'LAPIN SUPPLY', AUG5, 'BAGUETTE') }],
      ['rnd__', {}],
    ] as const) {
      put(`${prefix}locations`, { wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
      put(`${prefix}products`, { flour: { id: 'flour', sku: 'F-001', name: prefix ? 'BAGUETTE' : 'FLOUR', unit: 'KG', unitType: 'KG', minStock: 0, active: true, createdAt: now } })
      put(`${prefix}stockMovements`, rows)
    }
    put('purchaseOrders', { 'po-old': { id: 'po-old', docNo: 'PO-00003', supplierId: 'sup', supplierName: 'SIAMFOOD', status: 'received', locationId: 'wh',
      orderedAt: AUG5 - 2 * DAY, receivedAt: AUG5, invoiceNo: 'IV-900', movementDocNo: 'RC-00007',
      lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 5, receivedQty: 5 }],
      createdBy: 'u', createdByName: 'Search QA', createdAt: AUG5 - 2 * DAY, updatedAt: AUG5 } })
  }, { brand, AUG5, DAY })
  await page.goto('/')
  await expect(page.locator('main')).toBeVisible()
}

const box = (page: Page) => page.getByRole('combobox', { name: /ค้นหาสินค้า หน้า เอกสาร ผู้ขาย|Search products/ }).filter({ visible: true })
const option = (page: Page, label: string) => page.getByRole('option').filter({ hasText: label })

test('owner report: INV2026080528 from August is found and opens its receipt', async ({ page }) => {
  await stage(page)
  await box(page).fill('INV2026080528')
  await expect(option(page, 'RC-00041')).toBeVisible()
  await expect(option(page, 'RC-00041')).toContainText('SIAMFOOD · INV2026080528')
  await mkdir('docs/evidence/global-search/after', { recursive: true })
  await page.screenshot({ path: 'docs/evidence/global-search/after/inv2026080528-found.png' })
  await box(page).press('Enter')
  await expect(page).toHaveURL(/\/movements\?doc=RC-00041/)
  await expect(page.getByText('แสดงเฉพาะเอกสาร RC-00041')).toBeVisible()
  await expect(page.locator('main').getByText('RC-00041', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.locator('main').getByText('FLOUR').filter({ visible: true }).first()).toBeVisible()
})

test('direct reload of an old receipt link reads that document, not an empty window', async ({ page }) => {
  await stage(page)
  await page.goto('/movements?doc=RC-00041')
  await expect(page.locator('main').getByText('RC-00041', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.locator('main').getByText('RC-00050', { exact: true })).toHaveCount(0)
})

test('a bill recorded only on an August purchase order opens that order', async ({ page }) => {
  await stage(page)
  await box(page).fill('iv-900')
  await expect(option(page, 'PO-00003')).toContainText('SIAMFOOD · IV-900 · RC-00007')
  await option(page, 'PO-00003').click()
  await expect(page.getByRole('dialog', { name: 'ใบสั่งซื้อ PO-00003', exact: true })).toBeVisible()
})

test('a number that is nowhere says what was searched and names the unindexed gap', async ({ page }) => {
  await stage(page)
  await box(page).fill('INV-404404')
  await expect(page.getByText('ไม่พบเลขนี้ในใบรับ ใบเบิก ใบปรับ ใบสั่งซื้อ หรือเลขบิลที่บันทึกไว้')).toBeVisible()
  await expect(page.getByText(/ก่อน 24\/09\/2569 ยังค้นจากที่นี่ไม่ได้/)).toBeVisible()
  await expect(page.getByRole('option')).toHaveCount(0)
  await page.screenshot({ path: 'docs/evidence/global-search/after/missing-number.png' })
})

test('loaded-window results stay instant and are not duplicated by the database answer', async ({ page }) => {
  await stage(page)
  await box(page).fill('INV2026101401')
  await expect(option(page, 'RC-00050')).toBeVisible()
  await expect(page.getByText(/ค้นเลขเอกสารและเลขบิลในฐานข้อมูลทั้งหมดแล้ว/)).toBeVisible()
  await expect(option(page, 'RC-00050')).toHaveCount(1)
})

test('keyboard: arrows choose among results and Enter opens the chosen one', async ({ page }) => {
  await stage(page)
  await box(page).fill('rc 41')
  await expect(option(page, 'RC-00041')).toBeVisible()
  await box(page).press('ArrowDown')
  await box(page).press('ArrowUp')
  await expect(option(page, 'RC-00041')).toHaveAttribute('aria-selected', 'true')
  await box(page).press('Enter')
  await expect(page).toHaveURL(/doc=RC-00041/)
})

test('other brands never appear, and the same number resolves within the chosen brand', async ({ page }) => {
  await stage(page)
  await box(page).fill('INV2026080528')
  await expect(option(page, 'RC-00041')).toBeVisible()
  await expect(option(page, 'RC-00099')).toHaveCount(0)
  await box(page).fill('rc-99')
  await expect(page.getByText('ไม่พบเลขนี้ในใบรับ ใบเบิก ใบปรับ ใบสั่งซื้อ หรือเลขบิลที่บันทึกไว้')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^แบรนด์: / }).filter({ visible: true }).click()
  await page.getByRole('menuitemradio', { name: /Le Lapin/ }).click()
  await box(page).fill('INV2026080528')
  await expect(option(page, 'RC-00099')).toContainText('LAPIN SUPPLY')
  await expect(option(page, 'RC-00041')).toHaveCount(0)
})

test('a lookup still in flight when the brand changes is dropped', async ({ page }) => {
  await stage(page)
  await box(page).fill('INV2026080528')
  await page.getByRole('button', { name: /^แบรนด์: / }).filter({ visible: true }).click()
  await page.getByRole('menuitemradio', { name: /Le Lapin/ }).click()
  await page.waitForTimeout(800)
  await expect(page.getByRole('option')).toHaveCount(0)
  await box(page).fill('INV2026080528')
  await expect(option(page, 'RC-00099')).toBeVisible()
  await expect(option(page, 'RC-00041')).toHaveCount(0)
})

test('search still works after the history page date filter is changed', async ({ page }) => {
  await stage(page)
  await page.goto('/movements')
  await page.locator('main input[type="date"]').first().fill('2026-10-01')
  await box(page).fill('INV2026080528')
  await expect(option(page, 'RC-00041')).toBeVisible()
})

test('English labels for the new search states', async ({ page }) => {
  await stage(page)
  await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาอังกฤษ' }).filter({ visible: true }).click()
  await box(page).fill('INV-404404')
  await expect(page.getByText('No receipt, issue, adjustment, purchase order or recorded bill has this number')).toBeVisible()
})
