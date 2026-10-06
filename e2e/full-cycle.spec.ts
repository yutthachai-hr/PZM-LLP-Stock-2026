import { expect, test } from '@playwright/test'
import { getDoc, listDocs, putDoc } from './emulator'
import { seedApprovedRequest, seedStage } from './fixture'
import { signedIn } from './app'
import { confirmButton, prepareFullReceipt } from './receive'
import { countDayOf } from '../src/lib/monthlyCount'
import { auditIntegrity } from '../src/lib/integrityAudit'

/**
 * The Phase A exit gate's whole loop (scenario E9), through the screens under the real
 * rules: an approved request becomes orders, both deliveries are checked in, last month's
 * count is posted — and the integrity auditor finds nothing that disagrees afterwards.
 */
const DAY = 86_400_000
const MONTH = '2026-09'
const COUNT_DAY = countDayOf(MONTH)

test('request → orders → receive → count → post: the auditor finds no mismatch', async ({ browser }) => {
  test.setTimeout(180_000)
  const stage = await seedStage()
  await seedApprovedRequest(stage)
  // Opening stock: 10 flour on the books before the count day.
  await putDoc('stockMovements/m0', {
    docNo: 'RC-00001', type: 'receive', productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 10, toLocationId: 'wh',
    date: COUNT_DAY - DAY, byUserId: stage.uid.manager, byUserName: 'E2E Manager', createdAt: Date.now(),
  })
  await putDoc('stockLevels/wh__flour', { productId: 'flour', locationId: 'wh', qty: 10, updatedAt: Date.now(), updatedBy: stage.uid.manager })
  await putDoc('counters/receive', { value: 1 })

  // 1. The request becomes one order per supplier.
  const manager = await signedIn(browser, 'manager', '/requests/pr1')
  await manager.locator('main').getByRole('button', { name: 'สร้างใบสั่งซื้อ' }).click()
  await manager.getByRole('dialog').getByRole('button', { name: 'สร้างใบสั่งซื้อ' }).click()
  await expect.poll(async () => (await getDoc('purchaseRequests/pr1'))?.status, { timeout: 20_000 }).toBe('poCreated')

  // 2. Both deliveries are checked in.
  const staff = await signedIn(browser, 'staffA', '/receive?po=po_pr1_sup1')
  await prepareFullReceipt(staff, 'INV-E9-1')
  await confirmButton(staff).click()
  await expect.poll(async () => (await getDoc('purchaseOrders/po_pr1_sup1'))?.status, { timeout: 20_000 }).toBe('received')
  const staff2 = await signedIn(browser, 'staffA', '/receive?po=po_pr1_sup2')
  await prepareFullReceipt(staff2, 'INV-E9-2')
  await confirmButton(staff2).click()
  await expect.poll(async () => (await getDoc('purchaseOrders/po_pr1_sup2'))?.status, { timeout: 20_000 }).toBe('received')
  expect((await getDoc('stockLevels/wh__flour'))?.qty).toBe(16)

  // 3. Last month's count: 9 flour on the shelf against 10 on the books.
  const now = Date.now()
  await putDoc(`monthlyCounts/wh__${MONTH}`, {
    locationId: 'wh', month: MONTH, countDate: COUNT_DAY, status: 'counting',
    lines: { flour: { qty: 9, by: stage.uid.staffA, byName: 'E2E Staff A', at: now } },
    createdBy: stage.uid.staffA, createdByName: 'E2E Staff A', createdAt: now, updatedAt: now,
  })
  await manager.goto(`/counts/wh__${MONTH}`)
  const brand = manager.getByRole('button', { name: 'Pizza Mania' })
  if (await brand.isVisible().catch(() => false)) await brand.click()
  await manager.getByRole('button', { name: 'ยืนยันและปรับสต๊อก' }).first().click()
  // −1 on 10 is a 10% difference: big, so the manager approves it first (plan E2).
  await manager.getByRole('dialog').getByLabel(/ตรวจผลต่างมาก/).check()
  await manager.getByRole('dialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click()
  await expect.poll(async () => (await getDoc(`monthlyCounts/wh__${MONTH}`))?.status, { timeout: 20_000 }).toBe('posted')
  expect((await getDoc('stockLevels/wh__flour'))?.qty).toBe(15) // 9 counted + 6 received after

  // 4. Everything the app wrote, checked against itself.
  const load = async (c: string) => (await listDocs(c)) as never[]
  const report = auditIntegrity({
    products: await load('products'),
    locations: await load('locations'),
    stockLevels: await load('stockLevels'),
    movements: await load('stockMovements'),
    purchaseOrders: await load('purchaseOrders'),
    purchaseRequests: await load('purchaseRequests'),
    transfers: await load('transfers'),
  })
  test.info().annotations.push({ type: 'observed', description: JSON.stringify({ scanned: report.scanned, findings: report.findings.map((f) => `${f.severity}:${f.code}`) }) })
  expect(report.findings.filter((f) => f.severity !== 'info')).toEqual([])
})
