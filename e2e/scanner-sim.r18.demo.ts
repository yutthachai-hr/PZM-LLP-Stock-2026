import { test, expect, type Page, type TestInfo } from '@playwright/test'

/**
 * R18 S4 follow-up: portable, committed copy of the wedge-scanner simulation probe.
 *
 * The original probe stays UNTRACKED in the worktree (it writes into a private Mission Control
 * evidence directory). This copy writes its artifacts through Playwright's own `outputPath`, so
 * it carries no private path and can run from a clean clone.
 *
 * Stage synthetic catalog into localStorage demo mode.
 * Product setup:
 * - p-code1: Barcode '8851111222222', SKU 'P-001', Name 'TOMATO SAUCE'
 * - p-code2: Barcode '8853333444444', SKU 'P-002', Name 'MOZZARELLA CHEESE'
 * - p-zero:  Barcode '0123456789012', SKU 'P-ZERO', Name 'ZERO LEADING PROD'
 * - p-dup1:  Barcode '8859999000000', SKU 'P-DUP1', Name 'COLLIDING PROD 1'
 * - p-dup2:  Barcode '8859999000000', SKU 'P-DUP2', Name 'COLLIDING PROD 2'
 * - p-inact: Barcode '8858888000000', SKU 'P-INACT', Name 'INACTIVE PROD', active: false
 * - p-raw:   only when asked for; Barcode 'คคถๅๅๅๅ//////' (the raw Thai keystrokes for
 *            8851111222222), Name 'RAW THAI CODE'
 * In Le Lapin brand:
 * - p-lapin: Barcode '8857777000000', SKU 'P-LAPIN', Name 'FRENCH BAGUETTE'
 */
async function stage(page: Page, brand = 'pizza', rawProduct = false) {
  await page.addInitScript(({ brand, rawProduct }) => {
    localStorage.clear()
    const now = Date.now()
    const user = { id: 'u1', email: 'scanner-qa@inventory-pzm.local', name: 'Scanner QA', role: 'admin', active: true, createdAt: now }
    const store = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    store('users', { u1: user })
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', brand)

    const pizzaProducts = {
      'p-code1': { id: 'p-code1', sku: 'P-001', name: 'TOMATO SAUCE', barcode: '8851111222222', unit: 'Can', unitType: 'CAN', minStock: 0, active: true, createdAt: now },
      'p-code2': { id: 'p-code2', sku: 'P-002', name: 'MOZZARELLA CHEESE', barcode: '8853333444444', unit: 'KG', unitType: 'KG', minStock: 0, active: true, createdAt: now },
      'p-zero':  { id: 'p-zero',  sku: 'P-ZERO', name: 'ZERO LEADING PROD', barcode: '0123456789012', unit: 'Box', unitType: 'BOX', minStock: 0, active: true, createdAt: now },
      'p-dup1':  { id: 'p-dup1',  sku: 'P-DUP1', name: 'COLLIDING PROD 1', barcode: '8859999000000', unit: 'Pack', unitType: 'PACK', minStock: 0, active: true, createdAt: now },
      'p-dup2':  { id: 'p-dup2',  sku: 'P-DUP2', name: 'COLLIDING PROD 2', barcode: '8859999000000', unit: 'Pack', unitType: 'PACK', minStock: 0, active: true, createdAt: now },
      'p-inact': { id: 'p-inact', sku: 'P-INACT', name: 'INACTIVE PROD', barcode: '8858888000000', unit: 'Pack', unitType: 'PACK', minStock: 0, active: false, createdAt: now },
      ...(rawProduct ? { 'p-raw': { id: 'p-raw', sku: 'P-RAW', name: 'RAW THAI CODE', barcode: 'คคถๅๅๅๅ//////', unit: 'Pack', unitType: 'PACK', minStock: 0, active: true, createdAt: now } } : {}),
    }

    const lelapinProducts = {
      'p-lapin': { id: 'p-lapin', sku: 'P-LAPIN', name: 'FRENCH BAGUETTE', barcode: '8857777000000', unit: 'Piece', unitType: 'PCS', minStock: 0, active: true, createdAt: now },
    }

    store('locations', { wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
    store('products', pizzaProducts)

    store('lelapin__locations', { wh: { id: 'wh', name: 'Sukhumvit Warehouse', active: true, type: 'warehouse', createdAt: now } })
    store('lelapin__products', lelapinProducts)

    store('rnd__locations', {})
    store('rnd__products', {})
  }, { brand, rawProduct })

  await page.goto('/receive')
  await expect(page.locator('main')).toBeVisible()
  // /receive opens on "from a purchase order", which has no scan box at all. The barcode
  // surface is the manual receipt.
  await page.getByRole('radio', { name: /รับนอกใบสั่งซื้อ/ }).click()
  await expect(searchInput(page)).toBeVisible()
}

const searchInput = (page: Page) =>
  page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)')

const dialog = (page: Page) => page.getByRole('dialog')
const addLine = (page: Page) => page.getByRole('button', { name: 'เพิ่มรายการ' })

async function typeCode(page: Page, code: string, terminator: 'Enter' | 'Tab' = 'Enter') {
  await page.keyboard.type(code, { delay: 5 })
  await page.keyboard.press(terminator)
}

/** Artifacts live under this test's own outputPath — never a private evidence directory. */
const shot = (page: Page, testInfo: TestInfo, name: string) =>
  page.screenshot({ path: testInfo.outputPath(name) })

// Case 1: code + Enter
test('Case 1: code + Enter resolves product and legacy prompt', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()
  await typeCode(page, '8851111222222')

  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('TOMATO SAUCE')
  await expect(dialog(page)).toContainText('8851111222222')
  await expect(input).toHaveValue('')
  await shot(page, testInfo, 'case1-code-enter.png')
  await addLine(page).click()
  await expect(page.locator('main')).toContainText('TOMATO SAUCE')
  await expect(page.locator('input[type="number"]')).toHaveCount(1)
  await expect(page.locator('input[type="number"]')).toHaveValue('1')
})

