import { expect, test } from '@playwright/test'
import { listDocs, signIn, writeAs } from './emulator'
import { PASSWORD, PEOPLE, seedStage } from './fixture'
import { signedIn } from './app'

/**
 * B2: an admin's change lands in the audit log in the same go, the history screen shows
 * it a page at a time, and the entry cannot be changed afterwards — not even by an admin
 * going around the app with their own token.
 */
test('audit log: a location added by an admin is recorded, shown, and immutable', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'admin', '/settings/locations')
  await page.getByRole('button', { name: 'เพิ่มคลัง' }).click()
  await page.getByRole('dialog').locator('input').first().fill('AUDIT BRANCH')
  await page.getByRole('dialog').getByRole('button', { name: 'บันทึก' }).click()
  await expect(page.getByText('บันทึกแล้ว')).toBeVisible()

  await expect.poll(async () => (await listDocs('auditLog')).map((d) => d.action)).toContain('location.create')
  const [entry] = (await listDocs('auditLog')).filter((d) => d.action === 'location.create')
  expect(entry).toMatchObject({ actorRole: 'admin', actorName: 'E2E Admin', entityType: 'location', before: null })

  await page.goto('/settings/audit')
  await page.getByRole('button', { name: 'ดูประวัติการแก้ไข' }).click()
  await expect(page.getByTestId('audit-list').getByText('location.create')).toBeVisible()
  await expect(page.getByTestId('audit-list').getByText(/AUDIT BRANCH/)).toBeVisible()

  const { token } = await signIn(PEOPLE.admin.email, PASSWORD)
  expect(await writeAs(token, `auditLog/${entry.id}`, { reason: 'rewrite' }, { fields: ['reason'] })).toBe(403)
})
