import { expect, test, type Page } from '@playwright/test'
import { seedStage } from './fixture'
import { open, signedIn } from './app'

/**
 * Scanner/keyboard contract in a CI-run spec (*.demo.ts files never run in CI). Ported from
 * e2e/scanner-sim.r19.demo.ts and scanner-keyboard.demo.ts, plus R29: a Tab-terminated scanner
 * burst must never walk focus onto a confirmation's answer and let the next Enter press it.
 */

const ADJUST_SEARCH = 'ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า)'

/** A wedge scanner: characters at machine speed, then its terminator. */
async function burst(page: Page, code: string, terminator: 'Enter' | 'Tab') {
  await page.keyboard.type(code, { delay: 5 })
  await page.keyboard.press(terminator)
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

test('Adjust: a person typing a partial name then Tab keeps the text and adds nothing', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'admin', '/adjust')
  const box = page.getByPlaceholder(ADJUST_SEARCH)
  await box.fill('FLOU')
  await expect(page.getByRole('button', { name: /FLOUR/ })).toBeVisible() // catalogue loaded
  await box.fill('')
  await box.click()
  await page.keyboard.type('FLOU', { delay: 80 })
  await page.keyboard.press('Tab')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText(/ไม่พบบาร์โค้ด/)).toHaveCount(0)
  await expect(box).toHaveValue('FLOU')
  await expect(box).not.toBeFocused()
  await expect(page.locator('main input[type="number"]')).toHaveCount(0)
})

/** The product editor's delete question: danger, no typed phrase. */
async function deleteQuestion(page: Page) {
  await open(page, '/products')
  const row = page.getByRole('row').filter({ hasText: 'FLOUR' }).first()
  await expect(async () => {
    const edit = page.getByRole('menuitem', { name: 'แก้ไข' })
    if (!(await edit.isVisible())) await row.getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }).click()
    await edit.click({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  const editor = page.getByRole('dialog', { name: 'แก้ไขสินค้า' })
  await editor.getByRole('button', { name: 'ลบสินค้า' }).click()
  const question = page.getByRole('dialog', { name: 'ลบสินค้า' })
  await expect(question).toBeVisible()
  return { editor, question }
}

test('a Tab-terminated scanner burst cannot answer a danger confirmation', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'admin')
  const { editor, question } = await deleteQuestion(page)

  // Two codes, each with its Tab suffix, then an Enter (the next scan's suffix, or a person).
  await burst(page, '8851111222222', 'Tab')
  await burst(page, '8853333444444', 'Tab')
  await page.keyboard.press('Enter')

  await expect(question).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'FLOUR' }).first()).toBeAttached()
  // Still a dialog a person can answer on purpose: Escape closes only the question.
  await page.keyboard.press('Escape')
  await expect(question).toHaveCount(0)
  await expect(editor).toBeVisible()
})

test('a person can still reach and press the answer with the keyboard', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'admin')
  const { question } = await deleteQuestion(page)
  await page.waitForTimeout(600) // a person, not a burst
  const answer = question.getByRole('button', { name: /^ลบ/ })
  for (let i = 0; i < 4 && !(await answer.evaluate((b) => b === document.activeElement)); i++) {
    await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
  }
  await expect(answer).toBeFocused()
})
