import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

async function stage(page: Page, brand = 'pizza', role = 'admin') {
  page.on('pageerror', (error) => console.error('Browser error:', error.message))
  await page.addInitScript(({ brand, role }) => {
    if (localStorage.getItem('orders-ux-fixture')) return
    localStorage.setItem('orders-ux-fixture', '1')
    const now = Date.now(), day = 86_400_000
    const user = { id: 'ux-user', email: 'demo@inventory-pzm.local', name: 'UX Demo', role, active: true, createdAt: now }
    const store = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    store('users', { 'ux-user': user })
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', brand)
    for (const [id, prefix] of [['pizza', ''], ['lelapin', 'lelapin__'], ['rnd', 'rnd__']]) {
      store(`${prefix}locations`, { wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
      store(`${prefix}suppliers`, { sup: { id: 'sup', name: `${id} SUPPLIER`, active: true, type: 'takingReturn', createdAt: now } })
      store(`${prefix}products`, { flour: { id: 'flour', sku: 'F-001', name: 'FLOUR', unit: 'KG', unitType: 'KG', minStock: 0, active: true, createdAt: now } })
      const rows: Record<string, unknown> = {}
      const states = ['waiting', 'confirmed', 'changed', 'pending_date_approval', undefined, 'confirmed']
      states.forEach((supplierConfirmationStatus, i) => {
        const key = `ux-${i + 1}`
        rows[key] = { id: key, docNo: `PO-UX-00${i + 1}`, supplierId: 'sup', supplierName: `${id} SUPPLIER`, locationId: 'wh',
          status: 'ordered', orderedAt: now - day - i * 1000, expectedAt: i === 5 ? now - 3 * day : now + day,
          lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10, receivedQty: i === 4 ? 4 : 0 }],
          ...(i === 4 ? { receipts: [{ docNo: 'RC-1', date: now, byId: user.id, byName: user.name, invoiceNo: 'INV-1', lines: [{ productId: 'flour', qty: 4 }] }] } : {}),
          supplierConfirmationStatus, shareStatus: 'sent', sentAt: now - day,
          ...(i === 1 ? { requestId: 'request-ux' } : {}),
          createdBy: user.id, createdByName: user.name, createdAt: now - day, updatedAt: now }
      })
      store(`${prefix}purchaseOrders`, rows)
    }
  }, { brand, role })
  await page.goto('/orders')
  await expect(page.locator('main').getByText(`${brand} SUPPLIER`, { exact: true }).filter({ visible: true }).first()).toBeVisible()
}
const row = (page: Page, id = 'ux-1') => page.locator(`[data-row-key="${id}"]:visible`)
const sheet = (page: Page, no = 'PO-UX-001') => page.getByRole('dialog', { name: `ใบสั่งซื้อ ${no}`, exact: true })

