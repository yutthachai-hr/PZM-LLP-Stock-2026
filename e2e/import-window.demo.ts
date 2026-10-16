import { test, expect, type Locator, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import * as XLSX from 'xlsx'

// The shared import window on /requests/new (Owner, 15 Oct 2026): drop a file, or type a list.
// Synthetic catalogue only. Photos and PDFs cannot be read in demo mode (no AI reader), which
// is itself one of the cases: they are refused up front with a clear message.

const SHOTS = 'docs/evidence/smart-import'

async function stage(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('import-fixture')) return
    localStorage.setItem('import-fixture', '1')
    const now = Date.now()
    const put = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    put('users', { u: { id: 'u', email: 'demo@inventory-pzm.local', name: 'Import QA', role: 'admin', active: true, createdAt: now } })
    localStorage.setItem('pmstock:v1:session', 'u')
    localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
    put('locations', { wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
    put('suppliers', { sup: { id: 'sup', name: 'SIAMFOOD', active: true, createdAt: now } })
    const product = (id: string, sku: string, name: string, over: Record<string, unknown> = {}) =>
      ({ id, sku, name, category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now, supplierId: 'sup', ...over })
    put('products', {
      flour: product('flour', 'F-001', 'FLOUR'),
      mozz: product('mozz', 'C-002', 'MOZZARELLA (FOODGALLERY)'),
      lone: product('lone', 'X-009', 'LONE ITEM', { supplierId: undefined }),
    })
    // Le Lapin's own books: a different catalogue, so a list read there cannot match Pizza's.
    put('lelapin__locations', { wh: { id: 'wh', name: 'Lapin Kitchen', active: true, type: 'warehouse', createdAt: now } })
    put('lelapin__suppliers', { lsup: { id: 'lsup', name: 'LAPIN SUPPLY', active: true, createdAt: now } })
    put('lelapin__products', { bag: product('bag', 'B-001', 'BAGUETTE', { supplierId: 'lsup' }) })
  })
  await page.goto('/requests/new')
  await page.getByRole('button', { name: /นำเข้าจากไฟล์/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

const zone = (page: Page) => page.getByTestId('import-drop')
const textBox = (page: Page) => page.getByLabel('หรือพิมพ์ / วางรายการสินค้า')

/** Drop files on an element the way a browser does, built inside the page. */
async function dropFiles(target: Locator, files: { name: string; type: string; base64: string }[]) {
  await target.evaluate((el, files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: f.type }))
    el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  }, files)
}
const text = (s: string) => Buffer.from(s, 'utf8').toString('base64')
function xlsx(rows: (string | number)[][]): string {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer).toString('base64')
}

