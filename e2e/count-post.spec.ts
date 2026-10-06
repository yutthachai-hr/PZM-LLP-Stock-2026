import { expect, test } from '@playwright/test'
import { getDoc, listDocs, putDoc } from './emulator'
import { seedStage, type Stage } from './fixture'
import { signedIn } from './app'
import { countDayOf } from '../src/lib/monthlyCount'

/**
 * Posting a monthly count (plan A10, scenario E4). The difference is worked out inside the
 * transaction from the books as they are then, so stock keyed while the manager reviews
 * the sheet does not make the posted figure wrong: afterwards the books on the count day
 * say exactly what was counted.
 */

const DAY = 86_400_000
const MONTH = '2026-09'
const COUNT_DAY = countDayOf(MONTH)

async function movement(stage: Stage, id: string, docNo: string, qty: number, date: number) {
  await putDoc(`stockMovements/${id}`, {
    docNo, type: 'receive', productId: 'flour', productName: 'FLOUR', unit: 'KG', qty, toLocationId: 'wh',
    date, byUserId: stage.uid.manager, byUserName: 'E2E Manager', createdAt: Date.now(),
  })
}

async function balance(qty: number, stage: Stage) {
  await putDoc('stockLevels/wh__flour', { productId: 'flour', locationId: 'wh', qty, updatedAt: Date.now(), updatedBy: stage.uid.manager })
}

test('stock keyed while the sheet is open: after posting, the count day holds what was counted', async ({ browser }) => {
  const stage = await seedStage()
  // 10 on the count day, 5 arrived after it.
  await movement(stage, 'm1', 'RC-00001', 10, COUNT_DAY - DAY)
  await movement(stage, 'm2', 'RC-00002', 5, Date.now() - DAY)
  await balance(15, stage)
  await putDoc('counters/receive', { value: 2 })
  const now = Date.now()
  await putDoc(`monthlyCounts/wh__${MONTH}`, {
    locationId: 'wh', month: MONTH, countDate: COUNT_DAY, status: 'counting',
    lines: { flour: { qty: 8, by: stage.uid.staffA, byName: 'E2E Staff A', at: now } },
    createdBy: stage.uid.staffA, createdByName: 'E2E Staff A', createdAt: now, updatedAt: now,
  })

  const page = await signedIn(browser, 'manager', `/counts/wh__${MONTH}`)
  await page.getByRole('button', { name: 'ยืนยันและปรับสต๊อก' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // Another device keys a forgotten delivery dated on the count day while the dialog is open:
  // the books on that day are now 13, not the 10 the screen showed.
  await movement(stage, 'm3', 'RC-00003', 3, COUNT_DAY)
  await balance(18, stage)

  // Through the trusted command (ADR-001, .env.e2e) — asserted, not assumed.
  const viaCommand = page.waitForResponse('**/api/stock/postCount')
  await page.getByRole('dialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click()
  expect((await viaCommand).status()).toBe(200)
  await expect.poll(async () => (await getDoc(`monthlyCounts/wh__${MONTH}`))?.status, { timeout: 20_000 }).toBe('posted')

  const adj = (await listDocs('stockMovements')).filter((m) => m.type === 'adjust')
  test.info().annotations.push({ type: 'observed', description: JSON.stringify(adj.map((m) => [m.qty, m.fromLocationId ?? m.toLocationId])) })
  expect(adj).toHaveLength(1)
  expect(adj[0]).toMatchObject({ productId: 'flour', qty: 5, fromLocationId: 'wh', date: COUNT_DAY })
  // Books on the count day: 13 − 5 = 8, the count. Today: 8 + 5 that came after.
  expect((await getDoc('stockLevels/wh__flour'))?.qty).toBe(13)
  const sheet = await getDoc(`monthlyCounts/wh__${MONTH}`)
  expect((sheet?.results as Record<string, { systemQty: number; diff: number }>).flour).toMatchObject({ systemQty: 13, diff: -5 })
})
