import { expect, test, type Page } from '@playwright/test'
import { seedStage } from './fixture'
import { signedIn } from './app'
import { putDoc } from './emulator'

const SEARCH = 'ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)'

export interface WedgeTimingLog {
  code: string
  terminator: 'Enter' | 'Tab'
  charDelayMs: number
  interKeyDelaysMs: number[]
  totalTypingTimeMs: number
  startedAt: number
  finishedAt: number
}

/**
 * Simulate a hardware USB HID / keyboard-wedge scanner:
 * Types characters with tight gaps (5-15 ms) then emits the configured suffix terminator (Enter or Tab).
 * Records exact performance timestamps to measure inter-key and inter-burst timings.
 */
async function wedgeScan(
  page: Page,
  code: string,
  terminator: 'Enter' | 'Tab' = 'Enter',
  targetCharDelayMs = 10,
): Promise<WedgeTimingLog> {
  const interKeyDelaysMs: number[] = []
  const startedAt = Date.now()
  let lastTime = performance.now()

  for (const ch of code) {
    await page.keyboard.press(ch)
    const now = performance.now()
    interKeyDelaysMs.push(Math.round(now - lastTime))
    lastTime = now
    if (targetCharDelayMs > 0) {
      await page.waitForTimeout(targetCharDelayMs)
    }
  }

  await page.keyboard.press(terminator)
  const termTime = performance.now()
  const finishedAt = Date.now()
  const totalTypingTimeMs = Math.round(termTime - (lastTime - (interKeyDelaysMs[interKeyDelaysMs.length - 1] ?? 0)))

  const log: WedgeTimingLog = {
    code,
    terminator,
    charDelayMs: targetCharDelayMs,
    interKeyDelaysMs,
    totalTypingTimeMs: Math.max(totalTypingTimeMs, finishedAt - startedAt),
    startedAt,
    finishedAt,
  }

  console.log(
    `[WEDGE SIM] Code: "${code}" | Terminator: ${terminator} | Chars: ${code.length} | ` +
      `Total: ${log.totalTypingTimeMs}ms | AvgGap: ${Math.round(
        interKeyDelaysMs.reduce((a, b) => a + b, 0) / (interKeyDelaysMs.length || 1),
      )}ms | MinGap: ${Math.min(...interKeyDelaysMs)}ms | MaxGap: ${Math.max(...interKeyDelaysMs)}ms`,
  )

  return log
}

/**
 * Wait until the client-side catalog has loaded the seeded products before initiating scanner input.
 */
async function catalogHolds(page: Page, query: string, products: RegExp[]): Promise<void> {
  const box = page.getByPlaceholder(SEARCH)
  await box.fill(query)
  for (const name of products) {
    await expect(page.getByRole('button', { name })).toBeVisible()
  }
  await box.fill('')
}

