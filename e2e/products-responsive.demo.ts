import { test, expect, type Page } from '@playwright/test'

/**
 * Regression for the Products table overflowing and pushing Location off the right edge on a
 * desktop between 1280 and 1920 (TH and EN). R19-E measured it: 1318/1190 px on main
 * a4ea1e5, 1521/1190 after PR37 805cb163. The table must fit its scroller and keep the
 * Location header inside it at every desktop width, with the phone card still printing the
 * invoice hint.
 *
 * Demo mode only: browser storage, no emulator, no live data. Port 5198 is the R19-E lease.
 */
const WIDTHS = [1280, 1366, 1440, 1536, 1600, 1920]
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
  test(`the Products table fits its container and keeps Location visible at every desktop width (${lang})`, async ({ page }) => {
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
    }
    expect(broken, `Products table does not fit at: ${broken.join('; ')}`).toEqual([])
  })

  test(`the phone card still prints the invoice hint at 390 (${lang})`, async ({ page }) => {
    await stage(page, lang)
    await page.setViewportSize({ width: 390, height: 844 })
    const card = page.locator('[data-row-key="invoice"]:visible').first()
    await expect(card).toBeVisible()
    // Printed outright, not behind a hover title: the words are on screen without interaction.
    await expect(card.getByText(INVOICE, { exact: false }).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
