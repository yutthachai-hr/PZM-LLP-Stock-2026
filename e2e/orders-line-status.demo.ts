import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

/**
 * The LINE status of every placed order, next to — never merged with — the supplier's answer
 * (owner, 17 Oct 2026: the green LINE highlight disappeared from the Orders page in PR #20).
 * Isolated browser-storage demo: no emulator, no production data.
 */

async function stage(page: Page, brand = 'pizza') {
  page.on('pageerror', (error) => console.error('Browser error:', error.message))
  await page.addInitScript(({ brand }) => {
    // Every write the local backend makes to the orders collection, so a double-tap that
    // records the outcome twice is visible to the test.
    const real = Storage.prototype.setItem
    ;(window as unknown as { __orderWrites: number }).__orderWrites = 0
    Storage.prototype.setItem = function (key: string, value: string) {
      if (/^pmstock:v1:(?:[a-z]+__)?purchaseOrders$/.test(key)) (window as unknown as { __orderWrites: number }).__orderWrites++
      return real.call(this, key, value)
    }
    if (localStorage.getItem('orders-line-fixture')) return
    localStorage.setItem('orders-line-fixture', '1')
    const now = Date.now(), day = 86_400_000
    const user = { id: 'ux-user', email: 'demo@inventory-pzm.local', name: 'UX Demo', role: 'admin', active: true, createdAt: now }
    const store = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    store('users', { 'ux-user': user })
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', brand)
    const sent = { shareStatus: 'sent', sentAt: now - 2 * day, sentBy: 'buyer', sentByName: 'Somchai Buyer' }
    const cases: [string, Record<string, unknown>][] = [
      ['sent-waiting', { ...sent, supplierConfirmationStatus: 'waiting' }],
      ['sent-confirmed', { ...sent, supplierConfirmationStatus: 'confirmed' }],
      ['sent-overdue', { ...sent, supplierConfirmationStatus: 'confirmed', expectedAt: now - 3 * day }],
      ['opened', { shareStatus: 'shareOpened', shareOpenedAt: now - day }],
      ['failed', { shareStatus: 'failed' }],
      ['skipped', { shareStatus: 'skipped' }],
      ['unsent', {}],
      ['resend', {
        ...sent, revision: 1,
        revisions: [{ rev: 1, at: now - day, by: 'ux-user', byName: 'UX Demo', reason: 'qty', changes: [] }],
      }],
    ]
    for (const [id, prefix] of [['pizza', ''], ['lelapin', 'lelapin__'], ['rnd', 'rnd__']]) {
      store(`${prefix}locations`, { wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
      store(`${prefix}suppliers`, { sup: { id: 'sup', name: `${id} SUPPLIER`, active: true, type: 'takingReturn', createdAt: now } })
      store(`${prefix}products`, { flour: { id: 'flour', sku: 'F-001', name: 'FLOUR', unit: 'KG', unitType: 'KG', minStock: 0, active: true, createdAt: now } })
      const rows: Record<string, unknown> = {}
      cases.forEach(([key, extra], i) => {
        rows[key] = {
          id: key, docNo: `PO-LN-00${i + 1}`, supplierId: 'sup', supplierName: `${id} SUPPLIER`, locationId: 'wh',
          status: 'ordered', orderedAt: now - day - i * 1000, expectedAt: now + day,
          lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10, receivedQty: 0 }],
          createdBy: user.id, createdByName: user.name, createdAt: now - day, updatedAt: now - day,
          ...extra,
        }
      })
      store(`${prefix}purchaseOrders`, rows)
    }
  }, { brand })
  await page.goto('/orders')
  await expect(page.locator('main').getByText(`${brand} SUPPLIER`, { exact: true }).filter({ visible: true }).first()).toBeVisible()
}

const row = (page: Page, id: string) => page.locator(`[data-row-key="${id}"]:visible`)
const lineBadge = (page: Page, id: string) => row(page, id).locator('[data-line-state]')
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __orderWrites: number }).__orderWrites)

/** "Green" as a person would judge it, pale tints included: a green hue with real saturation. */
async function isGreen(page: Page, id: string, prop: 'color' | 'backgroundColor') {
  const rgb = await lineBadge(page, id).evaluate((el, p) => getComputedStyle(el)[p as 'color'], prop)
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map((v) => Number(v) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d === 0 || max !== g) return false
  const hue = 60 * ((b - r) / d) + 120
  const light = (max + min) / 2
  const sat = d / (1 - Math.abs(2 * light - 1))
  return hue >= 90 && hue <= 170 && sat > 0.25
}

