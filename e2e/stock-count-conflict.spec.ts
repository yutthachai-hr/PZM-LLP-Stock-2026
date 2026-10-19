import { expect, test, type Page } from '@playwright/test'
import { seedStage } from './fixture'
import { signedIn } from './app'
import { getDoc, listDocs, putDoc } from './emulator'
import { bkkDayStart } from '../src/lib/inventoryRules/time'
import { monthOf } from '../src/lib/monthlyCount'

/**
 * C-02: two devices count the same item against the same balance. The first save wins; the
 * second was counted against a balance that no longer exists, so the stock engine refuses it
 * inside its transaction and names the latest balance. Nothing is recomputed behind the
 * person's back, and their keyed count stays on screen for them to check and save again.
 */

const opened: Page[] = []
test.afterEach(async () => {
  for (const page of opened.splice(0)) await page.context().close()
})

async function countFlour(page: Page, counted: string) {
  await page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า)').fill('FLOUR')
  await page.getByRole('button', { name: /FLOUR/ }).first().click()
  const input = page.getByLabel('จำนวนที่นับได้ของ "FLOUR"')
  await input.fill(counted)
  return input
}

test('a device whose screen already shows the new balance files the true difference, never overwriting', async ({ browser }) => {
  await seedStage()
  await putDoc('stockLevels/wh__flour', { productId: 'flour', locationId: 'wh', qty: 10, updatedAt: Date.now() }, { stampId: false })
  const a = await signedIn(browser, 'manager', '/adjust')
  opened.push(a)
  const b = await signedIn(browser, 'admin', '/adjust')
  opened.push(b)
  await countFlour(a, '12')
  await countFlour(b, '15')

  await a.getByRole('button', { name: /บันทึกการปรับสต๊อก/ }).click()
  await expect(a.getByText(/ปรับสต๊อกเรียบร้อย/)).toBeVisible()
  await expect.poll(async () => (await getDoc('stockLevels/wh__flour'))?.qty).toBe(12)
  // B's live listener moves its figure to 12 before it saves, so 15 counted files +3.
  await expect(b.getByLabel('จำนวนที่ปรับของ "FLOUR"')).toHaveValue('3')
  await expect(b.getByLabel('จำนวนที่นับได้ของ "FLOUR"')).toHaveValue('15')
  await b.getByRole('button', { name: /บันทึกการปรับสต๊อก/ }).click()
  await expect(b.getByText(/ปรับสต๊อกเรียบร้อย/)).toBeVisible()
  await expect.poll(async () => (await getDoc('stockLevels/wh__flour'))?.qty).toBe(15)
  const adjusts = (await listDocs('stockMovements')).filter((m) => m.type === 'adjust' && m.productId === 'flour')
  expect(adjusts.map((m) => m.qty).sort()).toEqual([2, 3])
})

