import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { putMany } from './emulator'
import { PASSWORD, PEOPLE, seedStage, type Person } from './fixture'
import { open } from './app'

/**
 * In-app brand switcher (owner, 9 Oct 2026): the brand's logo at the top of the menu opens
 * the three brands; choosing one keeps the session, lands on that brand's Dashboard, and
 * shows only that brand's data. The full-screen picker is for a device that has never chosen.
 */

const EVIDENCE = process.env.BRAND_EVIDENCE_DIR

interface Tally {
  total: number
  listeners: { active: number }
}
const reads = (page: Page) => page.evaluate(() => (window as unknown as { __pzmReads: { tally: () => Tally } }).__pzmReads.tally())
/** Wait until no read has been counted for 1.5 s (at most 20 s): the page has finished loading. */
async function settle(page: Page): Promise<Tally> {
  let last = await reads(page)
  let quietSince = Date.now()
  const end = Date.now() + 20_000
  while (Date.now() < end) {
    await page.waitForTimeout(250)
    const now = await reads(page)
    if (now.total !== last.total) quietSince = Date.now()
    else if (Date.now() - quietSince >= 1500) return now
    last = now
  }
  return last
}

async function stage() {
  await seedStage()
  const now = Date.now()
  const p = (path: string, name: string, sku: string) => ({
    path,
    data: { sku, name, category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now },
  })
  await putMany([
    { path: 'lelapin__locations/lwh', data: { name: 'Le Lapin Kitchen', type: 'warehouse', active: true, createdAt: now } },
    { path: 'rnd__locations/rwh', data: { name: 'R&D Kitchen', type: 'warehouse', active: true, createdAt: now } },
    p('lelapin__products/baguette', 'BAGUETTE', 'BAK-01-001'),
    p('rnd__products/sumac', 'SUMAC POWDER', 'RND-01-001'),
  ])
}

