import { expect, test, type Page } from '@playwright/test'
import { getDoc, putDoc, putMany } from './emulator'
import { seedStage } from './fixture'
import { open, signedIn } from './app'

/**
 * P0 (owner, 22 Oct 2026): a delivery date waiting for a manager must be one tap away on the
 * Orders page, not something people dig out of notifications. 25 orders in the window, the one
 * waiting is the oldest, so it sits on page 2 of the default list.
 */

const DAY = 86_400_000
const now = Date.now()

function order(i: number, over: Record<string, unknown> = {}) {
  return {
    docNo: `PO-${String(i).padStart(5, '0')}`, supplierId: 'sup1', supplierName: 'E2E SUPPLIER', status: 'ordered', locationId: 'wh',
    orderedAt: now - i * 3_600_000, expectedAt: now + 3 * DAY, shareStatus: 'sent', sentAt: now - i * 3_600_000,
    lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 2 }],
    createdBy: 'seed', createdByName: 'Seed', createdAt: now - i * 3_600_000, updatedAt: now - i * 3_600_000, ...over,
  }
}
const PENDING = {
  supplierConfirmationStatus: 'pending_date_approval', requestedDeliveryDate: now + 3 * DAY,
  pendingDeliveryDate: { date: now + 6 * DAY, at: now - DAY, changeId: 'chg-1', name: 'MMP' },
  deliveryDateHistory: [{ id: 'chg-1', at: now - DAY, source: 'supplier', action: 'proposed', to: now + 6 * DAY, byName: 'MMP', requestId: 'req-mmp-1' }],
  supplierActivity: [{ id: 'a1', at: now - DAY, kind: 'pendingApproval', byName: 'MMP', date: now + 6 * DAY }],
}

async function stage() {
  await seedStage()
  await putMany(Array.from({ length: 24 }, (_, k) => ({ path: `purchaseOrders/o${k + 1}`, data: { id: `o${k + 1}`, ...order(k + 1) } })))
  await putDoc('purchaseOrders/waiting', order(30, PENDING))
}

/** The browser's /api/supplier-po/decide, answered here: the emulator gets the decided order. */
async function decideHere(page: Page) {
  await page.route('**/api/supplier-po/decide', async (route) => {
    const decided = { ...(await getDoc('purchaseOrders/waiting')), supplierConfirmationStatus: 'changed', confirmedDeliveryDate: now + 6 * DAY, expectedAt: now + 6 * DAY, updatedAt: Date.now() } as Record<string, unknown>
    delete decided.pendingDeliveryDate
    await putDoc('purchaseOrders/waiting', decided, { stampId: false })
    await route.fulfill({ status: 200, json: { order: decided } })
  })
}

const chip = (page: Page) => page.getByRole('group', { name: 'ตัวกรองด่วน' }).getByRole('button', { name: /^รออนุมัติวันส่ง/ })

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

test('the waiting order is one chip away, beyond page 1, and leaves the count once approved', async ({ browser }) => {
  await stage()
  const page = await signedIn(browser, 'manager', '/orders')
  await decideHere(page)
  await expect(chip(page)).toHaveText(/\(1\)/)
  await expect(page.getByRole('row', { name: /เปิดใบสั่งซื้อ PO-00030 / })).toHaveCount(0) // page 1 shows the newest 20
  await chip(page).click()
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'true')
  const row = page.getByText('PO-00030').locator('visible=true').first()
  await expect(row).toBeVisible()
  await expect(page.getByRole('row', { name: /เปิดใบสั่งซื้อ PO-00001 / })).toHaveCount(0) // only the waiting order is listed
  await expect(page.getByRole('row', { name: /^เปิดใบสั่งซื้อ PO-/ })).toHaveCount(1)

  await row.click()
  const sheet = page.getByRole('dialog', { name: /PO-00030/ })
  await sheet.getByRole('button', { name: 'อนุมัติวันใหม่' }).click()
  await expect(page.getByText('อนุมัติวันส่งใหม่แล้ว')).toBeVisible()
  await expect(chip(page)).toHaveText(/\(0\)/)
})

test('a notification deep link opens the exact order even when it is not on page 1', async ({ browser }) => {
  await stage()
  const page = await signedIn(browser, 'manager')
  await open(page, '/orders?po=waiting')
  await expect(page.getByRole('dialog', { name: /PO-00030/ })).toBeVisible()
  await expect(page.getByRole('dialog', { name: /PO-00030/ }).getByRole('button', { name: 'อนุมัติวันใหม่' })).toBeVisible()
})

test('a notification deep link fetches an order outside the loaded window, never another brand', async ({ browser }) => {
  await stage()
  await putDoc('purchaseOrders/old-waiting', order(90, { ...PENDING, orderedAt: now - 90 * DAY }))
  await putDoc('lelapin__purchaseOrders/other-only', order(99, PENDING))
  const page = await signedIn(browser, 'manager', '/orders?po=old-waiting')
  await expect(page.getByRole('dialog', { name: /PO-00090/ })).toBeVisible()
  await open(page, '/orders?po=other-only')
  await expect(page.getByText('ไม่พบใบสั่งซื้อ', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: /PO-00099/ })).toHaveCount(0)
})

test('a supplier notification refreshes the loaded pending count, staff cannot decide', async ({ browser }) => {
  await stage()
  const page = await signedIn(browser, 'staffA', '/orders')
  await expect(chip(page)).toHaveText(/\(1\)/)
  await putDoc('purchaseOrders/o24', order(24, { ...PENDING, updatedAt: Date.now() }))
  await putDoc('notifications/supplierDatePending__o24__new-change', {
    kind: 'supplierDatePending', category: 'supplier', priority: 'high', active: true,
    to: { all: true }, audienceKeys: ['all'], readBy: {}, expiresAt: Date.now() + 7 * DAY,
    params: { supplier: 'E2E SUPPLIER', docNo: 'PO-00024', date: '2026-10-28', by: 'MMP' },
    link: '/orders?po=o24', createdAt: Date.now(), updatedAt: Date.now(), source: 'worker', sourceId: 'test',
  })
  await expect(chip(page)).toHaveText(/\(2\)/)
  await chip(page).click()
  await page.getByRole('row', { name: /เปิดใบสั่งซื้อ PO-00030 / }).click()
  const sheet = page.getByRole('dialog', { name: /PO-00030/ })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'อนุมัติวันใหม่' })).toHaveCount(0)
})

test('English labels', async ({ browser }) => {
  await stage()
  const page = await signedIn(browser, 'manager', '/orders')
  await page.evaluate((k) => localStorage.setItem(k, 'en'), 'pmstock:lang')
  await page.reload()
  await expect(page.getByRole('group', { name: 'Quick filters' }).getByRole('button', { name: /^Pending Date Approval \(1\)/ })).toBeVisible()
})