const EXPECTED: [string, string, string][] = [
  ['sent-waiting', 'sent', 'LINE · ส่งแล้ว'],
  ['sent-confirmed', 'sent', 'LINE · ส่งแล้ว'],
  ['sent-overdue', 'sent', 'LINE · ส่งแล้ว'],
  ['opened', 'awaitingConfirm', 'LINE · รอยืนยันส่ง'],
  ['failed', 'failed', 'LINE · ส่งไม่สำเร็จ'],
  ['skipped', 'skipped', 'ข้ามการส่ง LINE'],
  ['unsent', 'unsent', 'LINE · ยังไม่ส่ง'],
  ['resend', 'resend', 'LINE · ต้องส่งใหม่'],
]

test('every placed order shows its LINE state as its own badge, sent ones in LINE green', async ({ page }) => {
  await stage(page)
  for (const [id, state, label] of EXPECTED) {
    await expect(lineBadge(page, id), id).toHaveAttribute('data-line-state', state)
    await expect(lineBadge(page, id), id).toContainText(label)
  }
  expect(await isGreen(page, 'sent-waiting', 'color')).toBe(true)
  expect(await isGreen(page, 'sent-waiting', 'backgroundColor')).toBe(true)
  for (const id of ['unsent', 'opened', 'failed', 'skipped', 'resend']) expect(await isGreen(page, id, 'color'), id).toBe(false)
  // Who sent it and when, for the person who needs to chase it.
  await expect(lineBadge(page, 'sent-waiting')).toHaveAttribute('title', /Somchai Buyer/)
})

test('the supplier answer is a separate fact and never wears the LINE green', async ({ page }) => {
  await stage(page)
  await expect(row(page, 'sent-waiting')).toContainText('รอผู้ขายยืนยัน')
  await expect(row(page, 'sent-confirmed')).toContainText('ผู้ขายยืนยันแล้ว')
  await expect(row(page, 'sent-overdue')).toContainText('เกินกำหนดรับของ')
  // An order nobody has sent is not "waiting for the supplier": no supplier fact is invented.
  await expect(row(page, 'unsent')).not.toContainText('รอผู้ขายยืนยัน')
  await expect(row(page, 'unsent')).not.toContainText('ผู้ขายยืนยันแล้ว')
  const supplierBg = await row(page, 'sent-confirmed').locator('[data-supplier-state]').evaluate((el) => getComputedStyle(el).backgroundColor)
  const lineBg = await lineBadge(page, 'sent-confirmed').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(supplierBg).not.toBe(lineBg)
  // Overdue stays the loudest thing on its row.
  await expect(row(page, 'sent-overdue').locator('[data-urgency]')).toHaveAttribute('data-urgency', 'urgent')
})

test('quick filters count the loaded window and narrow the list', async ({ page }) => {
  await stage(page)
  const chip = (name: RegExp) => page.getByRole('button', { name })
  await expect(page.getByText(/ใน 30 วันล่าสุด/)).toBeVisible()
  await expect(chip(/ยังไม่ส่ง LINE \(4\)/)).toBeVisible()
  await expect(chip(/รอผู้ขายยืนยัน \(1\)/)).toBeVisible()
  await expect(chip(/ต้องส่ง PO ใหม่ \(1\)/)).toBeVisible()
  await expect(chip(/เกินกำหนดรับของ \(1\)/)).toBeVisible()
  await chip(/ต้องส่ง PO ใหม่/).click()
  await expect(chip(/ต้องส่ง PO ใหม่/)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-row-key]:visible')).toHaveCount(1)
  await expect(row(page, 'resend')).toBeVisible()
})