test('screenshots at desktop tablet and mobile widths', async ({ page }) => {
  await stage(page)
  const phase = process.env.ORDERS_UX_CAPTURE ?? 'after'
  const dir = `docs/evidence/orders-ux/${phase}`
  await mkdir(dir, { recursive: true })
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.locator('main').getByText('PO-UX-001', { exact: true }).filter({ visible: true })).toBeVisible()
    await page.screenshot({ path: `${dir}/${width}-th.png`, fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('row opens its own existing sheet and no view buttons remain', async ({ page }) => {
  await stage(page)
  await expect(page.getByRole('button', { name: 'ดูใบสั่ง', exact: true })).toHaveCount(0)
  await row(page, 'ux-2').click()
  await expect(sheet(page, 'PO-UX-002')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
})

test('checkboxes and menu do not open a sheet; multi-selection survives', async ({ page }) => {
  await stage(page)
  await row(page).getByRole('checkbox').check()
  await row(page, 'ux-2').getByRole('checkbox').check()
  await expect(page.getByText('เลือก 2 ใบ', { exact: true })).toBeVisible()
  await row(page).getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(row(page).getByRole('checkbox')).toBeChecked()
})

test('keyboard opens the focused row and does not activate a focused checkbox', async ({ page }) => {
  await stage(page)
  await row(page).focus()
  await page.keyboard.press('Enter')
  await expect(sheet(page)).toBeVisible()
  await sheet(page).getByLabel('ปิด', { exact: true }).click()
  await row(page, 'ux-2').focus()
  await page.keyboard.press('Space')
  await expect(sheet(page, 'PO-UX-002')).toBeVisible()
  await sheet(page, 'PO-UX-002').getByLabel('ปิด', { exact: true }).click()
  await row(page).getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await expect(row(page).getByRole('checkbox')).toBeChecked()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('receiving navigates and LINE menu opens only the send wizard', async ({ page }) => {
  await stage(page)
  await row(page).getByRole('button', { name: 'ตรวจรับของ', exact: true }).click()
  await expect(page).toHaveURL(/\/receive\?po=ux-1/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/orders')
  await row(page).getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }).click()
  await page.getByRole('menuitem', { name: 'ส่ง LINE', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(sheet(page)).toHaveCount(0)
})

test('supplier confirmation updates remain visible in the list and open sheet', async ({ page }) => {
  await stage(page)
  await expect(row(page, 'ux-6')).toContainText('ผู้ขายยืนยันแล้ว')
  await expect(row(page, 'ux-6')).toContainText('เกินกำหนดรับของ')
  await row(page).click()
  await page.evaluate(async () => {
    const data = JSON.parse(localStorage.getItem('pmstock:v1:purchaseOrders')!)
    const next = { ...data['ux-1'], supplierConfirmationStatus: 'confirmed', supplierConfirmedAt: Date.now() }
    window.dispatchEvent(new CustomEvent('pzm:order-updated', { detail: next }))
  })
  await expect(sheet(page)).toContainText('ผู้ขายยืนยันแล้ว')
  await sheet(page).getByLabel('ปิด', { exact: true }).click()
  await expect(row(page)).toContainText('ผู้ขายยืนยันแล้ว')
})

test('menu supports keyboard focus, arrows and Escape without opening the row', async ({ page }) => {
  await stage(page)
  const trigger = row(page).getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'แก้ไข', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'ส่ง LINE', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('touch opens a mobile card, but tapping its menu does not', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5187', hasTouch: true, viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    await stage(page)
    await row(page).getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }).tap()
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await row(page).getByText('PO-UX-001', { exact: true }).tap()
    await expect(sheet(page)).toBeVisible()
  } finally {
    await context.close()
  }
})

test('filters retain multi-selection and both export formats still download', async ({ page }) => {
  await stage(page)
  await row(page).getByRole('checkbox').check()
  await page.getByRole('searchbox', { name: 'ค้นหาเลข PO, ชื่อผู้ขาย, สินค้า...' }).fill('PO-UX-002')
  await expect(row(page, 'ux-2')).toBeVisible()
  await expect(row(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'รีเซ็ต', exact: true }).click()
  await expect(row(page).getByRole('checkbox')).toBeChecked()
  for (const format of ['Excel', 'PDF']) {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: format, exact: true }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(format === 'Excel' ? /\.xlsx$/ : /\.pdf$/)
    expect(await file.failure()).toBeNull()
  }
})

test('request links navigate without opening the order', async ({ page }) => {
  await stage(page)
  await row(page, 'ux-2').getByRole('link', { name: 'จากรายการขอสั่งซื้อ' }).click()
  await expect(page).toHaveURL(/\/requests\/request-ux/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('switching brands clears the sheet and multi-selection even when order IDs repeat', async ({ page }) => {
  await stage(page)
  await row(page).getByRole('checkbox').check()
  await row(page).click({ position: { x: 200, y: 20 } })
  await expect(sheet(page)).toBeVisible()
  await sheet(page).getByLabel('ปิด', { exact: true }).click()
  for (const name of [/Le Lapin/, /R&D/, /Pizza Mania/]) {
    await page.getByRole('button', { name: /^แบรนด์: / }).filter({ visible: true }).click()
    await page.getByRole('menuitemradio', { name }).click()
    await page.getByRole('link', { name: 'สั่งซื้อ', exact: true }).filter({ visible: true }).click()
    await expect(row(page).getByRole('checkbox')).not.toBeChecked()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await row(page).click({ position: { x: 200, y: 20 } })
    await expect(sheet(page)).toBeVisible()
    await sheet(page).getByLabel('ปิด', { exact: true }).click()
  }
})

test('LINE resume opens only the wizard and consumes its query', async ({ page }) => {
  await stage(page)
  await page.goto('/orders?send=ux-2&brand=pizza')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(sheet(page, 'PO-UX-002')).toHaveCount(0)
  await expect(page).not.toHaveURL(/send=/)
})

test('English status and responsive screenshots use translated UI', async ({ page }) => {
  await stage(page)
  await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาอังกฤษ' }).filter({ visible: true }).click()
  await expect(row(page)).toContainText('Waiting Supplier')
  await expect(row(page)).not.toContainText('รอผู้ขายยืนยัน')
  await expect(row(page)).toHaveAccessibleName(/Open order PO-UX-001 from pizza SUPPLIER/)
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.screenshot({ path: `docs/evidence/orders-ux/after/${width}-en.png`, fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

for (const role of ['admin', 'manager', 'staff']) {
  test(`existing actions stay available for ${role} without executing them`, async ({ page }) => {
    await stage(page, 'pizza', role)
    await row(page).getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }).click()
    await expect(page.getByRole('menuitem', { name: 'แก้ไข', exact: true })).toBeEnabled()
    await page.getByRole('menuitem', { name: 'ยกเลิก', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('เหตุผล')
    await expect(sheet(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'ยกเลิกใบสั่งซื้อ', exact: true })).toBeDisabled()
  })
}

for (const brand of ['pizza', 'lelapin', 'rnd']) {
  test(`mobile cards and deep links stay in ${brand}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stage(page, brand)
    await expect(row(page)).toContainText('รอผู้ขายยืนยัน')
    await row(page).click()
    await expect(sheet(page)).toContainText(`${brand} SUPPLIER`)
    await page.goto('/orders?po=ux-2')
    await expect(sheet(page, 'PO-UX-002')).toContainText(`${brand} SUPPLIER`)
    await expect(page).not.toHaveURL(/\?po=/)
  })
}
