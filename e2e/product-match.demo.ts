import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import * as XLSX from 'xlsx'

// Owner, 15 Oct 2026: workbook row "RANCH 1 kg." offered MAYONNAISE 1KG (FB FOOD) first.
// Synthetic catalogue only; the names are the ones in the Owner's screenshot.

const SHOTS = 'docs/evidence/product-match'

async function stage(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('match-fixture')) return
    localStorage.setItem('match-fixture', '1')
    const now = Date.now()
    const put = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    put('users', { u: { id: 'u', email: 'demo@inventory-pzm.local', name: 'Match QA', role: 'admin', active: true, createdAt: now } })
    localStorage.setItem('pmstock:v1:session', 'u')
    localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
    put('locations', { wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
    put('suppliers', {
      pichon: { id: 'pichon', name: 'PICHON', active: true, createdAt: now },
      fb: { id: 'fb', name: 'FB FOOD', active: true, createdAt: now },
    })
    const product = (id: string, sku: string, name: string, supplierId?: string) =>
      ({ id, sku, name, category: 'Sauce', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true,
        createdAt: now, updatedAt: now, ...(supplierId ? { supplierId } : {}) })
    put('products', {
      mayo: product('mayo', 'PZS-01-05-001', 'MAYONNAISE 1KG (FB FOOD)', 'fb'),
      gas: product('gas', 'PZG-09-01-001', 'GAS 48 KG Branch 1'),
      ranch: product('ranch', 'PZS-01-06-001', 'RANCH (PICHON)', 'pichon'),
    })
  })
  await page.goto('/')
  await expect(page.locator('main')).toBeVisible()
}

function workbook(): Buffer {
  const wb = XLSX.utils.book_new()
  const rows = [
    ['รายการสั่งของ 15/10/2026'],
    ['ชื่อวัตถุดิบ', 'รอบส่ง', 'หน่วย', 'SKV', 'รวม', 'จำนวนสั่ง', 'เรียกเข้า'],
    ['RANCH 1 kg.', null, 'KG', 1, 1, 2, null],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'รายการสั่งของ')
  return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

test('Excel row RANCH 1 kg. hints RANCH (PICHON), and the row still waits for a person', async ({ page }) => {
  await stage(page)
  await page.goto('/purchase/import')
  await page.locator('input[type=file]').setInputFiles({ name: 'order.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook() })
  const row = page.locator('tr').filter({ hasText: 'RANCH 1 kg.' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('ใกล้เคียง: RANCH (PICHON)')
  await expect(row).not.toContainText('MAYONNAISE')
  // A hint, not a match: the row is still to be checked by a person.
  await expect(row.getByRole('button', { name: 'ตรวจ' })).toBeVisible()
  await mkdir(SHOTS, { recursive: true })
  await row.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/after-import-hint.png` })

  await row.getByRole('button', { name: 'ตรวจ' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('RANCH (PICHON)').first()).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/after-resolve-choices.png` })
})

test('typing RANCH 1 KG in the request form lists RANCH (PICHON) first, never MAYONNAISE', async ({ page }) => {
  await stage(page)
  await page.goto('/requests/new')
  await page.getByPlaceholder('ค้นหาชื่อสินค้า / รหัสสินค้า').fill('RANCH 1 KG')
  const options = page.getByRole('listbox').getByRole('option')
  await expect(options.first()).toContainText('RANCH (PICHON)')
  await expect(page.getByRole('listbox')).not.toContainText('MAYONNAISE')
  await mkdir(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/after-picker.png` })
})
