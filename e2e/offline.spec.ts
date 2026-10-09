import { expect, test } from '@playwright/test'
import { seedStage } from './fixture'
import { open, signedIn } from './app'

/** Plan C4: the screen says when the device is offline, and a half-keyed transfer is kept. */
test('going offline is said on screen, and coming back clears it', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'staffA')
  const banner = page.getByRole('status').filter({ hasText: 'ออฟไลน์' })
  await expect(banner).toHaveCount(0)
  await page.context().setOffline(true)
  await expect(banner).toBeVisible()
  await page.context().setOffline(false)
  await expect(banner).toHaveCount(0)
})

test('a half-keyed transfer request survives leaving the screen', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'manager', '/transfers/new')
  await page.getByPlaceholder('ระบุหมายเหตุ (ถ้ามี)').fill('ส่งของด่วนก่อนเที่ยง')
  await page.waitForTimeout(600) // the draft is written 300 ms after the last keystroke
  await open(page, '/')
  await open(page, '/transfers/new')
  await expect(page.getByText('กู้คืนรายการที่คีย์ค้างไว้ในเครื่องนี้')).toBeVisible()
  await expect(page.getByPlaceholder('ระบุหมายเหตุ (ถ้ามี)')).toHaveValue('ส่งของด่วนก่อนเที่ยง')
})
