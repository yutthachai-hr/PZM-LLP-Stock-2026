import { expect, test, type Page } from '@playwright/test'
import { seedStage } from './fixture'
import { open, signedIn } from './app'

/**
 * P2 (8 Oct 2026): stacked dialogs. A confirmation raised from inside a dialog (here: delete,
 * from the product editor) is a second dialog on top of the first. Escape, Tab and closing
 * must act on the TOP one only: the editor and its half-done form must survive the question.
 */
async function editorWithConfirm(page: Page, size?: { width: number; height: number }) {
  await open(page, '/products')
  const row = page.getByRole('row').filter({ hasText: 'FLOUR' }).first()
  // The row menu closes on any scroll (components/frame/RowMenu.tsx), and the list may still be
  // settling right after the page opens: open it again if it closed, as a person would.
  await expect(async () => {
    const edit = page.getByRole('menuitem', { name: 'แก้ไข' })
    if (!(await edit.isVisible())) await row.getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }).click()
    await edit.click({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  const editor = page.getByRole('dialog', { name: 'แก้ไขสินค้า' })
  await expect(editor).toBeVisible()
  // The list's row menu is a desktop control; the dialogs are what is under test, so a phone
  // is emulated once the editor is open (the editor is full-screen there, the question a sheet).
  if (size) await page.setViewportSize(size)
  const opener = editor.getByRole('button', { name: 'ลบสินค้า' })
  await opener.click()
  const confirm = page.getByRole('dialog', { name: 'ลบสินค้า' })
  await expect(confirm).toBeVisible()
  return { editor, confirm, opener }
}

for (const view of [{ name: 'desktop', size: { width: 1440, height: 900 } }, { name: 'phone', size: { width: 375, height: 812 } }]) {
  test(`${view.name}: Escape closes only the confirmation; the editor stays, and focus goes back to the button that opened it`, async ({ browser }) => {
    await seedStage()
    const page = await signedIn(browser, 'admin')
    const { editor, confirm, opener } = await editorWithConfirm(page, view.size)
    await page.keyboard.press('Escape')
    await expect(confirm).toBeHidden()
    await expect(editor).toBeVisible()
    await expect(opener).toBeFocused()
    // A second Escape now belongs to the editor.
    await page.keyboard.press('Escape')
    await expect(editor).toBeHidden()
  })
}

test('Tab stays inside the confirmation while it is on top, both directions', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'admin')
  const { confirm } = await editorWithConfirm(page)
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key)
    expect(await confirm.evaluate((el) => el.contains(document.activeElement)), key).toBe(true)
  }
})

// (The RC also runs an axe scan here; the early-release line adds no new dependency for it.)
test('cancelling a destructive confirmation deletes nothing and leaves the editor open', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'admin')
  const { editor, confirm } = await editorWithConfirm(page)
  await confirm.getByRole('button', { name: 'ยกเลิก' }).click()
  await expect(confirm).toBeHidden()
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: 'ปิด' }).first().click()
  await expect(page.getByRole('row').filter({ hasText: 'FLOUR' }).first()).toBeVisible()
})