// Case 2: code + Tab — a wedge scanner's other common terminator
test('Case 2: code + Tab submits exactly like Enter and keeps the caret in the box', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()
  await typeCode(page, '8851111222222', 'Tab')

  await expect(dialog(page)).toContainText('TOMATO SAUCE')
  await expect(dialog(page)).toContainText('8851111222222')
  await expect(input).toHaveValue('')
  await shot(page, testInfo, 'case2-code-tab.png')
  await addLine(page).click()
  await expect(page.locator('input[type="number"]')).toHaveCount(1)
  // Straight back to the scan box, so the next scan lands in it.
  await expect(input).toBeFocused()
})

// Case 2b: an empty box keeps its keyboard behaviour — Tab is not captured
test('Case 2b: Tab on an empty scan box still moves focus on', async ({ page }) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()
  await expect(input).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(input).not.toBeFocused()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

// Case 3: unknown code then a valid code immediately — no stale text appended
test('Case 3: unknown code clears the box so the next scan resolves as itself', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()
  await typeCode(page, '9999999999999')

  await expect(page.getByText('ไม่พบบาร์โค้ด 9999999999999 ในระบบ')).toBeVisible()
  await expect(input).toHaveValue('')
  await shot(page, testInfo, 'case3-unknown-scanned.png')

  await typeCode(page, '8851111222222')
  await expect(dialog(page)).toContainText('TOMATO SAUCE')
  await expect(dialog(page)).toContainText('8851111222222')
  await shot(page, testInfo, 'case3-after-second-scan.png')
  await addLine(page).click()
  await expect(page.locator('input[type="number"]')).toHaveCount(1)
})

// Case 3b: unknown via Tab, then valid via Tab
test('Case 3b: unknown then valid code, both terminated by Tab', async ({ page }) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()
  await typeCode(page, '9999999999999', 'Tab')
  await expect(page.getByText('ไม่พบบาร์โค้ด 9999999999999 ในระบบ')).toBeVisible()
  await expect(input).toHaveValue('')

  await typeCode(page, '8853333444444', 'Tab')
  await expect(dialog(page)).toContainText('MOZZARELLA CHEESE')
  await expect(dialog(page)).toContainText('8853333444444')
})

