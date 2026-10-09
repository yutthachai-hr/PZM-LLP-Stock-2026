import { expect, test } from '@playwright/test'
import { putDoc } from './emulator'
import { seedStage } from './fixture'
import { signedIn } from './app'
import { countDayOf } from '../src/lib/monthlyCount'

const MONTH = '2026-09'

/** Plan E2: on a blind sheet the counter sees only what they count; a manager still reviews. */
test('a blind sheet hides the books from staff and shows them to a manager', async ({ browser }) => {
  const stage = await seedStage()
  const now = Date.now()
  await putDoc(`monthlyCounts/wh__${MONTH}`, {
    locationId: 'wh', month: MONTH, countDate: countDayOf(MONTH), status: 'counting', blind: true,
    lines: { flour: { qty: 7, by: stage.uid.staffA, byName: 'E2E Staff A', at: now } },
    createdBy: stage.uid.manager, createdByName: 'E2E Manager', createdAt: now, updatedAt: now,
  })
  const staff = await signedIn(browser, 'staffA', `/counts/wh__${MONTH}`)
  await expect(staff.getByText('นับแบบไม่เห็นยอด —')).toBeVisible()
  await expect(staff.getByRole('columnheader', { name: 'นับได้' })).toBeVisible()
  await expect(staff.getByRole('columnheader', { name: 'ระบบ ณ สิ้นเดือน' })).toHaveCount(0)
  await expect(staff.getByRole('columnheader', { name: 'ผลต่าง' })).toHaveCount(0)
  await expect(staff.getByRole('button', { name: /มีผลต่าง/ })).toHaveCount(0)

  const manager = await signedIn(browser, 'manager', `/counts/wh__${MONTH}`)
  await expect(manager.getByRole('columnheader', { name: 'ระบบ ณ สิ้นเดือน' })).toBeVisible()
  await expect(manager.getByRole('columnheader', { name: 'ผลต่าง' })).toBeVisible()
})
