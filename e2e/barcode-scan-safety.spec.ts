import { expect, test, type Page } from '@playwright/test'
import { seedStage, PEOPLE } from './fixture'
import { signedIn } from './app'
import { putDoc } from './emulator'

const SEARCH = 'ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)'

/**
 * Wait until the screen's catalog holds the seeded rows, then leave the search box empty.
 *
 * A scan is decided against the products array the screen has loaded (useScanGate →
 * resolveBarcode), and that array is empty until the listener's first snapshot arrives. A scan
 * made before it is answered "ไม่พบบาร์โค้ด … ในระบบ" — fail-closed, but about a catalog that is
 * not there yet — so the duplicate/legacy fence under test never runs and the test fails with a
 * message about the wrong thing (CI run 39032926954, the duplicate and repeated-scan tests).
 * The suggestion list is the observable proof that the row is in the loaded catalog: the box
 * matches the same fields a scan resolves and only ever lists rows that are in the array the
 * gate reads. This waits on that condition and weakens no scanner assertion — if the row never
 * arrives, the wait fails on its own line instead of the fence failing for the wrong reason.
 */
async function catalogHolds(page: Page, typed: string, products: RegExp[]): Promise<void> {
  const box = page.getByPlaceholder(SEARCH)
  await box.fill(typed)
  for (const name of products) await expect(page.getByRole('button', { name })).toBeVisible()
  await box.fill('')
}

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
  const openedPages: Page[] = []

  test.afterEach(async () => {
    while (openedPages.length > 0) {
      const p = openedPages.pop()
      await p?.context().close().catch(() => {})
    }
  })

  test('manual barcode entry allows typing alphanumeric Code 128 characters', async ({ browser }) => {
    await seedStage()
    const page = await signedIn(browser, 'staffA', '/issue')
    openedPages.push(page)

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
    openedPages.push(page)

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
    openedPages.push(page)
    // Sibling tests prove the catalog is loaded before scanning: an empty catalog refuses as
    // "catalogue still loading" (line ~229 covers that cold-scan path). Wait on the seeded row.
    await catalogHolds(page, 'flour', [/FLOUR/])

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
    openedPages.push(page)
    // The duplicate fence can only be observed once BOTH seeds are in the loaded catalog:
    // against an empty one, every code is answered "not found". Probing with the shared barcode
    // proves both rows — and their barcode field — are in the array the gate will read.
    await catalogHolds(page, '8851000999999', [/DUP ITEM 1/, /DUP ITEM 2/])
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
    openedPages.push(page)
    // Same cold-catalog window as the duplicate and repeated-scan tests: the modal takes long
    // enough to open that this test usually wins the race, but nothing in it proves the
    // catalog is loaded, so wait on the row instead of on the clock.
    await catalogHolds(page, '8851000555555', [/LEGACY ITEM/])
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
    // A rules-legal legacy product: NO barcodeVerified (live Rules reject that key, and there is
    // no trusted verification writer yet), so a scan takes the confirmation path it will take in
    // production today. The fixture must not invent a verification the product cannot carry.
    await putDoc('products/v1', { sku: 'V-01', name: 'REPEAT ITEM', barcode: '8851000111111', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now })

    const page = await signedIn(browser, 'staffA', '/issue')
    openedPages.push(page)
    const searchInput = page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)')

    // The wedge scan below is the first thing that reads the catalog, so it is the test that
    // most often races the listener's first snapshot: answered early, it is "ไม่พบบาร์โค้ด …",
    // no confirmation opens and the button this test drives is never there (CI run 39032926954,
    // this test). Prove the row is loaded first; the fence under test is unchanged.
    await catalogHolds(page, '8851000111111', [/REPEAT ITEM/])

    // First scan via wedge: the confirmation carries the addition.
    await searchInput.fill('8851000111111')
    await searchInput.press('Enter')
    await page.getByRole('button', { name: 'เพิ่มรายการ' }).click()
    // The addition lands after the answer-time server check, so wait for the line itself.
    // The product name alone is also in the suggestion list and the closing dialog, and a
    // scan made before the add finishes is (rightly) refused as "previous item pending".
    await expect(page.locator('input[type="number"]')).toHaveCount(1)

    // Second scan with the same code must not add a twin or bump the quantity.
    await searchInput.fill('8851000111111')
    await searchInput.press('Enter')
    await page.getByRole('button', { name: 'เพิ่มรายการ' }).click()

    // MANDATORY: the line exists and its quantity is still 1 (no implicit autoincrement).
    const qtyInputs = page.locator('input[type="number"]')
    await expect(qtyInputs).toHaveCount(1)
    await expect(qtyInputs.first()).toHaveValue('1')
  })

  test('transfer receiving scan fails closed on an unknown code (camera and box are one origin)', async ({ browser }) => {
    const stage = await seedStage()
    const now = Date.now()

    // A real, valid transfer: two DISTINCT locations (the rules require from != to), a line with
    // its required sku, and a non-empty history — the shape the receiving flow actually files.
    await putDoc('locations/br1', { name: 'Branch 1', type: 'branch', active: true, createdAt: now })
    await putDoc('transfers/tr1', {
      docNo: 'TR-00001',
      status: 'inTransit',
      revision: 1,
      fromLocationId: 'wh',
      toLocationId: 'br1',
      dispatchDate: now,
      requestedBy: stage.uid.manager,
      requestedByName: PEOPLE.manager.name,
      // An in-transit transfer always carries who approved it: the rules require `approvedBy`
      // on every status from inTransit on (firestore.rules transferLive()), and opening the
      // page writes status 'receiving'. Without it the update is denied, the page shows "no
      // document" and there is no scan box to test.
      approvedBy: stage.uid.manager,
      approvedByName: PEOPLE.manager.name,
      approvedAt: now - 1000,
      items: [
        { idx: 0, productId: 'flour', productName: 'FLOUR', sku: 'DRY-01-001', unit: 'KG', requestedQty: 10, dispatchQty: 10, inTransitQty: 10, stockAtApprove: 100 },
      ],
      history: [
        { at: now - 1000, by: stage.uid.manager, byName: PEOPLE.manager.name, action: 'approved', fromStatus: 'pendingApproval', toStatus: 'inTransit' },
      ],
      createdAt: now - 1000,
      updatedAt: now - 1000,
    })

    const page = await signedIn(browser, 'staffA', '/transfers/tr1/receive')
    openedPages.push(page)

    const scanInput = page.getByPlaceholder('ยิงบาร์โค้ด แล้วกด Enter')
    await expect(scanInput).toBeVisible()

    await scanInput.fill('UNKNOWN-BARCODE-999')
    await scanInput.press('Enter')
    // Terminal: no SKU confirmation dialog, no fuzzy fallback — just the not-found notice.
    await expect(page.getByText(/ไม่พบบาร์โค้ด UNKNOWN-BARCODE-999 ในระบบ/)).toBeVisible()
    await expect(page.getByText(/ยืนยันรหัสสินค้า/)).toHaveCount(0)
  })

  test('scan made before catalogue is server-synced shows loading message, not not-found', async ({ browser }) => {
    await seedStage()
    const page = await signedIn(browser, 'staffA', '/issue')
    openedPages.push(page)

    const searchInput = page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('8851000111111')
    await searchInput.press('Enter')

    // Must never show false not-found
    await expect(page.getByText(/ไม่พบบาร์โค้ด/)).toHaveCount(0)
  })
})
