import { test, expect, type Page, type TestInfo } from '@playwright/test'

/**
 * R19 D (BARCODE): the R18 scan-safety drop, re-verified around the surfaces it changed —
 * the Adjust page, the transfer receive page, and a wedge burst that carries its terminator
 * into the open confirmation dialog.
 *
 * Portable and committed: artifacts go through Playwright's own `outputPath`, no private path.
 * Software simulation only — no physical scanner, no emulator.
 *
 * Catalog: TOMATO SAUCE 8851111222222 · MOZZARELLA CHEESE 8853333444444 ·
 * COLLIDING 1/2 8859999000000 · INACTIVE PROD 8858888000000 (active: false).
 */
async function stage(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear()
    const now = Date.now()
    const user = { id: 'u1', email: 'scanner-qa@inventory-pzm.local', name: 'Scanner QA', role: 'admin', active: true, createdAt: now }
    const store = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    store('users', { u1: user })
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
    store('locations', {
      wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now },
      main: { id: 'main', name: 'Main Branch', active: true, type: 'branch', createdAt: now },
    })
    store('products', {
      'p-code1': { id: 'p-code1', sku: 'P-001', name: 'TOMATO SAUCE', barcode: '8851111222222', unit: 'Can', unitType: 'CAN', minStock: 0, active: true, createdAt: now },
      'p-code2': { id: 'p-code2', sku: 'P-002', name: 'MOZZARELLA CHEESE', barcode: '8853333444444', unit: 'KG', unitType: 'KG', minStock: 0, active: true, createdAt: now },
      'p-dup1': { id: 'p-dup1', sku: 'P-DUP1', name: 'COLLIDING PROD 1', barcode: '8859999000000', unit: 'Pack', unitType: 'PACK', minStock: 0, active: true, createdAt: now },
      'p-dup2': { id: 'p-dup2', sku: 'P-DUP2', name: 'COLLIDING PROD 2', barcode: '8859999000000', unit: 'Pack', unitType: 'PACK', minStock: 0, active: true, createdAt: now },
      'p-inact': { id: 'p-inact', sku: 'P-INACT', name: 'INACTIVE PROD', barcode: '8858888000000', unit: 'Pack', unitType: 'PACK', minStock: 0, active: false, createdAt: now },
    })
    // One transfer waiting at the branch, so the receive page has a line to scan against.
    store('transfers', {
      't1': {
        id: 't1', docNo: 'TR2610001', status: 'receiving', revision: 1,
        fromLocationId: 'wh', toLocationId: 'main', dispatchDate: now,
        requestedBy: 'u1', requestedByName: 'Scanner QA', createdAt: now, updatedAt: now,
        items: [
          { idx: 0, productId: 'p-code1', productName: 'TOMATO SAUCE', sku: 'P-001', unit: 'CAN', requestedQty: 5, dispatchQty: 5 },
          { idx: 1, productId: 'p-code2', productName: 'MOZZARELLA CHEESE', sku: 'P-002', unit: 'KG', requestedQty: 2, dispatchQty: 2 },
        ],
        history: [],
      },
    })
  })
}

const adjustInput = (page: Page) => page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า)')
const receiptInput = (page: Page) => page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)')
const dialog = (page: Page) => page.getByRole('dialog')
const addLine = (page: Page) => page.getByRole('button', { name: 'เพิ่มรายการ' })
const shot = (page: Page, testInfo: TestInfo, name: string) => page.screenshot({ path: testInfo.outputPath(name) })

async function typeCode(page: Page, code: string, terminator: 'Enter' | 'Tab' = 'Enter') {
  await page.keyboard.type(code, { delay: 5 })
  await page.keyboard.press(terminator)
}

async function openAdjust(page: Page) {
  await page.goto('/adjust')
  await expect(page.locator('main')).toBeVisible()
  await expect(adjustInput(page)).toBeVisible()
}

async function openReceipt(page: Page) {
  await page.goto('/receive')
  await expect(page.locator('main')).toBeVisible()
  // /receive opens on "from a purchase order", which has no scan box; the barcode surface is
  // the manual receipt.
  await page.getByRole('radio', { name: /รับนอกใบสั่งซื้อ/ }).click()
  await expect(receiptInput(page)).toBeVisible()
}

async function openTransfer(page: Page) {
  await page.goto('/transfers/t1/receive')
  await expect(page.getByPlaceholder('ยิงบาร์โค้ด แล้วกด Enter')).toBeVisible()
}

// ---- Adjust: the page 9da0c0c touched --------------------------------------------------

test('Adjust 1: a refused code never stays in the box, so the next scan is its own', async ({ page }, testInfo) => {
  await stage(page)
  await openAdjust(page)
  const input = adjustInput(page)
  await input.focus()

  await typeCode(page, '9999999999999')
  await expect(page.getByText('ไม่พบบาร์โค้ด 9999999999999 ในระบบ')).toBeVisible()
  await expect(input).toHaveValue('')
  await shot(page, testInfo, 'adjust1-unknown-scanned.png')

  await typeCode(page, '8851111222222')
  await expect(dialog(page)).toContainText('TOMATO SAUCE')
  await expect(dialog(page)).toContainText('8851111222222')
  await shot(page, testInfo, 'adjust1-after-second-scan.png')
  await addLine(page).click()
  await expect(page.locator('input[type="number"]')).toHaveCount(2)
})

test('Adjust 2: Tab ends a scan exactly like Enter', async ({ page }, testInfo) => {
  await stage(page)
  await openAdjust(page)
  const input = adjustInput(page)
  await input.focus()

  await typeCode(page, '8853333444444', 'Tab')
  await expect(dialog(page)).toContainText('MOZZARELLA CHEESE')
  await expect(dialog(page)).toContainText('8853333444444')
  await expect(input).toHaveValue('')
  await shot(page, testInfo, 'adjust2-tab.png')
  await addLine(page).click()
  await expect(page.locator('input[type="number"]')).toHaveCount(2)
})

