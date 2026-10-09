import { expect, test } from '@playwright/test'
import { listDocs, putDoc } from './emulator'
import { seedStage } from './fixture'
import { signedIn } from './app'

const DAY = 86_400_000

/**
 * Phase G10: the stock card shows where a product will run out, why, and what to do about
 * it — and writes nothing but (for a manager) the shadow snapshot.
 */
test('stock card: stock-out prediction with its reasons, recommendation only', async ({ browser }) => {
  const stage = await seedStage()
  const now = Date.now()
  // 20 days of use at the warehouse, 3 KG a day, and 6 KG left: out in two days.
  for (let i = 1; i <= 20; i++) {
    const at = now - i * DAY
    await putDoc(`stockMovements/use${i}`, { docNo: `CS-${i}`, type: 'consume', productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 3, fromLocationId: 'wh', date: at, byUserId: stage.uid.staffA, byUserName: 'E2E Staff A', createdAt: at })
  }
  await putDoc('stockMovements/open', { docNo: 'RC-OPEN', type: 'receive', productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 66, toLocationId: 'wh', date: now - 25 * DAY, byUserId: stage.uid.manager, byUserName: 'E2E Manager', createdAt: now - 25 * DAY })
  await putDoc('stockLevels/wh__flour', { productId: 'flour', locationId: 'wh', qty: 6, updatedAt: now, updatedBy: 'x' })
  const before = { po: (await listDocs('purchaseOrders')).length, tr: (await listDocs('transfers')).length, pr: (await listDocs('purchaseRequests')).length }

  const page = await signedIn(browser, 'manager', '/products/flour/card')
  await expect(page.getByText(/คาดว่าหมด .* · ขาด/).first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'ทำไม?' }).first().click()
  await expect(page.getByText(/พร้อมใช้ 6 · ใช้วันละ [\d.]+ → พอ [\d.]+ วัน/).first()).toBeVisible()
  await expect(page.getByText('คำแนะนำเท่านั้น — ระบบไม่สร้างใบโอน ใบสั่งซื้อ หรือเปลี่ยนผู้ขายเอง')).toBeVisible()

  await page.waitForTimeout(1500)
  expect({ po: (await listDocs('purchaseOrders')).length, tr: (await listDocs('transfers')).length, pr: (await listDocs('purchaseRequests')).length }).toEqual(before)
})
