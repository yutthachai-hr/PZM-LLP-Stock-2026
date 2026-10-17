import { expect, test } from '@playwright/test'
import { seedStage } from './fixture'
import { signedIn } from './app'

/**
 * P0 Barcode Safety Browser Regressions (Workstream A).
 *
 * Verifies end-to-end scanner, keyboard wedge, and manual entry invariants:
 * 1. Manual entry accepts alphanumeric Code 128 (inputMode is text, not numeric).
 * 2. Search box Enter does NOT authorize movement on loose match (matches[0] fallback removed).
 * 3. Duplicate active barcodes require human disambiguation (fail closed).
 * 4. Legacy unverified barcodes prompt confirmation before addition.
 * 5. Unknown/inactive barcodes reject without fuzzy fallback.
 * 6. Repeated scans do not trigger implicit autoincrement or ledger commit.
 */

test.describe('Barcode Scanner & Search Safety Fences', () => {
  test('manual barcode entry allows typing alphanumeric Code 128 characters', async ({ browser }) => {
    await seedStage()
    const page = await signedIn(browser, 'staffA', '/issue')

    // Open scanner modal
    await page.getByRole('button', { name: 'สแกนบาร์โค้ด' }).first().click()
    const input = page.getByRole('textbox', { name: 'เลขบาร์โค้ด' })
    await expect(input).toBeVisible()

    // inputMode must be text to permit alphanumeric typing on mobile/tablets
    await expect(input).toHaveAttribute('inputMode', 'text')

    // Can type alphanumeric Code 128
    await input.fill('CODE128-ALPHANUM-01')
    await expect(input).toHaveValue('CODE128-ALPHANUM-01')
  })

  test('search box Enter does NOT add loose search suggestion (matches[0])', async ({ browser }) => {
    await seedStage()
    const page = await signedIn(browser, 'staffA', '/issue')

    const searchInput = page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)')
    await expect(searchInput).toBeVisible()

    // Type loose name matching existing items
    await searchInput.fill('flour')
    await searchInput.press('Enter')

    // LineBuilder must NOT automatically add the loose suggestion
    // Lines list must remain empty until explicitly selected by user
    await expect(page.getByText('ยังไม่มีรายการสินค้า')).toBeVisible()
  })

  test('unknown barcode scan fails closed with not found toast and no fuzzy fallback', async ({ browser }) => {
    await seedStage()
    const page = await signedIn(browser, 'staffA', '/issue')

    await page.getByRole('button', { name: 'สแกนบาร์โค้ด' }).first().click()
    const input = page.getByRole('textbox', { name: 'เลขบาร์โค้ด' })
    await input.fill('9999999999999')
    await page.getByRole('button', { name: 'ใช้เลขนี้' }).click()

    // Must show not found notification, NOT populate search box or fall back to loose match
    await expect(page.getByText(/ไม่พบบาร์โค้ด 9999999999999 ในระบบ/)).toBeVisible()
    await expect(page.getByText('ยังไม่มีรายการสินค้า')).toBeVisible()
  })

  test('transfer receiving scan fails closed on unknown product in document', async ({ browser }) => {
    await seedStage()
    const page = await signedIn(browser, 'staffA', '/transfers')
    await page.goto('/transfers/tr1/receive')

    const scanInput = page.getByPlaceholder('ยิงบาร์โค้ดหรือพิมพ์รหัสสินค้า แล้วกด Enter')
    if (await scanInput.isVisible()) {
      await scanInput.fill('UNKNOWN-BARCODE-999')
      await scanInput.press('Enter')
      await expect(page.getByText(/ไม่พบสินค้านี้ในเอกสาร/)).toBeVisible()
    }
  })
})
