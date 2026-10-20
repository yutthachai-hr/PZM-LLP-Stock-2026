import { test, expect, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

/**
 * Regression for the Products table overflowing and pushing Location off the right edge on a
 * desktop between 1280 and 1920 (TH and EN). R19-E measured it: 1318/1190 px on main
 * a4ea1e5, 1521/1190 after PR37 805cb163. The table must fit its scroller and keep the
 * Location header inside it at every desktop width, with the phone card still printing the
 * invoice hint.
 *
 * Demo mode only: browser storage, no emulator, no live data. Port 5198 is the R19-E lease.
 */
const WIDTHS = [1024, 1280, 1366, 1440, 1536, 1600, 1840, 1920]
const INVOICE = '฿360.00 / Carton (×24)'

async function stage(page: Page, lang: 'th' | 'en') {
  await page.addInitScript(
    ({ l }) => {
      if (localStorage.getItem('products-responsive-fixture')) return
      localStorage.setItem('products-responsive-fixture', '1')
      const now = Date.now()
      const store = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
      const user = { id: 'resp-user', email: 'demo@inventory-pzm.local', name: 'Responsive QA', role: 'admin', active: true, createdAt: now }
      store('users', { 'resp-user': user })
      localStorage.setItem('pmstock:v1:session', user.id)
      localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
      store('locations', { wh: { id: 'wh', name: 'สาขาหลัก Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
      const base = { category: 'Sauce', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now }
      store('products', {
        // A long catalogue name, the shape that used to widen the row past the container.
        long: {
          ...base, id: 'long', sku: 'PZS-01-05-001', unit: 'Kilogram', unitType: 'KG',
          name: 'CHEESE SAUCE PREMIUM 1 KG (LONG CATALOGUE NAME FOR THE RESPONSIVE ROW)',
        },
        invoice: {
          ...base, id: 'invoice', sku: 'PZS-01-06-001', unit: 'Each', unitType: 'EA',
          name: '04 Sample Product (Carton Invoice Hint)', cost: 15,
          unitConversions: [{ label: 'Carton', size: 24 }],
          costHistory: [{ price: 360, unit: 'Carton', factor: 24, cost: 15, effectiveAt: now - 86400000, at: now - 86400000, by: user.id, byName: user.name }],
        },
        plain: { ...base, id: 'plain', sku: 'PZS-01-07-001', unit: 'Each', unitType: 'EA', name: '05 Sample Product (Standard 12.50)', cost: 12.5,
          costHistory: [{ price: 12.5, unit: 'Each', factor: 1, cost: 12.5, effectiveAt: now - 86400000, at: now - 86400000, by: user.id, byName: user.name }] },
      })
      store('stockLevels', { 'wh__long': { id: 'wh__long', productId: 'long', locationId: 'wh', qty: 0, updatedAt: now, updatedBy: user.id } })
      localStorage.setItem('pmstock:lang', l)
      localStorage.setItem('pzm:products:view', 'table')
    },
    { l: lang },
  )
  await page.goto('/products')
  // Semantic readiness: the seeded row and a cost figure have painted.
  await expect(page.locator('[data-row-key="invoice"]:visible').first()).toBeVisible()
  await expect(page.locator('[data-row-key="invoice"]:visible').first()).toContainText(INVOICE)
}

/** The visible desktop scroller that holds the table. */
const scroller = (page: Page) => page.locator('div.overflow-auto:visible').first()

async function measure(page: Page) {
  return scroller(page).evaluate((el) => {
    const heads = [...el.querySelectorAll('thead th')].map((th) => ({
      text: th.textContent.trim(),
      right: Math.round(th.getBoundingClientRect().right),
      visible: th.getBoundingClientRect().width > 0,
    }))
    return {
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      heads,
      boxRight: Math.round(el.getBoundingClientRect().right),
    }
  })
}

for (const lang of ['th', 'en'] as const) {
  test(`the Products table fits its container and keeps Location visible at every desktop width (${lang})`, async ({ page }, info) => {
    await stage(page, lang)
    // Every width is measured before failing, so one run reports the whole breakpoint curve.
    const broken: string[] = []
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 960 })
      // The sticky head has painted the Location column before we read geometry.
      await expect(scroller(page).locator('thead th').first()).toBeVisible()
      const m = await measure(page)
      const location = m.heads.find((h) => h.visible && /คลังสินค้า|Location|Warehouse/i.test(h.text))
      if (!location) broken.push(`${width}px (${lang}): Location header missing`)
      else if (location.right > m.boxRight + 1) broken.push(`${width}px (${lang}): Location header right ${location.right} outside container ${m.boxRight}`)
      if (m.scrollWidth > m.clientWidth) broken.push(`${width}px (${lang}): table needs ${m.scrollWidth}px in a ${m.clientWidth}px container`)
      await page.screenshot({ path: info.outputPath(`products-${lang}-${width}.png`) })
    }
    expect(broken, `Products table does not fit at: ${broken.join('; ')}`).toEqual([])
  })

  test(`option C keeps names and SKU readable and moves update metadata to details (${lang})`, async ({ page }) => {
    await stage(page, lang)
    await page.setViewportSize({ width: 1536, height: 960 })
    const updated = scroller(page).locator('thead th').filter({ hasText: /อัปเดตล่าสุด|Last updated/ })
    await expect(updated).toBeHidden()
    const row = page.locator('[data-row-key="long"]:visible').first()
    await expect(row).toContainText('PZS-01-05-001')
    const name = row.getByText('CHEESE SAUCE PREMIUM 1 KG (LONG CATALOGUE NAME FOR THE RESPONSIVE ROW)', { exact: true })
    expect(await name.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await row.getByRole('button', { name: /ตัวเลือกเพิ่มเติม|More options/ }).click()
    await page.getByRole('menuitem', { name: /แก้ไข|Edit/, exact: true }).click()
    const details = page.getByRole('dialog')
    await expect(details.getByText(/อัปเดตล่าสุด|Last updated/, { exact: true })).toBeVisible()
    await expect(details.locator('time[dateTime]').first()).toBeVisible()
  })

  test(`phone and small-tablet cards keep the name, SKU and invoice hint (${lang})`, async ({ page }, info) => {
    await stage(page, lang)
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 960 })
      const card = page.locator('[data-row-key="invoice"]:visible').first()
      await expect(card).toBeVisible()
      await expect(card.getByText(INVOICE, { exact: false }).first()).toBeVisible()
      await expect(card).toContainText('PZS-01-06-001')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`products-${lang}-${width}.png`) })
    }
  })

  test(`SKU search/sort and numeric Excel export survive the folded columns (${lang})`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    await stage(page, lang)
    const search = page.locator('input[placeholder*="SKU"]')
    const sorting = page.locator('select').filter({ has: page.locator('option[value="sku-asc"]') })
    await search.fill('PZS-01-')
    await sorting.selectOption('sku-desc')
    await expect(page.locator('tbody tr[data-row-key]')).toHaveCount(3)
    expect(await page.locator('tbody tr[data-row-key]').evaluateAll(rows => rows.map(r => r.getAttribute('data-row-key')))).toEqual(['plain', 'invoice', 'long'])
    await sorting.selectOption('sku-asc')
    expect(await page.locator('tbody tr[data-row-key]').evaluateAll(rows => rows.map(r => r.getAttribute('data-row-key')))).toEqual(['long', 'invoice', 'plain'])
    await search.fill('PZS-01-06-001')
    const invoice = page.locator('[data-row-key="invoice"]:visible').first()
    await expect(invoice).toBeVisible()
    await expect(page.locator('[data-row-key="long"]:visible')).toHaveCount(0)
    // The native select remains keyboard-operable; SKU order is not coupled to column visibility.
    const sort = page.locator('select').filter({ has: page.locator('option[value="sku-asc"]') })
    await sort.focus()
    await page.keyboard.press('Home')
    await sort.selectOption('sku-asc')
    await expect(sort).toHaveValue('sku-asc')
    await invoice.getByRole('checkbox').check()
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: /ส่งออก Excel|Export Excel/ }).click()
    const file = await downloaded
    const output = info.outputPath('selected-product.xlsx')
    await file.saveAs(output)
    const book = XLSX.read(readFileSync(output), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]])
    expect(rows).toHaveLength(1)
    expect(Object.values(rows[0])).toContain('PZS-01-06-001')
    expect(Object.values(rows[0])).toContain(15)
    // DOM semantics and keyboard focus are automated evidence, not a physical screen-reader run.
    await expect(invoice.locator('summary')).toHaveAccessibleName(/15\.00/)
  })
}
