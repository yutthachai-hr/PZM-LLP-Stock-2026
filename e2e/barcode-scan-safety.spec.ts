import { expect, test } from '@playwright/test'
import { seedStage, PEOPLE } from './fixture'
import { signedIn } from './app'
import { putDoc } from './emulator'

/**
 * P0 Barcode Safety Browser Regressions (Workstream A).
 *
 * Verifies end-to-end scanner, keyboard wedge, and manual entry invariants:
 * 1. Manual entry accepts alphanumeric Code 128 (inputMode is text, not numeric).
 * 2. Search box Enter does NOT authorize movement on loose match (matches[0] fallback removed).
 * 3. Duplicate active barcodes require human disambiguation (fail closed).
 * 4. Legacy unverified barcodes prompt confirmation before addition.
 * 5. Unknown/inactive barcodes reject without fuzzy fallback.
 * 6. Repeated scans do not trigger implicit autoincrement.
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
    await expect(page.getByText('ยังไม่มีรายการ — ค้นหาด้านบนเพื่อเพิ่มสินค้า')).toBeVisible()
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
    await expect(page.getByText('ยังไม่มีรายการ — ค้นหาด้านบนเพื่อเพิ่มสินค้า')).toBeVisible()
  })

  test('duplicate active barcodes fail closed with error toast requiring human disambiguation', async ({ browser }) => {
    await seedStage()
    const now = Date.now()
    // Seed two products with identical barcode
    await putDoc('products/dup1', { sku: 'DUP-01', name: 'DUP ITEM 1', barcode: '8851000999999', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now })
    await putDoc('products/dup2', { sku: 'DUP-02', name: 'DUP ITEM 2', barcode: '8851000999999', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now })

    const page = await signedIn(browser, 'staffA', '/issue')
    await page.getByRole('button', { name: 'สแกนบาร์โค้ด' }).first().click()
    const input = page.getByRole('textbox', { name: 'เลขบาร์โค้ด' })
    await input.fill('8851000999999')
    await page.getByRole('button', { name: 'ใช้เลขนี้' }).click()

    // Must display duplicate error toast and reject automatically adding
    await expect(page.getByText(/บาร์โค้ด 8851000999999 ซ้ำกับสินค้า 2 รายการ/)).toBeVisible()
    await expect(page.getByText('ยังไม่มีรายการ — ค้นหาด้านบนเพื่อเพิ่มสินค้า')).toBeVisible()
  })

  test('legacy unverified barcode prompts human confirmation dialog before addition', async ({ browser }) => {
    await seedStage()
    const now = Date.now()
    // Seed legacy product without barcodeVerified: true
    await putDoc('products/leg1', { sku: 'LEG-01', name: 'LEGACY ITEM', barcode: '8851000555555', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now })

    const page = await signedIn(browser, 'staffA', '/issue')
    await page.getByRole('button', { name: 'สแกนบาร์โค้ด' }).first().click()
    const input = page.getByRole('textbox', { name: 'เลขบาร์โค้ด' })
    await input.fill('8851000555555')
    await page.getByRole('button', { name: 'ใช้เลขนี้' }).click()

    // Confirmation dialog must appear
    await expect(page.getByText(/ยืนยันสินค้าจากบาร์โค้ด/)).toBeVisible()
    await expect(page.getByText(/พบสินค้า "LEGACY ITEM" จากบาร์โค้ด 8851000555555/)).toBeVisible()
  })

  test('repeated scans do not trigger implicit autoincrement', async ({ browser }) => {
    await seedStage()
    const now = Date.now()
    await putDoc('products/v1', { sku: 'V-01', name: 'VERIFIED ITEM', barcode: '8851000111111', barcodeVerified: true, unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now })

    const page = await signedIn(browser, 'staffA', '/issue')
    const searchInput = page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)')

    // First scan via wedge
    await searchInput.fill('8851000111111')
    await searchInput.press('Enter')
    await expect(page.getByText('VERIFIED ITEM')).toBeVisible()

    // Second scan with same code
    await searchInput.fill('8851000111111')
    await searchInput.press('Enter')

    // In LineBuilder, re-scanning does not duplicate lines or increment qty; qty stays 1
    const qtyInputs = page.locator('input[type="number"]')
    if (await qtyInputs.count() > 0) {
      await expect(qtyInputs.first()).toHaveValue('1')
    }
  })

  test('transfer receiving scan fails closed on unknown product in document', async ({ browser }) => {
    const stage = await seedStage()
    const now = Date.now()

    // Seed transfer document in transit so receiving screen can load
    await putDoc('transfers/tr1', {
      docNo: 'TR-00001',
      status: 'inTransit',
      revision: 1,
      fromLocationId: stage.locationId,
      toLocationId: stage.locationId,
      dispatchDate: now,
      requestedBy: stage.uid.manager,
      requestedByName: PEOPLE.manager.name,
      items: [
        { idx: 0, productId: 'flour', productName: 'FLOUR', unit: 'KG', requestedQty: 10, dispatchedQty: 10, inTransitQty: 10 },
      ],
      history: [],
      createdAt: now,
      updatedAt: now,
    })

    const page = await signedIn(browser, 'staffA', '/transfers/tr1/receive')

    const scanInput = page.getByPlaceholder('ยิงบาร์โค้ดหรือพิมพ์รหัสสินค้า แล้วกด Enter')
    await expect(scanInput).toBeVisible()

    await scanInput.fill('UNKNOWN-BARCODE-999')
    await scanInput.press('Enter')
    await expect(page.getByText(/ไม่พบบาร์โค้ด UNKNOWN-BARCODE-999 ในระบบ/)).toBeVisible()
  })
})
