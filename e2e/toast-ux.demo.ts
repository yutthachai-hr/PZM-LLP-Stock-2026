import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const card = (page: Page) => page.locator('[data-toast]')
async function open(page: Page) { await page.goto('/e2e/toast-harness.html') }

test('capture before or after with a real price toast', async ({ page }) => {
  await mkdir('docs/evidence/toast-ux/before', { recursive: true })
  await mkdir('docs/evidence/toast-ux/after', { recursive: true })
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await open(page)
    const before = process.env.TOAST_CAPTURE === 'before'
    await page.getByRole('button', { name: before ? 'Legacy price' : 'Save price', exact: true }).click()
    await expect(page.getByText(/350\.2203/).last()).toBeVisible()
    if (!before) await expect(card(page)).toHaveCSS('opacity', '1')
    await page.screenshot({ path: `docs/evidence/toast-ux/${before ? 'before' : 'after'}/${width}-th.png` })
    if (!before) {
      const box = await card(page).boundingBox()
      expect(box).not.toBeNull()
      if (width >= 768) { expect(box!.width).toBeGreaterThanOrEqual(320); expect(box!.width).toBeLessThanOrEqual(360); expect(box!.y).toBeLessThan(110) }
      else { expect(box!.x).toBeGreaterThanOrEqual(12); const footer = await page.getByTestId('bottom-controls').boundingBox(); expect(box!.y + box!.height).toBeLessThan(footer!.y) }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  }
})

test('structured price copy and all four restrained variants', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Save price', exact: true }).click()
  await expect(card(page).getByRole('heading')).toHaveText('บันทึกราคาแล้ว')
  await expect(card(page)).toContainText('฿350.2203 ต่อ KG')
  const color = await card(page).evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(color).toBe('rgb(255, 255, 255)')
  for (const variant of ['Error', 'Warning', 'Info']) {
    await page.getByRole('button', { name: variant, exact: true }).click()
  }
  await expect(card(page)).toHaveCount(3)
  await card(page).first().getByRole('button', { name: 'ปิดการแจ้งเตือนนี้' }).click()
  await expect(card(page)).toHaveCount(3)
  await expect(card(page).last()).toHaveAttribute('data-toast-kind', 'info')
})

test('deduplicates repeated active messages without making a growing stack', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Duplicates', exact: true }).click()
  expect(await page.getByText('สั่งของแล้ว', { exact: true }).count()).toBe(1)
  await expect(card(page)).toHaveCount(1)
  await expect(card(page)).toContainText('สั่งของแล้ว')
  await expect(page.getByTestId('identity-changes')).toHaveText('0')
})

test('a repeated failure gets a fresh reading interval without stacking or losing keyboard focus', async ({ page }) => {
  await page.clock.install()
  await open(page)
  const error = page.getByRole('button', { name: 'Error', exact: true })
  await error.click()
  await page.mouse.move(5, 5)
  await page.clock.runFor(6000)
  await error.click()
  await page.clock.runFor(3000)
  await expect(card(page)).toHaveCount(1)
  const close = card(page).getByRole('button', { name: 'ปิดการแจ้งเตือนนี้' })
  await close.focus()
  // A background retry can fail while someone is reading the card with the keyboard.
  await error.evaluate((button: HTMLButtonElement) => button.click())
  await expect(close).toBeFocused()
  await page.clock.runFor(9000)
  await expect(card(page)).toHaveCount(1)
  await error.focus()
  await page.clock.runFor(8400)
  await expect(card(page)).toHaveCount(0)
})

test('a repeated error revives the same card during its exit animation', async ({ page }) => {
  await page.clock.install()
  await open(page)
  const error = page.getByRole('button', { name: 'Error', exact: true })
  await error.click()
  await page.mouse.move(5, 5)
  await page.clock.runFor(8050)
  await expect(card(page)).toHaveAttribute('data-leaving', 'true')
  await error.click()
  await page.clock.runFor(500)
  await expect(card(page)).toHaveCount(1)
  await expect(card(page)).toHaveAttribute('data-leaving', 'false')
  await page.clock.runFor(8000)
  await expect(card(page)).toHaveCount(0)
})

test('pending notices get their reading time only after becoming visible', async ({ page }) => {
  await page.clock.install()
  await open(page)
  await page.getByRole('button', { name: 'Six notices', exact: true }).click()
  await expect(card(page)).toHaveCount(3)
  await page.mouse.move(5, 5)
  await page.clock.runFor(4300)
  await expect(card(page)).toHaveCount(3)
  await expect(card(page).first()).toContainText('Notice 4')
  await page.clock.runFor(4300)
  await expect(card(page)).toHaveCount(0)
})

test('success auto-dismisses after three seconds while errors remain longer', async ({ page }) => {
  await page.clock.install()
  await open(page)
  await page.getByRole('button', { name: 'Save order', exact: true }).click()
  await page.getByRole('button', { name: 'Error', exact: true }).click()
  await page.mouse.move(5, 5)
  await page.clock.runFor(3400)
  await expect(card(page)).toHaveCount(1)
  await expect(card(page)).toHaveAttribute('data-toast-kind', 'error')
  await page.clock.runFor(5000)
  await expect(card(page)).toHaveCount(0)
})

