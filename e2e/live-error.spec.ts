import { expect, test } from '@playwright/test'
import { deleteDoc, putDoc } from './emulator'
import { seedStage } from './fixture'
import { signedIn } from './app'

/**
 * Plan C1: a listener the database refuses is said on screen with a retry — not shown as
 * an empty ledger. The refusal is real: the account is revoked mid-session (the rules
 * check revokedUsers on every read), then the screen asks for a wider ledger window,
 * which is a new listener the rules now deny. Lifting the revocation and pressing retry
 * brings it back.
 */
test('a refused listener shows a banner with retry, and retry recovers', async ({ browser }) => {
  const stage = await seedStage()
  const page = await signedIn(browser, 'manager')
  await expect(page.getByRole('alert').filter({ hasText: 'ตัวเลขบนจออาจไม่ครบ' })).toHaveCount(0)

  await putDoc(`revokedUsers/${stage.uid.manager}`, { at: Date.now() }, { stampId: false })
  // Reports asks for a month of ledger: the movements listener subscribes again.
  await page.getByRole('link', { name: 'รายงาน' }).first().click()
  const banner = page.getByRole('alert').filter({ hasText: 'ไม่มีสิทธิ์อ่านข้อมูลบางส่วน' })
  await expect(banner).toBeVisible({ timeout: 15_000 })

  await deleteDoc(`revokedUsers/${stage.uid.manager}`)
  await banner.getByRole('button', { name: 'ลองใหม่' }).click()
  await expect(banner).toHaveCount(0, { timeout: 15_000 })
})
