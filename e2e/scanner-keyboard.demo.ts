import { test, expect, type Page } from '@playwright/test'

// R23 review evidence (local, untracked): a keyboard user types part of a product name into the
// receipt search box and presses Tab to reach the suggestions. Tab is also a wedge scanner's
// terminator since R18, so what happens to the human's text and focus?
async function stage(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear()
    const now = Date.now()
    const user = { id: 'u1', email: 'kb-qa@inventory-pzm.local', name: 'Keyboard QA', role: 'admin', active: true, createdAt: now }
    const store = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    store('users', { u1: user })
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
    store('locations', { wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
    store('products', {
      'p-code1': { id: 'p-code1', sku: 'P-001', name: 'TOMATO SAUCE', barcode: '8851111222222', unit: 'Can', unitType: 'CAN', minStock: 0, active: true, createdAt: now },
    })
  })
}

for (const path of ['/receive', '/adjust']) {
for (const query of ['TOMATO', 'P-00']) {
test(`a keyboard user can Tab through suggestions without losing ${query} on ${path}`, async ({ page }) => {
  await stage(page)
  await page.goto(path)
  if (path === '/receive') await page.getByRole('radio', { name: /รับนอกใบสั่งซื้อ/ }).click()
  const box = page.getByPlaceholder(path === '/receive' ? 'ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)' : 'ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า)')
  await box.click()
  await page.keyboard.type(query, { delay: 80 }) // a person, not a scanner
  await expect(page.getByRole('button', { name: /TOMATO SAUCE/ })).toBeVisible()
  await page.keyboard.press('Tab')
  const observed = {
    boxValue: await box.inputValue(),
    focused: await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim().slice(0, 40)),
    notFoundToast: await page.getByText(/ไม่พบบาร์โค้ด/).count(),
  }
  console.log('R23_OBSERVED', JSON.stringify(observed))
  expect(observed.boxValue, 'the typed search survives Tab').toBe(query)
  expect(observed.notFoundToast, 'no barcode error for a partial search').toBe(0)
  await expect(box).not.toBeFocused()
  // The camera button is next in document order; one more Tab reaches the suggestion.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: /TOMATO SAUCE/ })).toBeFocused()
})
}
}

test('a wedge burst ending in Tab still adds the product (control)', async ({ page }) => {
  await stage(page)
  await page.goto('/receive')
  await page.getByRole('radio', { name: /รับนอกใบสั่งซื้อ/ }).click()
  const box = page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)')
  await box.click()
  await page.keyboard.type('8851111222222', { delay: 5 })
  await page.keyboard.press('Tab')
  await expect(page.getByText('TOMATO SAUCE').first()).toBeVisible()
})