test.describe('PR29 Automated Barcode Scanner QA (8 Scenarios)', () => {
  const openedPages: Page[] = []

  test.afterEach(async () => {
    while (openedPages.length > 0) {
      const p = openedPages.pop()
      await p?.context().close().catch(() => {})
    }
  })

  // CASE 1: Normal barcode selects the right product
  test('Case 1: normal barcode selects the right product via keyboard wedge and legacy confirm', async ({ browser }) => {
    await seedStage()
    const now = Date.now()
    await putDoc('products/qa-norm-1', {
      sku: 'NORM-01-001',
      name: 'QA NORMAL ITEM 1',
      barcode: '8851000777001',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })

    const page = await signedIn(browser, 'staffA', '/issue')
    openedPages.push(page)
    await catalogHolds(page, '8851000777001', [/QA NORMAL ITEM 1/])

    const searchBox = page.getByPlaceholder(SEARCH)
    await searchBox.click()

    const timing = await wedgeScan(page, '8851000777001', 'Enter', 10)
    expect(timing.interKeyDelaysMs.length).toBe(13)

    // Legacy unverified barcode confirmation dialog opens
    const dialog = page.getByRole('dialog', { name: 'ยืนยันสินค้าจากบาร์โค้ด' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('QA NORMAL ITEM 1')
    await expect(dialog).toContainText('8851000777001')

    // Confirm addition
    await dialog.getByRole('button', { name: 'เพิ่มรายการ' }).click()

    // Right product line is added
    const qtyInputs = page.locator('input[type="number"]')
    await expect(qtyInputs).toHaveCount(1)
    await expect(qtyInputs.first()).toHaveValue('1')
    await expect(page.locator('main')).toContainText('QA NORMAL ITEM 1')
  })

  // CASE 2: Leading zeros preserved (e.g. 0012345678901 vs 12345678901 distinct)
  test('Case 2: leading zeros preserved (0012345678901 vs 12345678901 distinct)', async ({ browser }) => {
    await seedStage()
    const now = Date.now()
    // Seed two distinct products whose numeric value would collide if parsed as number
    await putDoc('products/qa-zero-1', {
      sku: 'ZERO-01-001',
      name: 'QA ZERO PREFIX ITEM',
      barcode: '0012345678901',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    await putDoc('products/qa-nozero-2', {
      sku: 'NOZERO-01-002',
      name: 'QA NO ZERO ITEM',
      barcode: '12345678901',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })

    const page = await signedIn(browser, 'staffA', '/issue')
    openedPages.push(page)
    await catalogHolds(page, '12345678901', [/QA ZERO PREFIX ITEM/, /QA NO ZERO ITEM/])

    const searchBox = page.getByPlaceholder(SEARCH)

    // Scan code with leading zeros
    await searchBox.click()
    await wedgeScan(page, '0012345678901', 'Enter', 10)

    const dialog1 = page.getByRole('dialog', { name: 'ยืนยันสินค้าจากบาร์โค้ด' })
    await expect(dialog1).toBeVisible()
    await expect(dialog1).toContainText('QA ZERO PREFIX ITEM')
    await expect(dialog1).not.toContainText('QA NO ZERO ITEM')
    await dialog1.getByRole('button', { name: 'เพิ่มรายการ' }).click()

    // Line 1 is QA ZERO PREFIX ITEM
    await expect(page.locator('main')).toContainText('QA ZERO PREFIX ITEM')

    // Scan code without leading zeros
    await searchBox.click()
    await wedgeScan(page, '12345678901', 'Enter', 10)

    const dialog2 = page.getByRole('dialog', { name: 'ยืนยันสินค้าจากบาร์โค้ด' })
    await expect(dialog2).toBeVisible()
    await expect(dialog2).toContainText('QA NO ZERO ITEM')
    await expect(dialog2).not.toContainText('QA ZERO PREFIX ITEM')
    await dialog2.getByRole('button', { name: 'เพิ่มรายการ' }).click()

    // Both distinct lines are present
    const qtyInputs = page.locator('input[type="number"]')
    await expect(qtyInputs).toHaveCount(2)
    await expect(page.locator('main')).toContainText('QA ZERO PREFIX ITEM')
    await expect(page.locator('main')).toContainText('QA NO ZERO ITEM')
  })

  // CASE 3: Scanner suffix Enter works
  test('Case 3: scanner suffix Enter clears input and triggers resolution', async ({ browser }) => {
    await seedStage()
    const now = Date.now()
    await putDoc('products/qa-ent-1', {
      sku: 'ENT-01-001',
      name: 'QA ENTER SUFFIX ITEM',
      barcode: '8851000777003',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })

    const page = await signedIn(browser, 'staffA', '/issue')
    openedPages.push(page)
    await catalogHolds(page, '8851000777003', [/QA ENTER SUFFIX ITEM/])

    const searchBox = page.getByPlaceholder(SEARCH)
    await searchBox.click()

    await wedgeScan(page, '8851000777003', 'Enter', 10)

    // Search box must be immediately cleared
    await expect(searchBox).toHaveValue('')

    const dialog = page.getByRole('dialog', { name: 'ยืนยันสินค้าจากบาร์โค้ด' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('QA ENTER SUFFIX ITEM')
    await dialog.getByRole('button', { name: 'เพิ่มรายการ' }).click()

    await expect(page.locator('input[type="number"]')).toHaveCount(1)
    await expect(page.locator('main')).toContainText('QA ENTER SUFFIX ITEM')
  })

  // CASE 4: Scanner suffix Tab works or shows documented limitation
  test('Case 4: scanner suffix Tab triggers scan; Shift+Tab does not scan; partial query Tab navigates', async ({
    browser,
  }) => {
    await seedStage()
    const now = Date.now()
    await putDoc('products/qa-tab-1', {
      sku: 'TAB-01-001',
      name: 'QA TAB SUFFIX ITEM',
      barcode: '8851000777004',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })

    const page = await signedIn(browser, 'staffA', '/issue')
    openedPages.push(page)
    await catalogHolds(page, '8851000777004', [/QA TAB SUFFIX ITEM/])

    const searchBox = page.getByPlaceholder(SEARCH)

    // 4b: Shift+Tab must NOT trigger scan (remains accessible for reverse keyboard navigation)
    await searchBox.click()
    await page.keyboard.type('8851000777004')
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('input[type="number"]')).toHaveCount(0)

    // 4c: Documented limitation: partial name with suggestions open leaves Tab to navigation
    await searchBox.fill('')
    await searchBox.click()
    await page.keyboard.type('QA TAB')
    await expect(page.getByRole('button', { name: /QA TAB SUFFIX ITEM/ })).toBeVisible()
    await page.keyboard.press('Tab')
    // No dialog, no scan error toast, text retained
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText(/ไม่พบบาร์โค้ด/)).toHaveCount(0)
    await expect(searchBox).toHaveValue('QA TAB')
    await expect(page.locator('input[type="number"]')).toHaveCount(0)

    // 4a: Bare Tab after exact barcode triggers scan
    await searchBox.fill('')
    await searchBox.click()
    await wedgeScan(page, '8851000777004', 'Tab', 10)

    await expect(searchBox).toHaveValue('')
    const dialog = page.getByRole('dialog', { name: 'ยืนยันสินค้าจากบาร์โค้ด' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('QA TAB SUFFIX ITEM')
    await dialog.getByRole('button', { name: 'เพิ่มรายการ' }).click()

    await expect(page.locator('input[type="number"]')).toHaveCount(1)
    await expect(page.locator('main')).toContainText('QA TAB SUFFIX ITEM')
  })

  // CASE 5: Unknown barcode shows error and selects nothing
  test('Case 5: unknown barcode shows not-found error, leaves lines empty, and clears input', async ({ browser }) => {
    await seedStage()
    const page = await signedIn(browser, 'staffA', '/issue')
    openedPages.push(page)
    await catalogHolds(page, 'flour', [/FLOUR/])

    const searchBox = page.getByPlaceholder(SEARCH)
    await searchBox.click()

    await wedgeScan(page, '9998887776665', 'Enter', 10)

    // Not found toast
    await expect(page.getByText(/ไม่พบบาร์โค้ด 9998887776665 ในระบบ/)).toBeVisible()
    // No line added
    await expect(page.getByText('ยังไม่มีรายการ — ค้นหาด้านบนเพื่อเพิ่มสินค้า')).toBeVisible()
    await expect(page.locator('input[type="number"]')).toHaveCount(0)
    // Box is emptied to avoid corruption on next scan
    await expect(searchBox).toHaveValue('')
  })

  // CASE 6: Duplicate barcode and inactive product rejected (fail-closed)
  test('Case 6: duplicate barcode and inactive/retired product are rejected (fail-closed)', async ({ browser }) => {
    await seedStage()
    const now = Date.now()
    // 6a: Duplicate active barcodes
    await putDoc('products/qa-dup-1', {
      sku: 'DUP-01-001',
      name: 'QA DUP PRODUCT 1',
      barcode: '8851999000111',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    await putDoc('products/qa-dup-2', {
      sku: 'DUP-01-002',
      name: 'QA DUP PRODUCT 2',
      barcode: '8851999000111',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })

    // 6b: Inactive/retired product
    await putDoc('products/qa-inact-1', {
      sku: 'RET-01-001',
      name: 'QA RETIRED PRODUCT',
      barcode: '8851999000222',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: false,
      createdAt: now,
      updatedAt: now,
    })

    const page = await signedIn(browser, 'staffA', '/issue')
    openedPages.push(page)
    await catalogHolds(page, '8851999000111', [/QA DUP PRODUCT 1/, /QA DUP PRODUCT 2/])

    const searchBox = page.getByPlaceholder(SEARCH)

    // Test duplicate scan
    await searchBox.click()
    await wedgeScan(page, '8851999000111', 'Enter', 10)
    await expect(page.getByText(/บาร์โค้ด 8851999000111 ซ้ำกับสินค้า 2 รายการ — โปรดเลือกสินค้าด้วยตนเอง/)).toBeVisible()
    await expect(page.locator('input[type="number"]')).toHaveCount(0)
    await expect(searchBox).toHaveValue('')

    // Test inactive scan
    await searchBox.click()
    await wedgeScan(page, '8851999000222', 'Enter', 10)
    await expect(page.getByText(/สินค้าบาร์โค้ดนี้ถูกปิดใช้งานแล้ว: "QA RETIRED PRODUCT"/)).toBeVisible()
    await expect(page.locator('input[type="number"]')).toHaveCount(0)
    await expect(searchBox).toHaveValue('')
  })

  // CASE 7: Two scans within 400 ms (double-trigger of SAME code & DIFFERENT codes)
  test('Case 7: two scans within 400 ms produce no duplicate lines and no corrupted token', async ({ browser }) => {
    await seedStage()
    const now = Date.now()
    await putDoc('products/qa-burst-1', {
      sku: 'BURST-01-001',
      name: 'QA BURST SAME ITEM',
      barcode: '8851000777007',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    await putDoc('products/qa-burst-2a', {
      sku: 'BURST-02-001',
      name: 'QA BURST DIFF A',
      barcode: '8851000777008',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    await putDoc('products/qa-burst-2b', {
      sku: 'BURST-03-001',
      name: 'QA BURST DIFF B',
      barcode: '8851000777009',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })

    const page = await signedIn(browser, 'staffA', '/issue')
    openedPages.push(page)
    await catalogHolds(page, '8851000777007', [/QA BURST SAME ITEM/])

    const searchBox = page.getByPlaceholder(SEARCH)

    // PART A: Double-trigger of the SAME code within 400 ms
    await searchBox.click()
    const scan1 = await wedgeScan(page, '8851000777007', 'Enter', 8)
    await page.waitForTimeout(60) // 60ms gap between scans
    const scan2 = await wedgeScan(page, '8851000777007', 'Enter', 8)
    const sameCodeInterScanGapMs = scan2.startedAt - scan1.finishedAt

    console.log(
      `[CASE 7A TIMING] Scan1: ${scan1.totalTypingTimeMs}ms, Gap: ${sameCodeInterScanGapMs}ms, Scan2: ${scan2.totalTypingTimeMs}ms (Total: ${scan2.finishedAt - scan1.startedAt}ms)`,
    )
    expect(sameCodeInterScanGapMs).toBeLessThan(400)

    // Verify search input is not corrupted with concatenated text (e.g. 88510007770078851000777007)
    await expect(searchBox).not.toHaveValue('88510007770078851000777007')

    // Exactly one confirmation dialog opens
    const dialogSame = page.getByRole('dialog', { name: 'ยืนยันสินค้าจากบาร์โค้ด' })
    await expect(dialogSame).toBeVisible()
    await expect(dialogSame).toContainText('QA BURST SAME ITEM')
    await dialogSame.getByRole('button', { name: 'เพิ่มรายการ' }).click()

    // Exactly 1 line added with qty 1 (no double line, no autoincrement)
    const qtyInputs = page.locator('input[type="number"]')
    await expect(qtyInputs).toHaveCount(1)
    await expect(qtyInputs.first()).toHaveValue('1')

    // PART B: Two scans of DIFFERENT codes within 400 ms
    await searchBox.click()
    const scanDiffA = await wedgeScan(page, '8851000777008', 'Enter', 8)
    await page.waitForTimeout(50) // 50ms gap
    const scanDiffB = await wedgeScan(page, '8851000777009', 'Enter', 8)
    const diffCodeInterScanGapMs = scanDiffB.startedAt - scanDiffA.finishedAt

    console.log(
      `[CASE 7B TIMING] ScanDiffA: ${scanDiffA.totalTypingTimeMs}ms, Gap: ${diffCodeInterScanGapMs}ms, ScanDiffB: ${scanDiffB.totalTypingTimeMs}ms`,
    )
    expect(diffCodeInterScanGapMs).toBeLessThan(400)

    // Search input must not be concatenated
    await expect(searchBox).not.toHaveValue('88510007770088851000777009')

    // Confirmation shows for Item A
    const dialogDiff = page.getByRole('dialog', { name: 'ยืนยันสินค้าจากบาร์โค้ด' })
    await expect(dialogDiff).toBeVisible()
    await expect(dialogDiff).toContainText('QA BURST DIFF A')
    await expect(dialogDiff).not.toContainText('QA BURST DIFF B')
    await dialogDiff.getByRole('button', { name: 'เพิ่มรายการ' }).click()

    // Total lines now 2 (QA BURST SAME ITEM and QA BURST DIFF A; QA BURST DIFF B was not added)
    await expect(page.locator('input[type="number"]')).toHaveCount(2)
    await expect(page.locator('main')).not.toContainText('QA BURST DIFF B')
  })

  // CASE 8: Brand switch / opening-closing scanner leaves no cross-brand data or stale callback
  test('Case 8: brand switch and opening/closing scanner leaves no cross-brand data or stale callback', async ({
    browser,
  }) => {
    await seedStage()
    const now = Date.now()
    // Product in Pizza Mania
    await putDoc('products/qa-pzm-1', {
      sku: 'PZM-01-001',
      name: 'QA PIZZA ONLY ITEM',
      barcode: '8851000777001',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    // Product in Le Lapin
    await putDoc('lelapin__locations/lwh', { name: 'Le Lapin Warehouse', type: 'warehouse', active: true, createdAt: now })
    await putDoc('lelapin__products/qa-llp-1', {
      sku: 'LLP-01-001',
      name: 'QA LAPIN ONLY ITEM',
      barcode: '8851000777001',
      unit: 'Kilogram',
      unitType: 'KG',
      minStock: 0,
      hasImage: false,
      active: true,
      createdAt: now,
      updatedAt: now,
    })

    const page = await signedIn(browser, 'admin', '/issue')
    openedPages.push(page)
    await catalogHolds(page, '8851000777001', [/QA PIZZA ONLY ITEM/])

    // 8a: Opening and closing scanner modal leaves no stale typed text or lingering session
    const scanBtn = page.getByRole('button', { name: 'สแกนบาร์โค้ด' }).first()
    await scanBtn.click()
    const scanModal = page.getByRole('dialog', { name: 'สแกนบาร์โค้ด' })
    await expect(scanModal).toBeVisible()

    const manualInput = scanModal.getByRole('textbox', { name: 'เลขบาร์โค้ด' })
    await manualInput.fill('8851000777001')
    await expect(manualInput).toHaveValue('8851000777001')

    // Close modal via Cancel button
    await scanModal.getByRole('button', { name: 'ยกเลิก' }).click()
    await expect(scanModal).toHaveCount(0)

    // Reopen modal: typed state must be cleanly cleared
    await scanBtn.click()
    await expect(scanModal).toBeVisible()
    const manualInputReopened = scanModal.getByRole('textbox', { name: 'เลขบาร์โค้ด' })
    await expect(manualInputReopened).toHaveValue('')

    // Close modal
    await scanModal.getByRole('button', { name: 'ยกเลิก' }).click()
    await expect(scanModal).toHaveCount(0)

    // 8b: Brand switch to Le Lapin via in-app brand switcher
    const brandTrigger = page.getByRole('button', { name: /^แบรนด์: / }).locator('visible=true').first()
    await brandTrigger.click()
    await page.getByRole('menuitemradio', { name: /Le Lapin/ }).click()
    await expect(brandTrigger).toHaveAccessibleName(/Le Lapin/)

    // Navigate to /issue in Le Lapin via sidebar navigation
    await page.getByRole('link', { name: 'เบิก/โอนสาขา' }).click()
    await expect(page.locator('main')).toBeVisible()
    await catalogHolds(page, '8851000777001', [/QA LAPIN ONLY ITEM/])

    // Scanning the shared barcode in Le Lapin now resolves LAPIN product, NOT Pizza product
    const llpSearchBox = page.getByPlaceholder(SEARCH)
    await llpSearchBox.click()
    await wedgeScan(page, '8851000777001', 'Enter', 10)

    const lapinDialog = page.getByRole('dialog', { name: 'ยืนยันสินค้าจากบาร์โค้ด' })
    await expect(lapinDialog).toBeVisible()
    await expect(lapinDialog).toContainText('QA LAPIN ONLY ITEM')
    await expect(lapinDialog).not.toContainText('QA PIZZA ONLY ITEM')
    await lapinDialog.getByRole('button', { name: 'เพิ่มรายการ' }).click()

    await expect(page.locator('main')).toContainText('QA LAPIN ONLY ITEM')
    await expect(page.locator('main')).not.toContainText('QA PIZZA ONLY ITEM')
  })
})