// Case 4: 10 fast wedge scans while the previous confirmation is open
test('Case 4: ten fast scans behind an open confirmation add nothing, and the next scan is its own', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()
  await typeCode(page, '8851111222222')
  await expect(dialog(page)).toContainText('TOMATO SAUCE')

  // The modal owns the keyboard: 10 codes typed at wedge speed reach no field and no button
  // (no terminator is sent, so nothing can answer the dialog by accident).
  for (let i = 0; i < 10; i++) await page.keyboard.type('8853333444444', { delay: 5 })

  await expect(input).toHaveValue('')
  await expect(dialog(page)).toContainText('8851111222222')
  await expect(dialog(page)).not.toContainText('8853333444444')
  await shot(page, testInfo, 'case4-fast-behind-dialog.png')

  // Cancelling adds nothing at all.
  await page.keyboard.press('Escape')
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.locator('input[type="number"]')).toHaveCount(0)

  // The next scan lands in the box and adds exactly that product, once.
  await input.focus()
  await typeCode(page, '8853333444444')
  await expect(dialog(page)).toContainText('MOZZARELLA CHEESE')
  await addLine(page).click()
  await expect(page.locator('input[type="number"]')).toHaveCount(1)
  await expect(page.locator('main')).toContainText('MOZZARELLA CHEESE')
  await expect(page.locator('main')).not.toContainText('TOMATO SAUCE')
})

// Case 4b: ten scans in a row, answered one by one, add two lines exactly
test('Case 4b: ten fast scans of two products make two lines, quantity 1 each', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  const codes = ['8851111222222', '8853333444444']
  const names = ['TOMATO SAUCE', 'MOZZARELLA CHEESE']

  for (let i = 0; i < 10; i++) {
    await input.focus()
    await typeCode(page, codes[i % 2])
    await expect(dialog(page)).toContainText(names[i % 2])
    await addLine(page).click()
    await expect(page.locator('input[type="number"]')).toHaveCount(i < 2 ? i + 1 : 2)
  }

  const qty = page.locator('input[type="number"]')
  await expect(qty).toHaveCount(2)
  await expect(qty.nth(0)).toHaveValue('1')
  await expect(qty.nth(1)).toHaveValue('1')
  await shot(page, testInfo, 'case4b-ten-scans.png')
})

// Case 5: duplicate scan of the same product adds one line, not two
test('Case 5: duplicate scan does not add a twin line or bump the quantity', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()
  await typeCode(page, '8851111222222')
  await expect(dialog(page)).toContainText('TOMATO SAUCE')
  await addLine(page).click()
  await expect(page.locator('input[type="number"]')).toHaveCount(1)

  await typeCode(page, '8851111222222')
  await expect(dialog(page)).toContainText('TOMATO SAUCE')
  await addLine(page).click()

  await expect(page.locator('input[type="number"]')).toHaveCount(1)
  await expect(page.locator('input[type="number"]')).toHaveValue('1')
  await shot(page, testInfo, 'case5-duplicate-scan.png')
})

// Case 6: leading-zero code
test('Case 6: leading-zero code preserved exactly', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()
  await typeCode(page, '0123456789012')

  await expect(dialog(page)).toContainText('ZERO LEADING PROD')
  await expect(dialog(page)).toContainText('0123456789012')
  await shot(page, testInfo, 'case6-leading-zero.png')
})

// Case 6b: the same leading-zero code typed on a Thai (Kedmanee) layout.
// Measured Windows digit row: 0=จ 1=ๅ 2=/ 3=- 4=ภ 5=ถ 6=ุ 7=ึ 8=ค 9=ต.
test('Case 6b: Thai-layout digit row keeps the leading zero and digit 3', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()
  await typeCode(page, 'จๅ/-ภถุึคตจๅ/')

  await expect(dialog(page)).toContainText('ZERO LEADING PROD')
  await expect(dialog(page)).toContainText('0123456789012')
  await shot(page, testInfo, 'case6b-thai-leading-zero.png')
})

// Case 7: focus in wrong field when scanning
test('Case 7: focus outside the scan box never captures the code', async ({ page }, testInfo) => {
  await stage(page)
  // The invoice number is the first text field of the same receipt; a wedge aimed there must
  // stay plain text and add nothing.
  const invoice = page.getByPlaceholder('เช่น IV2616876')
  await expect(invoice).toBeVisible()
  await invoice.focus()
  await typeCode(page, '8851111222222')

  await expect(dialog(page)).not.toBeVisible()
  await expect(invoice).toHaveValue('8851111222222')
  await expect(page.locator('input[type="number"]')).toHaveCount(0)
  await shot(page, testInfo, 'case7-wrong-field.png')
})