test('hover and keyboard focus pause dismissal; Escape does not close underlying UI', async ({ page }) => {
  await page.clock.install()
  await open(page)
  await page.getByRole('button', { name: 'Save price', exact: true }).click()
  await card(page).hover()
  await page.clock.runFor(5000)
  await expect(card(page)).toHaveCount(1)
  await card(page).getByRole('button', { name: 'ปิดการแจ้งเตือนนี้' }).focus()
  await page.mouse.move(5, 5)
  await page.clock.runFor(5000)
  await expect(card(page)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Transient notification QA' })).toBeVisible()
})

test('useful actions work once and do not steal focus on arrival', async ({ page }) => {
  await open(page)
  const button = page.getByRole('button', { name: 'Action notice', exact: true })
  await button.click()
  await expect(button).toBeFocused()
  await card(page).getByRole('button', { name: 'Undo demo action' }).click()
  await expect(page.getByTestId('action-count')).toHaveText('1')
  await expect(card(page)).toHaveCount(0)
})

test('TH/EN and reduced motion preserve accessible title and description', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await page.getByRole('button', { name: 'TH/EN', exact: true }).click()
  await page.getByRole('button', { name: 'Save price', exact: true }).click()
  await expect(card(page).getByRole('heading')).toHaveText('Price saved')
  await expect(card(page)).toContainText('฿350.2203 per KG')
  await expect(page.getByRole('status', { name: 'Transient notifications' })).toBeVisible()
  expect(await card(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  await page.screenshot({ path: 'docs/evidence/toast-ux/after/1440-en.png' })
})

test('operational alerts and toasts share three slots without expiring unseen messages', async ({ page }) => {
  await page.clock.install()
  await open(page)
  await page.getByRole('button', { name: 'Operational alerts', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(3)
  await page.getByRole('button', { name: 'Six notices', exact: true }).click()
  await page.clock.runFor(20_000)
  await expect(card(page)).toHaveCount(0)
  await expect(page.locator('.notice-card')).toHaveCount(3)
  await page.getByRole('button', { name: 'Clear operational alerts', exact: true }).click()
  await expect(card(page)).toHaveCount(3)
  await expect(card(page).first()).toContainText('Notice 1')
  await page.clock.runFor(4300)
  await expect(card(page).first()).toContainText('Notice 4')
})

test('hidden tabs pause transient timers and visibility resumes remaining time', async ({ page }) => {
  await page.clock.install()
  await open(page)
  await page.getByRole('button', { name: 'Save order', exact: true }).click()
  await expect(card(page)).toHaveCount(1)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.runFor(10_000)
  await expect(card(page)).toHaveCount(1)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.runFor(3400)
  await expect(card(page)).toHaveCount(0)
})

test('hidden tab race between render and passive effect flushes pauses timer deterministically', async ({ page }) => {
  await page.clock.install()
  await open(page)
  await page.evaluate(() => {
    const origSetAttribute = Element.prototype.setAttribute
    Element.prototype.setAttribute = function (name: string, value: string) {
      origSetAttribute.apply(this, [name, value])
      if (name === 'data-toast') {
        Element.prototype.setAttribute = origSetAttribute
        Object.defineProperty(document, 'hidden', { configurable: true, value: true })
        document.dispatchEvent(new Event('visibilitychange'))
      }
    }
  })
  await page.getByRole('button', { name: 'Save order', exact: true }).click()
  await expect(card(page)).toHaveCount(1)
  await page.clock.runFor(10_000)
  await expect(card(page)).toHaveCount(1)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(3400)
  await expect(card(page)).toHaveCount(0)
})

test('mobile viewport shrink keeps notices above the simulated on-screen keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await open(page)
  await page.getByRole('button', { name: 'Save price', exact: true }).click()
  await page.evaluate(() => { Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 500 }); window.visualViewport!.dispatchEvent(new Event('resize')) })
  await expect.poll(async () => { const b = await card(page).boundingBox(); return b ? b.y + b.height : 1000 }).toBeLessThan(500)
  expect((await card(page).boundingBox())!.y).toBeGreaterThan(64)
})

test('real price save in the product editor shows a title and the exact saved cost', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('toast-price-fixture')) return
    localStorage.setItem('toast-price-fixture', '1')
    const now = Date.now()
    const put = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    put('users', { a: { id: 'a', email: 'demo@inventory-pzm.local', name: 'Toast QA', role: 'admin', active: true, createdAt: now } })
    localStorage.setItem('pmstock:v1:session', 'a')
    localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
    put('locations', { wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
    put('products', { cheese: { id: 'cheese', sku: 'DAI-01', name: 'MOZZARELLA', category: 'Dairy', unit: 'Kilogram', unitType: 'KG', minStock: 0, active: true, createdAt: now, updatedAt: now } })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/products')
  await page.locator('main').getByRole('button', { name: 'ตัวเลือกเพิ่มเติม' }).filter({ visible: true }).first().click()
  await page.getByRole('menuitem', { name: 'แก้ไข', exact: true }).click()
  await page.getByLabel('ราคา (บาท)').fill('350.2203')
  await page.getByRole('button', { name: 'บันทึกราคาใหม่', exact: true }).click()
  await expect(card(page).getByRole('heading')).toHaveText('บันทึกราคาแล้ว')
  await expect(card(page)).toContainText('฿350.2203 ต่อ KG')
  await expect(card(page)).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'docs/evidence/toast-ux/after/1440-real-price-save.png' })
  const box = await card(page).boundingBox()
  expect(box!.width).toBeLessThanOrEqual(360)
})

test('provider unmount cleans timers and leaves no stale cards', async ({ page }) => {
  await page.clock.install()
  await open(page)
  await page.getByRole('button', { name: 'Save order', exact: true }).click()
  await expect(card(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Toggle provider', exact: true }).click()
  await page.clock.runFor(20_000)
  await expect(card(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle provider', exact: true }).click()
  await expect(card(page)).toHaveCount(0)
})
