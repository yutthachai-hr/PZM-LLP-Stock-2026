import { expect, test } from '@playwright/test'
import { getDoc, putDoc } from './emulator'
import { seedStage } from './fixture'
import { open, signedIn } from './app'

/**
 * Plan C5. A critical notification stays on screen as a red bar until the person
 * acknowledges it (owner, 6 Oct 2026: popups still go after four seconds). On a phone an
 * error toast sits above the tab bar and stays until closed.
 */
test('a critical notification stays as a red bar until acknowledged', async ({ browser }) => {
  const stage = await seedStage()
  const now = Date.now()
  await putDoc('notifications/taskEscalated__e2e', {
    kind: 'taskEscalated', category: 'task', priority: 'critical', to: { roles: ['manager', 'admin'] },
    params: { title: 'นับสต๊อกห้องเย็น', time: '09:00', location: 'Main Warehouse' }, link: '/calendar',
    active: true, readBy: {}, source: 'client', createdBy: stage.uid.manager, createdAt: now, updatedAt: now, expiresAt: now + 30 * 86_400_000,
  })
  const page = await signedIn(browser, 'manager')
  const bar = page.getByRole('alert').filter({ hasText: 'วิกฤต 1 รายการ' })
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('นับสต๊อกห้องเย็น')
  // Still there well after any popup has gone.
  await page.waitForTimeout(5000)
  await expect(bar).toBeVisible()

  await bar.getByRole('button', { name: 'รับทราบ' }).click()
  await expect(bar).toHaveCount(0)
  await expect.poll(async () => Object.keys(((await getDoc('notifications/taskEscalated__e2e'))?.readBy ?? {}) as object)).toEqual([stage.uid.manager])
})

test('on a 375px phone an error toast sits above the tab bar and stays until closed', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'manager')
  await page.setViewportSize({ width: 375, height: 740 })
  await open(page, '/transfers/new')
  // One location only, so there is no destination: saving says so in an error toast.
  await page.getByRole('button', { name: 'บันทึกร่าง' }).click()
  const toast = page.getByRole('alert').filter({ hasText: 'เลือกต้นทางและปลายทาง' })
  await expect(toast).toBeVisible()
  const tabBar = await page.getByRole('navigation', { name: 'เมนูหลัก' }).boundingBox()
  const box = await toast.boundingBox()
  expect(box && tabBar && box.y + box.height <= tabBar.y).toBe(true)
  await page.screenshot({ path: 'test-results/c5-toast-375.png' })
  await page.waitForTimeout(4500)
  await expect(toast).toBeVisible()
  await toast.getByRole('button', { name: 'ปิด' }).click()
  await expect(toast).toHaveCount(0)
})