// Since PR27 only a typed exact SKU (or a confirmed alias) is sure; a name is a suggestion to confirm.
test("Owner's typed list: lines to review, the instruction shown, only the typed SKU ticked", async ({ page }) => {
  await stage(page)
  await mkdir(SHOTS, { recursive: true })
  await textBox(page).fill('แป้งพิซซ่า 5 ถุง, มอสซาเรลล่า 3 กก., กล่องพิซซ่า 18 นิ้ว 2 แพ็ค\nF-001 2 kg\nยังไม่ต้องส่งผู้ขาย')
  await page.screenshot({ path: `${SHOTS}/pick-with-text.png` })
  await page.getByRole('button', { name: 'อ่านรายการ' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('note')).toContainText('ยังไม่ต้องส่งผู้ขาย')
  await expect(dialog.getByRole('listitem')).toHaveCount(4)
  await expect(dialog.getByText('จะเพิ่ม 1 จาก 4 รายการ')).toBeVisible()
  await expect(dialog.getByText('ในข้อความ', { exact: true })).toHaveCount(4)
  await page.screenshot({ path: `${SHOTS}/review-typed-list.png` })
  // Back to the text keeps it.
  await dialog.getByRole('button', { name: 'แก้ข้อความ' }).click()
  await expect(textBox(page)).toHaveValue(/ยังไม่ต้องส่งผู้ขาย/)
})

test('a line with no quantity waits for one, then can be added', async ({ page }) => {
  await stage(page)
  await textBox(page).fill('F-001')
  await page.getByRole('button', { name: 'อ่านรายการ' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('จะเพิ่ม 0 จาก 1 รายการ')).toBeVisible()
  await dialog.getByLabel('ใส่จำนวน').fill('12')
  await expect(dialog.getByLabel('ใส่จำนวน')).toHaveValue('12')
  await expect(dialog.getByText('จะเพิ่ม 1 จาก 1 รายการ')).toBeVisible()
  await dialog.getByRole('button', { name: 'เพิ่ม 1 รายการ' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('main')).toContainText('FLOUR')
})

test('a dropped CSV and a dropped Excel file reach the review', async ({ page }) => {
  await stage(page)
  await expect(zone(page)).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/pick-dropzone.png` })
  await dropFiles(zone(page), [{ name: 'list.csv', type: 'text/csv', base64: text('ชื่อสินค้า,จำนวน\nFLOUR,3\nMOZZARELLA (FOODGALLERY),2\n') }])
  // Names, not SKUs: each reaches the review and waits for a person to confirm the product.
  await expect(page.getByRole('dialog').getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('dialog').getByText('จะเพิ่ม 0 จาก 2 รายการ')).toBeVisible()
  await page.getByRole('button', { name: 'เลือกไฟล์อื่น' }).click()
  await dropFiles(zone(page), [{ name: 'order.xlsx', type: '', base64: xlsx([['ชื่อสินค้า', 'จำนวน'], ['FLOUR', 7]]) }])
  await expect(page.getByRole('dialog').getByText('order.xlsx', { exact: false })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('จะเพิ่ม 0 จาก 1 รายการ')).toBeVisible()
})

test('unsupported files, photos and PDFs without the reader, an empty file and two files at once are refused', async ({ page }) => {
  await stage(page)
  const alert = page.getByRole('dialog').getByRole('alert')
  await dropFiles(zone(page), [{ name: 'notes.txt', type: 'text/plain', base64: text('hello') }])
  await expect(alert).toHaveText('ไฟล์นี้นำเข้าไม่ได้ ใช้ Excel (.xlsx, .xls), CSV, รูปภาพ หรือ PDF')
  await dropFiles(zone(page), [{ name: 'bill.jpg', type: 'image/jpeg', base64: text('jpg') }])
  await expect(alert).toHaveText('รูปและ PDF อ่านได้บนระบบจริงเท่านั้น ใช้ Excel หรือ CSV แทน')
  await dropFiles(zone(page), [{ name: 'bill.pdf', type: 'application/pdf', base64: text('%PDF') }])
  await expect(alert).toHaveText('รูปและ PDF อ่านได้บนระบบจริงเท่านั้น ใช้ Excel หรือ CSV แทน')
  await dropFiles(zone(page), [{ name: 'empty.csv', type: 'text/csv', base64: '' }])
  await expect(alert).toHaveText('ไฟล์ว่างเปล่า')
  await dropFiles(zone(page), [
    { name: 'a.csv', type: 'text/csv', base64: text('ชื่อสินค้า,จำนวน\nFLOUR,1\n') },
    { name: 'b.csv', type: 'text/csv', base64: text('ชื่อสินค้า,จำนวน\nFLOUR,2\n') },
  ])
  await expect(alert).toHaveText('วางได้ทีละไฟล์')
  await page.screenshot({ path: `${SHOTS}/refused-two-files.png` })
  await expect(page).toHaveURL(/\/requests\/new/)
})

test('a second drop while the first file is being read is ignored', async ({ page }) => {
  await stage(page)
  await zone(page).evaluate((el, files) => {
    for (const f of files) {
      const dt = new DataTransfer()
      dt.items.add(new File([f.body], f.name, { type: 'text/csv' }))
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    }
  }, [
    { name: 'first.csv', body: 'ชื่อสินค้า,จำนวน\nFLOUR,1\n' },
    { name: 'second.csv', body: 'ชื่อสินค้า,จำนวน\nFLOUR,2\nMOZZARELLA (FOODGALLERY),5\n' },
  ])
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('first.csv', { exact: false })).toBeVisible()
  await expect(dialog.getByRole('listitem')).toHaveCount(1)
})

test('a file dropped beside the zone does not navigate away', async ({ page }) => {
  await stage(page)
  const prevented = await page.getByRole('dialog').evaluate((el) => {
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })
    el.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  expect(prevented).toBe(true)
  await expect(page).toHaveURL(/\/requests\/new/)
})

test('when nothing can be added the window stays open with its review', async ({ page }) => {
  await stage(page)
  await textBox(page).fill('X-009 4')
  await page.getByRole('button', { name: 'อ่านรายการ' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'เพิ่ม 1 รายการ' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('ยังไม่ได้เพิ่มรายการ ตรวจข้อความแจ้งเตือนแล้วลองอีกครั้ง')
  await expect(dialog.getByRole('listitem')).toHaveCount(1)
  await expect(dialog.getByRole('listitem')).toContainText('LONE ITEM')
  await page.screenshot({ path: `${SHOTS}/kept-open-no-supplier.png` })
})

test('English labels', async ({ page }) => {
  await stage(page)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาอังกฤษ' }).filter({ visible: true }).click()
  await page.getByRole('button', { name: /Import from file/ }).click()
  await expect(page.getByText('Drop a file here, or click to choose one')).toBeVisible()
  await page.getByLabel('Or type or paste a product list').fill('FLOUR 2\nnot yet, do not send')
  await page.getByRole('button', { name: 'Read list' }).click()
  await expect(page.getByRole('dialog').getByRole('note')).toContainText('Nothing is sent to a supplier')
  await page.screenshot({ path: `${SHOTS}/review-english.png` })
})

test('the brand cannot change under the open window, and the next brand starts empty with its own catalogue', async ({ page }) => {
  await stage(page)
  await textBox(page).fill('FLOUR 2 kg')
  const brand = page.getByRole('button', { name: /^แบรนด์: / }).locator('visible=true').first()
  // The window's overlay takes the click, so the brand switcher cannot be used while it is open.
  const blocked = await brand.click({ trial: true, timeout: 1500 }).then(() => '', (e: Error) => e.message)
  expect(blocked).toMatch(/locator resolved to <button[^>]*แบรนด์: Pizza Mania/)
  await page.getByRole('dialog').getByRole('button', { name: /ปิด|Close/ }).first().click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await brand.click()
  await page.getByRole('menuitemradio', { name: /Le Lapin/ }).click()
  await expect(brand).toHaveAccessibleName(/Le Lapin/)
  await page.goto('/requests/new')
  await expect(brand).toHaveAccessibleName(/Le Lapin/)
  await page.getByRole('button', { name: /นำเข้าจากไฟล์/ }).click()
  await expect(textBox(page)).toHaveValue('')
  await textBox(page).fill('F-001 2\nB-001 3')
  await page.getByRole('button', { name: 'อ่านรายการ' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('listitem')).toHaveCount(2)
  await expect(dialog.getByText('จะเพิ่ม 1 จาก 2 รายการ')).toBeVisible()
  await expect(dialog.getByRole('listitem').filter({ hasText: 'B-001' })).toHaveCount(1)
  // Pizza's F-001 is not Le Lapin's: nothing from the other brand's catalogue is offered.
  await expect(dialog.getByText('FLOUR')).toHaveCount(0)
})

test('a typed product name is offered, never ticked on its own', async ({ page }) => {
  await stage(page)
  await textBox(page).fill('FLOUR 2')
  await page.getByRole('button', { name: 'อ่านรายการ' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('listitem')).toHaveCount(1)
  await expect(dialog.getByText('จะเพิ่ม 0 จาก 1 รายการ')).toBeVisible()
})

test('a list reader that fails to load says so instead of doing nothing', async ({ page }) => {
  await page.route(/\/src\/lib\/itemText\.ts/, (route) => route.abort())
  await stage(page)
  await textBox(page).fill('F-001 2')
  await page.getByRole('button', { name: 'อ่านรายการ' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  await expect(textBox(page)).toHaveValue('F-001 2')
})