test('a resend confirmed in the wizard turns the badge green and recounts, without a reload, writing once', async ({ page }) => {
  await stage(page)
  await row(page, 'resend').getByRole('button', { name: 'ส่ง PO ใหม่', exact: true }).click()
  const wizard = page.getByRole('dialog')
  await wizard.getByRole('button', { name: 'แชร์รูป' }).click()
  const confirmSent = wizard.getByRole('button', { name: 'ส่งแล้ว', exact: true })
  await expect(confirmSent).toBeVisible()
  const before = await writes(page)
  // Two taps before React can re-render: the outcome must still be recorded once.
  await confirmSent.evaluate((el) => {
    ;(el as HTMLButtonElement).click()
    ;(el as HTMLButtonElement).click()
  })
  await expect(wizard.getByText('ส่งครบทุกรายแล้ว')).toBeVisible()
  expect(await writes(page)).toBe(before + 1)
  // The text button, not the ✕ in the corner.
  await wizard.locator('button', { hasText: /^ปิด$/ }).click()
  await expect(lineBadge(page, 'resend')).toHaveAttribute('data-line-state', 'sent')
  await expect(lineBadge(page, 'resend')).toHaveAttribute('title', /UX Demo/)
  await expect(page.getByRole('button', { name: /ต้องส่ง PO ใหม่ \(0\)/ })).toBeVisible()
  // After a reload the stored order says the same thing the screen did.
  await page.reload()
  await expect(lineBadge(page, 'resend')).toHaveAttribute('data-line-state', 'sent')
})

test('English labels and the open sheet agree with the list', async ({ page }) => {
  await stage(page)
  await row(page, 'opened').click()
  const sheet = page.getByRole('dialog', { name: 'ใบสั่งซื้อ PO-LN-004', exact: true })
  await expect(sheet.locator('[data-line-state]')).toHaveAttribute('data-line-state', 'awaitingConfirm')
  await sheet.getByLabel('ปิด', { exact: true }).click()
  await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาอังกฤษ' }).filter({ visible: true }).click()
  await expect(lineBadge(page, 'sent-waiting')).toContainText('LINE · Sent')
  await expect(lineBadge(page, 'resend')).toContainText('LINE · Resend needed')
  await expect(lineBadge(page, 'skipped')).toContainText('LINE skipped')
  await expect(row(page, 'sent-waiting')).not.toContainText('ส่งแล้ว')
})

test('LINE badges are legible, labelled for screen readers, and the chips work from the keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await stage(page)
  // WCAG AA for small text: 4.5:1 between each badge's text and its own fill.
  for (const [id] of EXPECTED) {
    const ratio = await lineBadge(page, id).evaluate((el) => {
      const rgb = (c: string) => c.match(/\d+(\.\d+)?/g)!.slice(0, 3).map((v) => Number(v) / 255)
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const s = getComputedStyle(el)
      // A badge without a fill of its own sits on the white card.
      const bg = s.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'rgb(255, 255, 255)' : s.backgroundColor
      const [a, b] = [lum(rgb(s.color)), lum(rgb(bg))].sort((x, y) => y - x)
      return (a + 0.05) / (b + 0.05)
    })
    expect(ratio, id).toBeGreaterThanOrEqual(4.5)
  }
  // The detail a sighted person gets from the tooltip is in the accessible text too.
  await expect(lineBadge(page, 'sent-waiting')).toContainText('Somchai Buyer')
  await expect(lineBadge(page, 'resend')).toContainText('Rev.1')
  // Keyboard: Space presses a chip, Enter releases it, and the list follows.
  const chip = page.getByRole('button', { name: /ต้องส่ง PO ใหม่ \(/ })
  await chip.focus()
  await page.keyboard.press('Space')
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-row-key]:visible')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-row-key]:visible')).toHaveCount(8)
  // Reduced motion: the chip's colour change does not travel.
  const duration = await chip.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))
  expect(duration).toBeLessThan(0.01)
})

for (const brand of ['pizza', 'lelapin', 'rnd']) {
  test(`mobile card shows the primary and LINE badges in ${brand}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stage(page, brand)
    await expect(lineBadge(page, 'sent-waiting')).toHaveAttribute('data-line-state', 'sent')
    await expect(lineBadge(page, 'resend')).toHaveAttribute('data-line-state', 'resend')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = await row(page, 'resend').getByRole('button', { name: 'ส่ง PO ใหม่', exact: true }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })
}

test('screenshots at desktop and mobile widths, TH and EN', async ({ page }) => {
  await stage(page)
  const dir = `docs/evidence/orders-line/${process.env.ORDERS_LINE_CAPTURE ?? 'after'}`
  await mkdir(dir, { recursive: true })
  for (const lang of ['th', 'en'] as const) {
    if (lang === 'en') {
      // The language switch sits in the desktop header; on a phone it is under "More".
      await page.setViewportSize({ width: 1440, height: 1100 })
      await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาอังกฤษ' }).filter({ visible: true }).click()
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 })
      await expect(page.locator('main').getByText('PO-LN-001', { exact: true }).filter({ visible: true })).toBeVisible()
      await page.screenshot({ path: `${dir}/${width}-${lang}.png`, fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  }
})
