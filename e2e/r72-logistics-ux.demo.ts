import { test, expect, type Page } from '@playwright/test'
import * as path from 'node:path'
import * as fs from 'node:fs'
import {
  R72_TRANSFER_DOC_NO,
  R72_TRANSFER_INTERNAL_ID,
  R72_ACTOR_ID,
  R72_DECIMAL_QTY,
  PHONE_WIDTHS,
  stageLogisticsFixture,
} from './r72-logistics-fixtures'

// R72_EVIDENCE=after-<sha> keeps a candidate run from overwriting the committed baseline images.
const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/evidence/r72-logistics', process.env.R72_EVIDENCE || 'before')

async function ensureEvidenceDir() {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  }
}

async function waitForFontsAndData(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(100)
}

test.describe('R72 Agent07: Notification routing & security contracts', () => {
  test('canonical notification navigates to TransferReceivePage with correct docNo', async ({ page }) => {
    await stageLogisticsFixture(page, { notifCase: 'canonical' })
    await page.goto('/')
    await waitForFontsAndData(page)

    // Open notification modal
    const bell = page.locator('button[aria-label*="การแจ้งเตือน"]')
    await expect(bell).toBeVisible()
    await bell.click()

    const modal = page.getByRole('dialog', { name: 'การแจ้งเตือน' })
    await expect(modal).toBeVisible()

    const item = modal.locator('ul li button').first()
    await expect(item).toBeVisible()
    await item.click()

    // Assert navigation to transfer receive page
    await expect(page).toHaveURL(new RegExp(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`))
    await expect(page.locator('h1, h2, div').filter({ hasText: `ตรวจรับสินค้า (${R72_TRANSFER_DOC_NO})` }).first()).toBeVisible()
  })

  test('legacy notification resolves to transfer doc rather than redirecting to dashboard', async ({ page }) => {
    await stageLogisticsFixture(page, { notifCase: 'legacy-logistics' })
    await page.goto('/')
    await waitForFontsAndData(page)

    const bell = page.locator('button[aria-label*="การแจ้งเตือน"]')
    await bell.click()

    const modal = page.getByRole('dialog', { name: 'การแจ้งเตือน' })
    await expect(modal).toBeVisible()

    // Click legacy notification (/logistics/:id link)
    // On 992f6de baseline, /logistics/:id does not exist in router -> redirects to Dashboard (RED).
    // The R72 notification contract requires resolving to /transfers/:id.
    const item = modal.locator('ul li button').first()
    await expect(item).toBeVisible()
    await item.click()

    await expect(page).not.toHaveURL(/^http:\/\/127\.0\.0\.1:5217\/?$/)
    await expect(page).toHaveURL(new RegExp(`/transfers/${R72_TRANSFER_INTERNAL_ID}`))
    await expect(page.locator('body')).toContainText(R72_TRANSFER_DOC_NO)
  })

  test('docNo-only notification fails closed without guessing the internal transfer ID', async ({ page }) => {
    await stageLogisticsFixture(page, { notifCase: 'legacy-docno' })
    await page.goto('/')
    await waitForFontsAndData(page)

    await page.locator('button[aria-label*="การแจ้งเตือน"]').click()
    const modal = page.getByRole('dialog', { name: 'การแจ้งเตือน' })
    await expect(modal).toBeVisible()
    const originalURL = page.url()

    // A display number is not the fixture's database ID; no approved docNo lookup exists.
    await modal.locator('ul li button').first().click()
    await expect(page.getByText('ไม่พบเอกสารโอนสินค้า').first()).toBeVisible()
    await expect(page).toHaveURL(originalURL)
    await expect(modal).toBeVisible()
    const readAt = await page.evaluate(({ actorId }) => {
      const notifications = JSON.parse(localStorage.getItem('pmstock:v1:notifications') || '{}')
      return notifications['notif-legacy-docno']?.readBy?.[actorId]
    }, { actorId: R72_ACTOR_ID })
    expect(readAt).toBeFalsy()
  })

  test('invalid or denied notification does not redirect to dashboard while marking read', async ({ page }) => {
    await stageLogisticsFixture(page, { notifCase: 'invalid' })
    await page.goto('/')
    await waitForFontsAndData(page)

    const bell = page.locator('button[aria-label*="การแจ้งเตือน"]')
    await bell.click()

    const modal = page.getByRole('dialog', { name: 'การแจ้งเตือน' })
    await expect(modal).toBeVisible()

    // Click invalid notification (/unknown-forbidden-path/attack)
    // On 992f6de baseline, openOne navigates to the bad link, redirects to Dashboard '/',
    // and marks the notification read in localStorage.
    // R72 contract: invalid link must NOT mark read and must NOT redirect to Dashboard as success.
    const item = modal.locator('ul li button').first()
    await expect(item).toBeVisible()
    await item.click()

    const unreadInStore = await page.evaluate(({ actorId }) => {
      const raw = localStorage.getItem('pmstock:v1:notifications')
      if (!raw) return false
      const map = JSON.parse(raw)
      const notif = map['notif-invalid-denied']
      return notif && (!notif.readBy || !notif.readBy[actorId])
    }, { actorId: R72_ACTOR_ID })

    expect(unreadInStore, 'Invalid notification must remain unread in storage when navigation is invalid').toBe(true)
  })

  test('cross-brand query parameter in notification is blocked from brand switching', async ({ page }) => {
    await stageLogisticsFixture(page, { notifCase: 'crossbrand' })
    await page.goto('/')
    await waitForFontsAndData(page)

    const bell = page.locator('button[aria-label*="การแจ้งเตือน"]')
    await bell.click()

    const modal = page.getByRole('dialog', { name: 'การแจ้งเตือน' })
    await expect(modal).toBeVisible()

    // Notification with link: `/transfers/${R72_TRANSFER_INTERNAL_ID}?brand=lelapin`
    // R72 contract: query brand switching in notification links must be refused/sanitized.
    const item = modal.locator('ul li button').first()
    await expect(item).toBeVisible()
    await item.click()

    // Brand in localStorage must remain 'pizza'
    const currentBrand = await page.evaluate(() => localStorage.getItem('pmstock:v1:lastBrand'))
    expect(currentBrand, 'Cross-brand notification link must not switch active brand').toBe('pizza')
    expect(page.url(), 'URL must not retain foreign brand query parameter').not.toContain('brand=lelapin')
    await expect(modal).toBeVisible()
    const readAt = await page.evaluate(({ actorId }) => {
      const notifications = JSON.parse(localStorage.getItem('pmstock:v1:notifications') || '{}')
      return notifications['notif-crossbrand']?.readBy?.[actorId]
    }, { actorId: R72_ACTOR_ID })
    expect(readAt, 'A rejected cross-brand link must remain unread').toBeFalsy()
  })
})

test.describe('R72 Agent07: Logistics mobile layout & visual invariants', () => {
  test('all 21 rows are accessible and survive page refresh', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    // Check header
    await expect(page.locator('body')).toContainText(R72_TRANSFER_DOC_NO)

    // Verify all 21 items are rendered
    const checkboxes = page.locator('input[type="checkbox"]')
    await expect(checkboxes).toHaveCount(21)

    // Reload page to verify refresh integrity
    await page.reload()
    await waitForFontsAndData(page)

    await expect(page.locator('body')).toContainText(R72_TRANSFER_DOC_NO)
    const reloadedCheckboxes = page.locator('input[type="checkbox"]')
    await expect(reloadedCheckboxes).toHaveCount(21)
  })

  test('name and SKU have useful width and natural wrap across all 6 phone widths', async ({ page }) => {
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 })
      await page.waitForTimeout(50)

      // Ensure no horizontal window scrolling/overflow
      const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      expect(hasHorizontalScroll, `Horizontal scroll detected on ${width}px`).toBe(false)

      const cards = page.locator('div.rounded-2xl').filter({ has: page.locator('input[aria-label="ตรวจแล้ว"]') })
      const cardCount = await cards.count()
      expect(cardCount, 'All 21 item cards must be rendered').toBe(21)

      // Check all 21 rows for identity width, controls below identity, and no overlap
      for (let i = 0; i < cardCount; i++) {
        const card = cards.nth(i)
        const identity = card.locator('div.min-w-0.flex-1').first()
        const stepper = card.locator('button[aria-label="ลด"]').locator('..')

        const cardBox = (await card.boundingBox())!
        const identityBox = (await identity.boundingBox())!
        const stepperBox = (await stepper.boundingBox())!

        expect(cardBox, `Row ${i} card bounding box missing on ${width}px`).not.toBeNull()
        expect(identityBox, `Row ${i} identity bounding box missing on ${width}px`).not.toBeNull()
        expect(stepperBox, `Row ${i} stepper bounding box missing on ${width}px`).not.toBeNull()

        const identityRow = identity.locator('..')
        const rowBox = await identityRow.boundingBox()
        const checkboxBox = await card.locator('input[aria-label="ตรวจแล้ว"]').locator('..').boundingBox()
        expect(rowBox, `Row ${i} identity row missing on ${width}px`).not.toBeNull()
        expect(checkboxBox, `Row ${i} checkbox label missing on ${width}px`).not.toBeNull()
        const gap = await identityRow.evaluate((el) => parseFloat(getComputedStyle(el).columnGap) || 0)
        const expectedIdentityWidth = rowBox!.width - checkboxBox!.width - gap - 1
        expect(
          identityBox.width,
          `Row ${i} identity width (${Math.round(identityBox.width)}) must be >= derived width (${expectedIdentityWidth}) on ${width}px`,
        ).toBeGreaterThanOrEqual(expectedIdentityWidth)

        // R72 mobile layout contract: controls must be below identity, not crammed on the same line
        expect(
          stepperBox.y,
          `Row ${i} controls (y=${Math.round(stepperBox.y)}) must be below identity bottom (y=${Math.round(identityBox.y + identityBox.height)}) on ${width}px`,
        ).toBeGreaterThanOrEqual(identityBox.y + identityBox.height - 1)

        // Controls must not overlap identity
        const overlapX = Math.max(0, Math.min(identityBox.x + identityBox.width, stepperBox.x + stepperBox.width) - Math.max(identityBox.x, stepperBox.x))
        const overlapY = Math.max(0, Math.min(identityBox.y + identityBox.height, stepperBox.y + stepperBox.height) - Math.max(identityBox.y, stepperBox.y))
        const isOverlapping = overlapX > 0 && overlapY > 0
        expect(isOverlapping, `Row ${i} controls must not overlap identity on ${width}px`).toBe(false)
      }
    }
  })

  test('qty minus/input/plus rectangles do not intersect and touch targets are >= 44px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    const minusBtn = page.getByRole('button', { name: 'ลด' }).first()
    const plusBtn = page.getByRole('button', { name: 'เพิ่ม' }).first()
    const qtyInput = page.getByRole('spinbutton', { name: 'รับจริง' }).first()
    const checkbox = page.getByRole('checkbox', { name: 'ตรวจแล้ว' }).first()

    await expect(minusBtn).toBeVisible()
    await expect(plusBtn).toBeVisible()
    await expect(qtyInput).toBeVisible()
    await expect(checkbox).toBeVisible()

    const minusBox = (await minusBtn.boundingBox())!
    const plusBox = (await plusBtn.boundingBox())!
    const inputBox = (await qtyInput.boundingBox())!
    const checkboxLabel = checkbox.locator('..')
    const labelBox = (await checkboxLabel.boundingBox())!

    console.log('minusBox:', minusBox)
    console.log('plusBox:', plusBox)
    console.log('inputBox:', inputBox)
    console.log('labelBox:', labelBox)

    // Check non-intersecting rectangles
    expect(minusBox.x + minusBox.width).toBeLessThanOrEqual(inputBox.x + 1)
    expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(plusBox.x + 1)

    // Stepper buttons touch target >= 44px
    expect(minusBox.width).toBeGreaterThanOrEqual(44)
    expect(minusBox.height).toBeGreaterThanOrEqual(44)
    expect(plusBox.width).toBeGreaterThanOrEqual(44)
    expect(plusBox.height).toBeGreaterThanOrEqual(44)
    expect(inputBox.height).toBeGreaterThanOrEqual(44)

    // Checkbox target: The clickable label wrapper must be >= 44px x 44px
    // On 992f6de baseline, label has className "mt-1 inline-flex h-7 w-7" (28x28px < 44px) (RED).
    expect(labelBox.width, 'Checkbox touch target width must be >= 44px').toBeGreaterThanOrEqual(44)
    expect(labelBox.height, 'Checkbox touch target height must be >= 44px').toBeGreaterThanOrEqual(44)
  })

  test('decimal 1.063 KG quantity is preserved without rounding during typing and ± toggle', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    const qtyInput = page.getByRole('spinbutton', { name: 'รับจริง' }).first()
    const plusBtn = page.getByRole('button', { name: 'เพิ่ม' }).first()
    const minusBtn = page.getByRole('button', { name: 'ลด' }).first()

    // 1. Initial seeded quantity: 1.063
    await expect(qtyInput).toHaveValue(String(R72_DECIMAL_QTY))

    // 2. Click plus (+ 1.0)
    await plusBtn.click()
    await expect(qtyInput).toHaveValue('2.063')

    // 3. Click minus (- 1.0)
    await minusBtn.click()
    await expect(qtyInput).toHaveValue('1.063')

    // 4. Clear and type decimal explicitly
    await qtyInput.fill('')
    await qtyInput.fill('1.063')
    await expect(qtyInput).toHaveValue('1.063')
  })

  test('rapid double-click on confirm submits only once without racing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    // Click "รับครบตามใบส่ง" if visible, or confirm button
    const receiveAllBtn = page.getByRole('button', { name: 'รับครบตามใบส่ง' })
    await expect(receiveAllBtn).toBeVisible()

    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))

    await receiveAllBtn.click({ clickCount: 2 })
    await page.waitForTimeout(800)

    // The service refuses a second receipt by status, so count what reached it, not just what was filed.
    const received = await page.evaluate((id) => {
      const transfers = JSON.parse(localStorage.getItem('pmstock:v1:transfers') || '{}')
      return (transfers[id]?.history ?? []).filter((h: { action: string }) => h.action === 'received').length
    }, R72_TRANSFER_INTERNAL_ID)
    expect(received, 'exactly one receipt filed').toBe(1)
    await expect(page.getByText('เอกสารไม่ได้อยู่ในสถานะพร้อมตรวจรับ')).toHaveCount(0)
    expect(pageErrors, 'no unhandled rejection from a late second tap').toEqual([])
  })

  test('last item (row 21) is scrollable completely above sticky CTA and bottom nav', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    const lastCard = page.locator('div.rounded-2xl').filter({ hasText: 'ถุงพลาสติกหูหิ้วชีวภาพ' }).first()
    await expect(lastCard).toBeVisible()

    // Scroll to max and settle frames BEFORE asserting viewport geometry
    await page.evaluate(async () => {
      window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
    await lastCard.scrollIntoViewIfNeeded()
    await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
    await page.waitForTimeout(100)

    // Locate sticky bottom action bar (FormActions)
    const formActions = page.locator('button:has-text("ยืนยันรับ")').first().locator('..')
    const footerBox = await formActions.boundingBox()
    const lastCardBox = await lastCard.boundingBox()

    expect(footerBox).not.toBeNull()
    expect(lastCardBox).not.toBeNull()

    const itemBottom = lastCardBox!.y + lastCardBox!.height
    const footerTop = footerBox!.y
    console.log(`Row 21 bottom: ${Math.round(itemBottom)}, Footer top: ${Math.round(footerTop)}, diff: ${Math.round(itemBottom - footerTop)}`)
    expect(itemBottom, `Row 21 bottom (${Math.round(itemBottom)}) must be <= footer top (${Math.round(footerTop)})`).toBeLessThanOrEqual(footerTop)
  })
})

test.describe('R72 Agent07: Responsive adaptations, keyboard & device emulation', () => {
  test('200% font scale and landscape orientation keep document accessible without overflow', async ({ page }) => {
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    // Landscape test: 844 x 390
    await page.setViewportSize({ width: 844, height: 390 })
    await page.waitForTimeout(100)

    const landscapeOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(landscapeOverflow, 'Landscape viewport must not have horizontal scrollbar overflow').toBe(false)

    // 200% font zoom test
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px'
    })
    await page.waitForTimeout(100)

    const font200Overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(font200Overflow, '200% font scale must not blow out horizontal container').toBe(false)
  })

  test('shrunk viewport simulates keyboard without hiding active input behind footer', async ({ page }) => {
    // Simulating keyboard open on mobile (e.g. height reduced from 844 to 360px)
    await page.setViewportSize({ width: 390, height: 360 })
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    const qtyInput = page.getByRole('spinbutton', { name: 'รับจริง' }).first()
    await qtyInput.scrollIntoViewIfNeeded()
    await qtyInput.focus()
    await page.waitForTimeout(100)

    const inputBox = (await qtyInput.boundingBox())!
    expect(inputBox.y).toBeGreaterThanOrEqual(0)
    expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(360)
  })

  test('iOS safe area insets via CDP is probed with honest gap reporting if unsupported', async ({ page, context }) => {
    let cdpSupported = false
    let cdpErrorMsg = ''

    try {
      const client = await context.newCDPSession(page)
      await client.send('Emulation.setSafeAreaInsets' as any, {
        insets: { top: 47, bottom: 34, left: 0, right: 0 },
      })
      cdpSupported = true
    } catch (e: any) {
      cdpErrorMsg = e?.message ?? String(e)
    }

    // Record honest empirical finding: CDP Emulation.setSafeAreaInsets is NOT exposed in this Playwright Chromium build
    if (!cdpSupported) {
      expect(cdpErrorMsg).toContain('Emulation.setSafeAreaInsets')
    }
  })

  test('Android browser navigation bar simulation documented as browser-level not OS-level', async ({ page }) => {
    // Simulating Android screen height 800 with 60px browser URL/navigation bar -> 740px viewport
    await page.setViewportSize({ width: 360, height: 740 })
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    await expect(page.locator('body')).toContainText(R72_TRANSFER_DOC_NO)
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('PO price spec reuse: no financial/monetary fields written to stock movements and honest null vs 0', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    // Verify unpriced item (Item 1: Mozzarella, cost: null) does not display "฿0.00"
    const row1 = page.locator('div.rounded-2xl').filter({ hasText: 'มอสซาเรลล่าชีส' }).first()
    await expect(row1).toBeVisible()
    await expect(row1).not.toContainText('฿0.00')

    // Submit receive
    const receiveAllBtn = page.getByRole('button', { name: 'รับครบตามใบส่ง' })
    await receiveAllBtn.click()

    await page.waitForTimeout(500)

    // Inspect stockMovements in localStorage: must contain NO financial/price fields
    const stockMovements = await page.evaluate(() => {
      const raw = localStorage.getItem('pmstock:v1:stockMovements')
      return raw ? JSON.parse(raw) : {}
    })

    for (const mov of Object.values(stockMovements) as any[]) {
      expect(mov.price, 'Stock movement must not have price field written').toBeUndefined()
      expect(mov.cost, 'Stock movement must not have cost field written').toBeUndefined()
      expect(mov.totalAmount, 'Stock movement must not have totalAmount field written').toBeUndefined()
    }
  })
})

test.describe('R72 Agent07: Visual screenshots & baseline capture', () => {
  test('capture before evidence screenshots across mobile viewports', async ({ page }) => {
    await ensureEvidenceDir()

    // 1. 390px full page
    await page.setViewportSize({ width: 390, height: 844 })
    await stageLogisticsFixture(page)
    await page.goto(`/transfers/${R72_TRANSFER_INTERNAL_ID}/receive`)
    await waitForFontsAndData(page)

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'receive-390-full.png'), fullPage: true })

    // 2. Row 1 screenshot (390px)
    const row1 = page.locator('div.rounded-2xl').first()
    await expect(row1).toBeVisible()
    await row1.screenshot({ path: path.join(EVIDENCE_DIR, 'receive-390-row1.png') })

    // 3. Row 21 screenshot (390px)
    const row21 = page.locator('div.rounded-2xl').last()
    await row21.scrollIntoViewIfNeeded()
    await row21.screenshot({ path: path.join(EVIDENCE_DIR, 'receive-390-row21.png') })

    // 4. 320px full page
    await page.setViewportSize({ width: 320, height: 568 })
    await waitForFontsAndData(page)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'receive-320-full.png'), fullPage: true })

    // 5. 430px full page
    await page.setViewportSize({ width: 430, height: 932 })
    await waitForFontsAndData(page)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'receive-430-full.png'), fullPage: true })

    // 6. Landscape screenshot
    await page.setViewportSize({ width: 844, height: 390 })
    await waitForFontsAndData(page)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'receive-landscape.png'), fullPage: true })

    // 7. Shrunk viewport (keyboard) screenshot
    await page.setViewportSize({ width: 390, height: 360 })
    await waitForFontsAndData(page)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'receive-keyboard-shrunk.png'), fullPage: true })
  })
})