// Case 8: Thai (Kedmanee) keyboard layout — the digit row sends Thai glyphs
test('Case 8: Thai layout digit-row scan resolves the same product', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()
  // 8851111222222 on Kedmanee: 8=ค 8=ค 5=ถ 1=ๅ 1=ๅ 1=ๅ 1=ๅ 2=/ (x6)
  await typeCode(page, 'คคถๅๅๅๅ//////')

  await expect(dialog(page)).toContainText('TOMATO SAUCE')
  await expect(dialog(page)).toContainText('8851111222222')
  await shot(page, testInfo, 'case8-thai-layout.png')
})

// Case 8b: a product whose real barcode IS the raw Thai keystroke string. The literal code must
// win; the digit-row translation must never pick the ASCII product instead.
test('Case 8b: an exact raw barcode beats the keyboard-layout translation', async ({ page }, testInfo) => {
  await stage(page, 'pizza', true)
  const input = searchInput(page)
  await input.focus()
  await typeCode(page, 'คคถๅๅๅๅ//////')

  await expect(dialog(page)).toContainText('RAW THAI CODE')
  await expect(dialog(page)).not.toContainText('TOMATO SAUCE')
  await shot(page, testInfo, 'case8b-raw-literal-wins.png')
  await addLine(page).click()
  await expect(page.locator('main')).toContainText('RAW THAI CODE')
  await expect(page.locator('main')).not.toContainText('TOMATO SAUCE')
})

// Case 9: inactive product and colliding codes
test('Case 9: inactive product and catalog collisions', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)

  await input.focus()
  await typeCode(page, '8858888000000')
  await expect(page.getByText('สินค้าบาร์โค้ดนี้ถูกปิดใช้งานแล้ว: "INACTIVE PROD"')).toBeVisible()
  await expect(input).toHaveValue('')
  await shot(page, testInfo, 'case9-inactive.png')

  await typeCode(page, '8859999000000')
  await expect(page.getByText('บาร์โค้ด 8859999000000 ซ้ำกับสินค้า 2 รายการ — โปรดเลือกสินค้าด้วยตนเอง')).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(page.locator('input[type="number"]')).toHaveCount(0)
  await shot(page, testInfo, 'case9-colliding.png')
})

// Case 10: brand isolation mid-work
test('Case 10: a code from another brand is not found in this one', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()

  await typeCode(page, '8857777000000')
  await expect(page.getByText('ไม่พบบาร์โค้ด 8857777000000 ในระบบ')).toBeVisible()
  await expect(dialog(page)).not.toBeVisible()
  await shot(page, testInfo, 'case10-cross-brand.png')
})

// Case 10b: the same device switched into Le Lapin resolves the Le Lapin product
test('Case 10b: after switching brand, the Le Lapin code resolves its own product', async ({ page }, testInfo) => {
  await stage(page, 'lelapin')
  const input = searchInput(page)
  await input.focus()
  await typeCode(page, '8857777000000')
  await expect(dialog(page)).toContainText('FRENCH BAGUETTE')
  await expect(dialog(page)).toContainText('8857777000000')
  await shot(page, testInfo, 'case10b-lelapin.png')
})

// Case 11: a second code scanned behind the open confirmation never replaces the first answer
test('Case 11: late second scan cannot select the wrong product', async ({ page }, testInfo) => {
  await stage(page)
  const input = searchInput(page)
  await input.focus()

  await typeCode(page, '8851111222222')
  await expect(dialog(page)).toContainText('TOMATO SAUCE')
  // A second code read at the wedge while the answer is pending: the modal takes the keys, so
  // it cannot replace the code being confirmed.
  await page.keyboard.type('8853333444444', { delay: 5 })
  await expect(input).toHaveValue('')

  await expect(dialog(page)).toContainText('TOMATO SAUCE')
  await expect(dialog(page)).toContainText('8851111222222')
  await addLine(page).click()

  await expect(page.locator('main')).toContainText('TOMATO SAUCE')
  await expect(page.locator('main')).not.toContainText('MOZZARELLA CHEESE')
  await shot(page, testInfo, 'case11-late-second-scan.png')
})
