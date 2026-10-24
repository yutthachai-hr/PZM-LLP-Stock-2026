import { expect, test } from '@playwright/test'
import { putDoc } from './emulator'
import { PEOPLE, seedStage } from './fixture'
import { signedIn } from './app'

const DAY = 86_400_000

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

test('receive prices: 3 lines (supplier price, cost-only, no price) and 2 quantities entered', async ({
  browser,
}) => {
  const stage = await seedStage()
  const now = Date.now()

  // 1. Line 1: flour -> has active supplier item with buyingPrice 120
  await putDoc('supplierItems/si_flour', {
    supplierId: 'sup1',
    productId: 'flour',
    buyingPrice: 120,
    active: true,
    createdAt: now,
    updatedAt: now,
  })

  // 2. Line 2: cheese -> has product cost 50, but no supplier item
  await putDoc('products/cheese', {
    sku: 'DAI-01-001',
    name: 'MOZZARELLA',
    category: 'Dry',
    unit: 'Kilogram',
    unitType: 'KG',
    cost: 50,
    minStock: 0,
    hasImage: false,
    active: true,
    createdAt: now,
    updatedAt: now,
  })

  // 3. Line 3: sauce -> no cost, no supplier item
  await putDoc('products/sauce', {
    sku: 'SAU-01-001',
    name: 'PIZZA SAUCE',
    category: 'Dry',
    unit: 'Kilogram',
    unitType: 'KG',
    minStock: 0,
    hasImage: false,
    active: true,
    createdAt: now,
    updatedAt: now,
  })

  // Purchase order with 3 lines
  await putDoc('purchaseOrders/po-price-test', {
    docNo: 'PO-PRICE-001',
    supplierId: 'sup1',
    supplierName: 'E2E SUPPLIER',
    status: 'ordered',
    locationId: 'wh',
    orderedAt: now - DAY,
    expectedAt: now,
    lines: [
      { productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10 },
      { productId: 'cheese', productName: 'MOZZARELLA', unit: 'KG', orderedQty: 5 },
      { productId: 'sauce', productName: 'PIZZA SAUCE', unit: 'KG', orderedQty: 4 },
    ],
    createdBy: stage.uid.manager,
    createdByName: PEOPLE.manager.name,
    createdAt: now - DAY,
    updatedAt: now - DAY,
  })

  const page = await signedIn(browser, 'staffA', '/receive?po=po-price-test')

  // Set desktop viewport first to inspect table
  await page.setViewportSize({ width: 1440, height: 900 })

  // Wait for order lines to render
  const flourInput = page.getByLabel(/รับครั้งนี้: FLOUR/)
  const sauceInput = page.getByLabel(/รับครั้งนี้: PIZZA SAUCE/)
  const cheeseInput = page.getByLabel(/รับครั้งนี้: MOZZARELLA/)
  await expect(flourInput).toBeVisible()
  await expect(cheeseInput).toBeVisible()
  await expect(sauceInput).toBeVisible()

  // Initially on desktop (1440px):
  // 1. FLOUR line shows unit price ฿120.00 / KG and (ราคาผู้ขาย), no line amount yet
  const flourRow = page.locator('li', { hasText: 'FLOUR' })
  await expect(flourRow.getByText('฿120.00 / KG').filter({ visible: true })).toBeVisible()
  await expect(flourRow.getByText('ราคาผู้ขาย').filter({ visible: true })).toBeVisible()
  await expect(flourRow.getByText('฿240.00')).toHaveCount(0)

  // 2. CHEESE line shows unit price ฿50.00 / KG and (ต้นทุนล่าสุด), no line amount yet
  const cheeseRow = page.locator('li', { hasText: 'MOZZARELLA' })
  await expect(cheeseRow.getByText('฿50.00 / KG').filter({ visible: true })).toBeVisible()
  await expect(cheeseRow.getByText('ต้นทุนล่าสุด').filter({ visible: true })).toBeVisible()

  // 3. SAUCE line shows ยังไม่ระบุราคา, never 0, and no line amount
  const sauceRow = page.locator('li', { hasText: 'PIZZA SAUCE' })
  await expect(sauceRow.getByText('ยังไม่ระบุราคา').filter({ visible: true })).toBeVisible()
  await expect(sauceRow.getByText('฿0.00')).toHaveCount(0)

  const panel = page.locator('aside', { hasText: 'ใบรับนี้' })
  const estimate = panel.getByText('มูลค่าประมาณการ', { exact: true }).locator('..')
  await expect(estimate.getByText('—', { exact: true })).toBeVisible()
  await expect(estimate.getByText('฿0.00')).toHaveCount(0)

  // An entered but unpriced receipt is unknown, never free goods.
  await sauceInput.fill('3')
  await expect(estimate.getByText('—', { exact: true })).toBeVisible()
  await expect(estimate.getByText('฿0.00')).toHaveCount(0)
  await expect(panel.getByText('ยังไม่ระบุราคา 1 รายการ')).toBeVisible()

  // Add the priced line: 2 * 120 = 240, excluding the unpriced line.
  await flourInput.fill('2')

  // CHEESE is left unentered

  // Per-line amounts verification:
  // FLOUR should show line amount ฿240.00
  await expect(flourRow.getByText('฿240.00').filter({ visible: true })).toBeVisible()

  // CHEESE (unentered) shows no line amount
  await expect(cheeseRow.getByText('฿150.00')).toHaveCount(0)
  await expect(cheeseRow.getByText('฿0.00')).toHaveCount(0)

  // SAUCE (unpriced) shows no line amount and still shows ยังไม่ระบุราคา
  await expect(sauceRow.getByText('ยังไม่ระบุราคา').filter({ visible: true })).toBeVisible()

  // "ใบรับนี้" card verification:
  // Estimated total should be ฿240.00
  // Missing price count should be "ยังไม่ระบุราคา 1 รายการ"
  await expect(panel.getByText('฿240.00')).toBeVisible()
  await expect(panel.getByText('ยังไม่ระบุราคา 1 รายการ')).toBeVisible()

  // Save desktop screenshot at 1440
  await page.screenshot({ path: 'docs/evidence/receive-price/receive-price-1440.png', fullPage: true })

  // Mobile viewport at 390
  await page.setViewportSize({ width: 390, height: 844 })
  // On mobile, expand the side summary panel
  const sideToggle = page.getByRole('button', { name: 'สรุปใบรับนี้' })
  await expect(sideToggle).toBeVisible()
  await sideToggle.click()

  // Verify "ใบรับนี้" is visible on mobile after toggle
  await expect(panel.getByText('฿240.00')).toBeVisible()
  await expect(panel.getByText('ยังไม่ระบุราคา 1 รายการ')).toBeVisible()

  // Save mobile screenshot at 390
  await page.screenshot({ path: 'docs/evidence/receive-price/receive-price-390.png', fullPage: true })
})