test('a device whose screen is still stale is refused inside the transaction, with the latest balance named', async ({ browser }) => {
  await seedStage()
  await putDoc('stockLevels/wh__flour', { productId: 'flour', locationId: 'wh', qty: 10, updatedAt: Date.now() }, { stampId: false })
  const a = await signedIn(browser, 'manager', '/adjust')
  opened.push(a)
  const b = await signedIn(browser, 'admin', '/adjust')
  opened.push(b)
  await countFlour(a, '12')
  const bInput = await countFlour(b, '15')

  // Freeze only B's live listener (the lag C-02 is about). Its transactions use separate RPCs.
  // Blocking new Listen requests is not enough: a long-poll already open can still deliver,
  // so drop B's connections once and let the block stop the reconnect.
  await b.route(/google\.firestore\.v1\.Firestore\/Listen\//, (route) => route.abort())
  await b.context().setOffline(true)
  await b.waitForTimeout(500)
  await b.context().setOffline(false)

  await a.getByRole('button', { name: /บันทึกการปรับสต๊อก/ }).click()
  await expect(a.getByText(/ปรับสต๊อกเรียบร้อย/)).toBeVisible()
  await expect.poll(async () => (await getDoc('stockLevels/wh__flour'))?.qty).toBe(12)

  await b.getByRole('button', { name: /บันทึกการปรับสต๊อก/ }).click()
  await expect(b.getByText(/ยอดคงเหลือของ "FLOUR" เปลี่ยนไปแล้ว/)).toBeVisible()
  await expect(b.getByText(/ล่าสุด: 12/)).toBeVisible()
  // Nothing written, nothing recomputed, the keyed count kept for review.
  expect((await getDoc('stockLevels/wh__flour'))?.qty).toBe(12)
  const adjusts = async () => (await listDocs('stockMovements')).filter((m) => m.type === 'adjust' && m.productId === 'flour')
  expect(await adjusts()).toHaveLength(1)
  await expect(bInput).toHaveValue('15')

  // After B refreshes (reload) and re-confirms, it posts against the fresh level
  await b.unrouteAll({ behavior: 'ignoreErrors' })
  await b.reload()
  const bInputReloaded = b.getByLabel('จำนวนที่นับได้ของ "FLOUR"')
  await expect(bInputReloaded).toHaveValue('15')
  await expect(b.getByLabel('จำนวนที่ปรับของ "FLOUR"')).toHaveValue('3')
  await b.getByRole('button', { name: /บันทึกการปรับสต๊อก/ }).click()
  await expect(b.getByText(/ปรับสต๊อกเรียบร้อย/)).toBeVisible()
  await expect.poll(async () => (await getDoc('stockLevels/wh__flour'))?.qty).toBe(15)
  expect(await adjusts()).toHaveLength(2)
})

test('Monthly Count: two devices open the same sheet, A posts, stale B is refused with conflict message, and after reload B posts against fresh level', async ({ browser }) => {
  await seedStage()
  await putDoc('stockLevels/wh__flour', { productId: 'flour', locationId: 'wh', qty: 10, updatedAt: Date.now() }, { stampId: false })

  const now = Date.now()
  const month = monthOf(now)
  const countDate = bkkDayStart(now)
  const sheetId = `wh__${month}`
  await putDoc(
    `monthlyCounts/${sheetId}`,
    {
      id: sheetId,
      locationId: 'wh',
      month,
      countDate,
      status: 'counting',
      lines: {},
      createdBy: 'admin',
      createdByName: 'E2E Admin',
      createdAt: now,
      updatedAt: now,
    },
    { stampId: false },
  )

  const a = await signedIn(browser, 'manager', `/counts/${sheetId}`)
  opened.push(a)
  const b = await signedIn(browser, 'admin', `/counts/${sheetId}`)
  opened.push(b)
  b.on('console', (msg) => console.log('PAGE B:', msg.type(), msg.text()))

  // Both devices see flour with system level 10
  const bCount = b.getByRole('table').getByLabel('จำนวนที่นับได้ของ "FLOUR"')
  await expect(bCount).toBeVisible()
  await bCount.fill('16')
  // B saves count line (still in counting status, not posted to stock yet)
  await b.getByRole('button', { name: /บันทึกยอดนับ/ }).click()
  await expect(b.getByText(/บันทึกยอดนับแล้ว/)).toBeVisible()

  // Freeze only B's live listener so B keeps the captured expected level 10
  await b.route(/google\.firestore\.v1\.Firestore\/Listen\//, (route) => route.abort())
  await b.context().setOffline(true)
  await b.waitForTimeout(500)
  await b.context().setOffline(false)

  // Device A navigates to /adjust and posts an adjustment (flour: 10 -> 12)
  await a.goto('/adjust')
  await countFlour(a, '12')
  await a.getByRole('button', { name: /บันทึกการปรับสต๊อก/ }).click()
  await expect(a.getByText(/ปรับสต๊อกเรียบร้อย/)).toBeVisible()
  await expect.poll(async () => (await getDoc('stockLevels/wh__flour'))?.qty).toBe(12)

  // Device B attempts to confirm and post monthly count (stale expected level 10 vs actual 12)
  await b.getByRole('button', { name: /ยืนยันและปรับสต๊อก/ }).click()
  await b.getByRole('dialog').getByRole('button', { name: 'ยืนยัน' }).click()

  // B is refused with conflict message
  await expect(b.getByText(/ยอดคงเหลือของ "FLOUR" เปลี่ยนไปแล้ว/)).toBeVisible()
  await expect(b.getByText(/ล่าสุด: 12/)).toBeVisible()

  // Nothing from B is written: stock level still 12, movements only 1 (from A)
  expect((await getDoc('stockLevels/wh__flour'))?.qty).toBe(12)
  const adjusts = async () => (await listDocs('stockMovements')).filter((m) => m.type === 'adjust' && m.productId === 'flour')
  expect(await adjusts()).toHaveLength(1)

  // B's typed counts are still on screen
  await expect(bCount).toHaveValue('16')

  // After B refreshes (reload), unblock route
  await b.unrouteAll({ behavior: 'ignoreErrors' })
  await b.reload()

  // On reload, system level is now 12, counted is 16
  const bCountReloaded = b.getByRole('table').getByLabel('จำนวนที่นับได้ของ "FLOUR"')
  await expect(bCountReloaded).toHaveValue('16')

  // B re-confirms and posts against fresh level
  await b.getByRole('button', { name: /ยืนยันและปรับสต๊อก/ }).click()
  await b.getByRole('dialog').getByRole('button', { name: 'ยืนยัน' }).click()
  await expect(b.getByText(/ปรับสต๊อกแล้ว:/)).toBeVisible()

  // Verify stock level is 16 in emulator
  await expect.poll(async () => (await getDoc('stockLevels/wh__flour'))?.qty).toBe(16)
  expect(await adjusts()).toHaveLength(2)
})