/** Sign in on a fresh device; the first time, the picker asks which brand. */
async function signIn(page: Page, who: Person, firstTime: boolean) {
  await page.goto('/')
  await page.getByRole('textbox', { name: /email|อีเมล/i }).fill(PEOPLE[who].email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  if (firstTime) await page.getByRole('button', { name: 'Pizza Mania' }).click()
  await expect(page.locator('main')).toBeVisible()
}

const trigger = (page: Page) => page.getByRole('button', { name: /^แบรนด์: / }).locator('visible=true').first()

async function switchTo(page: Page, name: RegExp) {
  await trigger(page).click()
  await page.getByRole('menuitemradio', { name }).click()
}

async function shot(page: Page, name: string) {
  if (!EVIDENCE) return
  mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` })
}

async function catalogue(page: Page): Promise<string> {
  await open(page, '/products')
  await expect(page.locator('main')).toBeVisible()
  await expect(page.getByText('กำลังโหลดสินค้า...')).toHaveCount(0)
  await page.waitForTimeout(300)
  return page.locator('main').innerText()
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

test('first sign-in asks once; the next sign-in opens the last brand directly', async ({ browser }) => {
  await stage()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await signIn(page, 'admin', true)
  await switchTo(page, /Le Lapin/)
  await expect(trigger(page)).toHaveAccessibleName(/Le Lapin/)
  // Sign out and back in (another account, same device): no picker, the device's last brand.
  await page.getByRole('button', { name: 'ออกจากระบบ' }).first().click()
  await signIn(page, 'staffA', false)
  await expect(page.getByRole('heading', { name: 'เลือกแบรนด์' })).toHaveCount(0)
  await expect(trigger(page)).toHaveAccessibleName(/Le Lapin/)
})

test('Pizza → Le Lapin → R&D → Pizza: each lands on its Dashboard with only its own data', async ({ browser }) => {
  await stage()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await signIn(page, 'admin', true)
  await open(page, '/products')
  let text = await catalogue(page)
  expect(text).toContain('FLOUR')
  expect(text).not.toContain('BAGUETTE')
  await shot(page, 'after-1440-sidebar-closed')

  // Opening the list reads nothing (measured once the page has stopped reading).
  const before = await settle(page)
  await trigger(page).click()
  await expect(page.getByRole('menu', { name: 'เลือกแบรนด์' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: /Pizza Mania/ })).toHaveAttribute('aria-checked', 'true')
  await page.waitForTimeout(1500)
  expect((await reads(page)).total - before.total).toBe(0)
  await shot(page, 'after-1440-dropdown-open')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(trigger(page)).toBeFocused()

  const listeners0 = (await settle(page)).listeners.active
  const cost: { to: string; reads: number; listenersAfter: number }[] = []
  for (const [name, mine, others] of [
    [/Le Lapin/, 'BAGUETTE', ['FLOUR', 'SUMAC POWDER']],
    [/R&D/, 'SUMAC POWDER', ['FLOUR', 'BAGUETTE']],
    [/Pizza Mania/, 'FLOUR', ['BAGUETTE', 'SUMAC POWDER']],
  ] as const) {
    const r0 = await settle(page)
    await switchTo(page, name)
    await expect(trigger(page)).toHaveAccessibleName(name)
    await expect(page).toHaveURL(/\/$/)
    // What the switch itself costs: the new brand's Dashboard, loaded and quiet.
    const r1 = await settle(page)
    cost.push({ to: String(name), reads: r1.total - r0.total, listenersAfter: r1.listeners.active })
    text = await catalogue(page)
    expect(text).toContain(mine)
    for (const o of others) expect(text, `${mine} vs ${o}`).not.toContain(o)
  }
  // Same number of live listeners after three switches: the old brand's were closed.
  expect((await settle(page)).listeners.active).toBe(listeners0)
  for (const c of cost) expect(c.listenersAfter, c.to).toBe(listeners0)
  if (EVIDENCE) writeFileSync(`${EVIDENCE}/read-cost.json`, JSON.stringify({ listenersBefore: listeners0, switches: cost }, null, 2))
  console.log('SWITCH-COST', JSON.stringify({ listenersBefore: listeners0, switches: cost }))
})

test('rapid switching settles on the last choice, with that brand\'s data only', async ({ browser }) => {
  await stage()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await signIn(page, 'admin', true)
  for (const name of [/Le Lapin/, /R&D/, /Pizza Mania/, /Le Lapin/]) {
    await trigger(page).click({ timeout: 10_000 })
    await page.getByRole('menuitemradio', { name }).click()
  }
  await expect(trigger(page)).toHaveAccessibleName(/Le Lapin/)
  const text = await catalogue(page)
  expect(text).toContain('BAGUETTE')
  expect(text).not.toContain('FLOUR')
})

test('an unsaved receiving form is named first; cancel keeps it, switching keeps its draft for that brand', async ({ browser }) => {
  await stage()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await signIn(page, 'admin', true)
  await open(page, '/receive')
  await page.getByText('รับนอกใบสั่งซื้อ').first().click()
  await page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)').fill('FLOUR')
  await page.getByRole('button', { name: /FLOUR/ }).first().click()

  await switchTo(page, /Le Lapin/)
  const dialog = page.getByRole('dialog', { name: /เปลี่ยนเป็น/ })
  await expect(dialog).toContainText('ยังไม่ได้บันทึก')
  await shot(page, 'after-1440-unsaved-warning')
  await dialog.getByRole('button', { name: 'ยกเลิก' }).click()
  await expect(trigger(page)).toHaveAccessibleName(/Pizza Mania/)
  await expect(page).toHaveURL(/\/receive/)

  await switchTo(page, /Le Lapin/)
  await page.getByRole('dialog', { name: /เปลี่ยนเป็น/ }).getByRole('button', { name: 'เปลี่ยนแบรนด์' }).click()
  await expect(trigger(page)).toHaveAccessibleName(/Le Lapin/)
  // Back in Pizza Mania the receipt is still there.
  await switchTo(page, /Pizza Mania/)
  await open(page, '/receive')
  await expect(page.getByText('FLOUR').first()).toBeVisible()
})

test('a draft that cannot be saved stops the switch; the form stays as typed', async ({ browser }) => {
  await stage()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await signIn(page, 'admin', true)
  await open(page, '/receive')
  await page.getByText('รับนอกใบสั่งซื้อ').first().click()
  await page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)').fill('FLOUR')
  await page.getByRole('button', { name: /FLOUR/ }).first().click()

  // The device's storage is full: every draft write throws QuotaExceededError.
  await page.evaluate(() => {
    const real = Storage.prototype.setItem
    ;(window as unknown as { __realSetItem: typeof real }).__realSetItem = real
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('draft:')) throw new DOMException('quota', 'QuotaExceededError')
      return real.call(this, key, value)
    }
  })
  await switchTo(page, /Le Lapin/)
  await page.getByRole('dialog', { name: /เปลี่ยนเป็น/ }).getByRole('button', { name: 'เปลี่ยนแบรนด์' }).click()
  await expect(page.getByText(/เก็บงานที่ยังไม่ได้บันทึกไว้ในเครื่องนี้ไม่ได้ \(รับสินค้าเข้า\)/)).toBeVisible()
  await shot(page, 'after-1440-draft-save-failed')
  await expect(trigger(page)).toHaveAccessibleName(/Pizza Mania/)
  await expect(page).toHaveURL(/\/receive/)
  await expect(page.getByText('FLOUR').first()).toBeVisible()

  // Storage back: the same switch goes through, and the draft is really there afterwards.
  await page.evaluate(() => {
    Storage.prototype.setItem = (window as unknown as { __realSetItem: Storage['setItem'] }).__realSetItem
  })
  await switchTo(page, /Le Lapin/)
  await page.getByRole('dialog', { name: /เปลี่ยนเป็น/ }).getByRole('button', { name: 'เปลี่ยนแบรนด์' }).click()
  await expect(trigger(page)).toHaveAccessibleName(/Le Lapin/)
  const kept = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('draft:pizza:') && k.endsWith(':receive')))
  expect(kept).toHaveLength(1)
})

test('stale or tampered browser storage never picks a brand', async ({ browser }) => {
  await stage()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => {
    localStorage.setItem('pmstock:v1:lastBrand', 'evil')
    sessionStorage.setItem('pmstock:v1:tabBrand', 'evil')
  })
  const page = await context.newPage()
  await signIn(page, 'admin', true) // an unknown id = never chosen: the picker asks
  await expect(trigger(page)).toHaveAccessibleName(/Pizza Mania/)
})

test('keyboard: open, move, choose, and Escape back to the trigger', async ({ browser }) => {
  await stage()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await signIn(page, 'admin', true)
  await trigger(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitemradio', { name: /Pizza Mania/ })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: /Le Lapin/ })).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('menuitemradio', { name: /R&D/ })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(trigger(page)).toHaveAccessibleName(/R&D/)
})

for (const vp of [
  { w: 1024, h: 768, kind: 'tablet' },
  { w: 390, h: 844, kind: 'phone' },
]) {
  test(`${vp.kind} ${vp.w}x${vp.h}: the logo opens a sheet of the three brands`, async ({ browser }) => {
    await stage()
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } })
    await signIn(page, 'admin', true)
    const logo = trigger(page)
    await expect(logo).toBeVisible()
    const box = (await logo.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
    await logo.click()
    const sheet = page.getByRole('dialog', { name: 'เลือกแบรนด์' })
    await expect(sheet.getByRole('menuitemradio')).toHaveCount(3)
    for (const item of await sheet.getByRole('menuitemradio').all()) {
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      // Nothing on top of it (the phone's tab bar once covered the last brand).
      const covered = await item.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return !(hit && el.contains(hit))
      })
      expect(covered).toBe(false)
    }
    await shot(page, `after-${vp.w}x${vp.h}-sheet`)
    await sheet.getByRole('menuitemradio', { name: /Le Lapin/ }).click()
    await expect(trigger(page)).toHaveAccessibleName(/Le Lapin/)
    const text = await catalogue(page)
    expect(text).toContain('BAGUETTE')
    expect(text).not.toContain('FLOUR')
  })
}