test('Adjust 3: Tab on half-typed search text is a refused code, never a fuzzy pick', async ({ page }) => {
  await stage(page)
  await openAdjust(page)
  const input = adjustInput(page)
  await input.focus()

  // "TOMATO" is a name, not a code: the lookup is exact-barcode or nothing (no name fallback).
  await page.keyboard.type('TOMATO', { delay: 5 })
  await page.keyboard.press('Tab')
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.getByText('ไม่พบบาร์โค้ด TOMATO ในระบบ')).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(page.locator('input[type="number"]')).toHaveCount(0)
})

test('Adjust 4: inactive and colliding codes are refused and add no row', async ({ page }, testInfo) => {
  await stage(page)
  await openAdjust(page)
  const input = adjustInput(page)
  await input.focus()

  await typeCode(page, '8858888000000')
  await expect(page.getByText('สินค้าบาร์โค้ดนี้ถูกปิดใช้งานแล้ว: "INACTIVE PROD"')).toBeVisible()
  await expect(input).toHaveValue('')

  await typeCode(page, '8859999000000')
  await expect(page.getByText('บาร์โค้ด 8859999000000 ซ้ำกับสินค้า 2 รายการ — โปรดเลือกสินค้าด้วยตนเอง')).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(page.locator('input[type="number"]')).toHaveCount(0)
  await expect(dialog(page)).not.toBeVisible()
  await shot(page, testInfo, 'adjust4-refusals.png')
})

test('Adjust 5: a scan adds its row once and posts no adjustment by itself', async ({ page }, testInfo) => {
  await stage(page)
  await openAdjust(page)
  const input = adjustInput(page)
  await input.focus()

  await typeCode(page, '8851111222222')
  await expect(dialog(page)).toContainText('TOMATO SAUCE')
  await addLine(page).click()
  await expect(page.locator('input[type="number"]')).toHaveCount(2)
  await expect(page.locator('main')).toContainText('TOMATO SAUCE')

  // Scanned again: still one row, not two (appendLineOnce).
  await input.focus()
  await typeCode(page, '8851111222222')
  await addLine(page).click()
  await expect(page.locator('input[type="number"]')).toHaveCount(2)

  // Nothing was filed: the page writes a movement only when the operator confirms the sheet.
  expect(await page.evaluate(() => localStorage.getItem('pmstock:v1:movements'))).toBeNull()
  await shot(page, testInfo, 'adjust5-adds-row-once.png')
})

// ---- The receipt scan box: a burst that carries its Enter into the dialog ---------------

test('Receipt 1: a scan burst with its terminator while the confirmation is open keeps it open', async ({ page }, testInfo) => {
  await stage(page)
  await openReceipt(page)
  const input = receiptInput(page)
  await input.focus()

  await typeCode(page, '8851111222222')
  await expect(dialog(page)).toContainText('TOMATO SAUCE')

  // A second scan at wedge speed, terminator included. No key may answer the open prompt.
  await typeCode(page, '8853333444444')
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('8851111222222')
  await expect(dialog(page)).not.toContainText('MOZZARELLA CHEESE')
  await expect(page.locator('input[type="number"]')).toHaveCount(0)
  await shot(page, testInfo, 'receipt1-burst-behind-dialog.png')

  // The pending answer still works, and adds exactly the first product.
  await addLine(page).click()
  await expect(page.locator('input[type="number"]')).toHaveCount(1)
  await expect(page.locator('main')).toContainText('TOMATO SAUCE')
  await expect(page.locator('main')).not.toContainText('MOZZARELLA CHEESE')
})

test('Receipt 2: Tab on half-typed text is a refused code, never a name pick', async ({ page }) => {
  await stage(page)
  await openReceipt(page)
  const input = receiptInput(page)
  await input.focus()

  await page.keyboard.type('TOMATO', { delay: 5 })
  await page.keyboard.press('Tab')
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.getByText('ไม่พบบาร์โค้ด TOMATO ในระบบ')).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(page.locator('input[type="number"]')).toHaveCount(0)
})

test('Receipt 3: Tab, Shift+Tab and Escape still belong to the confirmation', async ({ page }) => {
  await stage(page)
  await openReceipt(page)
  const input = receiptInput(page)
  await input.focus()

  await typeCode(page, '8851111222222')
  const box = dialog(page)
  await expect(box).toContainText('TOMATO SAUCE')

  // The dialog owns the keyboard: four Tabs and three Shift+Tabs must never leave it.
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key)
    expect(await box.evaluate((el) => el.contains(document.activeElement)), key).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(box).not.toBeVisible()
  await expect(page.locator('input[type="number"]')).toHaveCount(0)
})

// ---- Transfer receive: the third caller 9da0c0c touched ---------------------------------
test('Transfer 1: Enter on a document code marks that line; an unknown code is refused', async ({ page }, testInfo) => {
  await stage(page)
  await openTransfer(page)
  const input = page.getByPlaceholder('ยิงบาร์โค้ด แล้วกด Enter')
  await input.focus()

  await typeCode(page, '9999999999999')
  await expect(page.getByText('ไม่พบบาร์โค้ด 9999999999999 ในระบบ')).toBeVisible()

  await typeCode(page, '8853333444444')
  await expect(dialog(page)).toContainText('MOZZARELLA CHEESE')
  await page.getByRole('button', { name: 'ตรวจรับรายการนี้' }).click()
  await expect(page.locator('main')).toContainText('MOZZARELLA CHEESE')
  await shot(page, testInfo, 'transfer1-received-line.png')
})
