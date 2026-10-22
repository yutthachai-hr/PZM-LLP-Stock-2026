import { test, expect, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

/**
 * P0 (owner, 22 Oct 2026): voiding a stock movement needs a reason, and the reason, who and when
 * show wherever the row does. Demo mode only: browser storage, synthetic rows, no live data.
 *
 *   QA Flour  RC-QA-001 receive 10 at wh                     -> voidable
 *   QA Salt   RC-QA-002 receive 5, CS-QA-002 consume 5       -> void must fail (goods used)
 *   QA Flour  RC-QA-OLD receive 3, voided before reasons     -> legacy label, no invented reason
 */
async function stage(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('void-reason-fixture')) return
    localStorage.setItem('void-reason-fixture', '1')
    const now = Date.now()
    const store = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    const user = { id: 'void-admin', email: 'demo@inventory-pzm.local', name: 'Void QA', role: 'admin', active: true, createdAt: now }
    store('users', { [user.id]: user })
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
    store('locations', { wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
    const base = { category: 'Dry', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now, unit: 'Kilogram', unitType: 'KG' }
    store('products', { p1: { ...base, id: 'p1', sku: 'QA-001', name: 'QA Flour' }, p2: { ...base, id: 'p2', sku: 'QA-002', name: 'QA Salt' } })
    const mv = (id: string, over: Record<string, unknown>) => ({
      id, docNo: id, productName: 'QA Flour', productId: 'p1', unit: 'KG', date: now, createdAt: now, byUserId: user.id, byUserName: user.name, ...over,
    })
    store('stockMovements', {
      'RC-QA-001': mv('RC-QA-001', { type: 'receive', qty: 10, toLocationId: 'wh' }),
      'RC-QA-002': mv('RC-QA-002', { type: 'receive', qty: 5, toLocationId: 'wh', productId: 'p2', productName: 'QA Salt', createdAt: now - 2 }),
      'CS-QA-002': mv('CS-QA-002', { type: 'consume', qty: 5, fromLocationId: 'wh', productId: 'p2', productName: 'QA Salt', createdAt: now - 1 }),
      'RC-QA-OLD': mv('RC-QA-OLD', { type: 'receive', qty: 3, toLocationId: 'wh', createdAt: now - 3, voided: true, updatedBy: 'old-admin', updatedByName: 'Old Admin', updatedAt: now - 60_000 }),
    })
    store('stockLevels', {
      wh__p1: { id: 'wh__p1', productId: 'p1', locationId: 'wh', qty: 10, updatedAt: now, updatedBy: user.id },
      wh__p2: { id: 'wh__p2', productId: 'p2', locationId: 'wh', qty: 0, updatedAt: now, updatedBy: user.id },
    })
    localStorage.setItem('pmstock:lang', 'en')
  })
}

const row = (page: Page, docNo: string) => page.locator('tbody tr').filter({ hasText: docNo })

test('a void needs a reason, keeps the draft on failure, and is recorded once', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await stage(page)
  await page.goto('/movements')
  await expect(row(page, 'RC-QA-001')).toBeVisible()

  // The legacy row is readable and does not pretend to have a reason.
  await expect(row(page, 'RC-QA-OLD')).toContainText('Voided by Old Admin')
  await expect(row(page, 'RC-QA-OLD')).toContainText('Legacy record: no void reason')

  // Failure path first: the goods were used, so the reversal is refused and the draft stays.
  await row(page, 'RC-QA-002').getByRole('button', { name: 'Cancel', exact: true }).click()
  let dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Void movement', exact: true })
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('textbox').fill('   ')
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('textbox').fill('x'.repeat(501))
  await expect(dialog.getByText('501/500')).toBeVisible()
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('textbox').fill('wrong supplier')
  await confirm.click()
  await expect(page.getByText(/Operation failed/)).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox')).toHaveValue('wrong supplier')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(row(page, 'RC-QA-002')).not.toContainText('(voided)')

  // Success path, with a double click on the confirm button.
  await row(page, 'RC-QA-001').getByRole('button', { name: 'Cancel', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('  keyed twice, see RC-QA-009  ')
  await dialog.getByRole('button', { name: 'Void movement', exact: true }).dblclick()
  await expect(dialog).toBeHidden()
  await expect(row(page, 'RC-QA-001')).toContainText('(voided)')
  await expect(row(page, 'RC-QA-001')).toContainText('Voided by Void QA')
  await expect(row(page, 'RC-QA-001')).toContainText('Reason: keyed twice, see RC-QA-009')

  const stored = await page.evaluate(() => {
    const movements = JSON.parse(localStorage.getItem('pmstock:v1:stockMovements') ?? '{}')
    const levels = JSON.parse(localStorage.getItem('pmstock:v1:stockLevels') ?? '{}')
    return { mv: movements['RC-QA-001'], flour: levels.wh__p1.qty, salt: levels.wh__p2.qty, salt002: movements['RC-QA-002'] }
  })
  expect(stored.mv).toMatchObject({ voided: true, voidReason: 'keyed twice, see RC-QA-009', voidedBy: 'void-admin', voidedByName: 'Void QA' })
  expect(typeof stored.mv.voidedAt).toBe('number')
  // Reversed exactly once, and the refused void left the other product untouched.
  expect([stored.flour, stored.salt]).toEqual([0, 0])
  expect(stored.salt002.voided).toBeUndefined()

  // Stock Card and Activity Log carry the same reason, person and time.
  await page.goto('/products/p1/card')
  await expect(page.locator('main')).toContainText('Reason: keyed twice, see RC-QA-009')
  await expect(page.locator('main')).toContainText('Legacy record: no void reason')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Excel', exact: true }).click()
  const file = info.outputPath('stock-card.xlsx')
  await (await download).saveAs(file)
  const book = XLSX.read(readFileSync(file), { type: 'buffer' })
  const sheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]])
  expect(String(sheet.find((r) => Object.values(r).includes('RC-QA-001'))?.Void)).toMatch(/^Voided by Void QA .+ · Reason: keyed twice, see RC-QA-009$/)
  expect(String(sheet.find((r) => Object.values(r).includes('RC-QA-OLD'))?.Void)).toMatch(/Legacy record: no void reason$/)
  await page.goto('/reports')
  await page.getByRole('button', { name: 'Activity log', exact: true }).click()
  const entry = page.locator('tbody tr').filter({ hasText: 'RC-QA-001' }).filter({ hasText: 'Voided (stock returned)' })
  await expect(entry).toContainText('Reason: keyed twice, see RC-QA-009')
  await expect(entry).toContainText('Void QA')
})

test('a phone card also asks for the reason', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stage(page)
  await page.goto('/movements')
  const card = page.locator('[data-row-key="RC-QA-001"]:visible').first()
  await card.getByRole('button', { name: 'Cancel', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Void movement', exact: true })).toBeDisabled()
  await dialog.getByRole('textbox').fill('phone reason')
  await dialog.getByRole('button', { name: 'Void movement', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-row-key="RC-QA-001"]:visible').first()).toContainText('Reason: phone reason')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
