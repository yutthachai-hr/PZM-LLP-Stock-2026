import { test, expect, type Page } from '@playwright/test'

// Controlled TR-00001 fixture, browser storage only. Same document id in another brand is a decoy.
async function stage(page: Page, brand = 'pizza', role = 'admin', link = '/logistics/tr-fixture') {
  await page.addInitScript(({ brand, role, link }) => {
    if (sessionStorage.getItem('r63-fixture')) return
    sessionStorage.setItem('r63-fixture', '1')
    const now = Date.now()
    const prefix = brand === 'pizza' ? '' : `${brand}__`
    const store = (c: string, rows: unknown) => localStorage.setItem(`pmstock:v1:${c}`, JSON.stringify(rows))
    const user = { id: 'r63-user', email: 'r63@inventory-pzm.local', name: 'R63 QA', role, active: true, createdAt: now }
    store('users', { [user.id]: user })
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', brand)
    sessionStorage.setItem('pmstock:v1:tabBrand', brand)
    localStorage.setItem('pmstock:lang', 'en')
    const locations = {
      wh: { id: 'wh', name: 'R63 warehouse', type: 'warehouse', active: true, createdAt: now },
      br: { id: 'br', name: 'R63 branch', type: 'branch', active: true, createdAt: now },
    }
    store(`${prefix}locations`, locations)
    store(`${prefix}products`, { p1: { id: 'p1', sku: 'R63', name: 'R63 synthetic flour', unitType: 'KG', unit: 'KG', active: true, createdAt: now, updatedAt: now, minStock: 0 } })
    const transfer = {
      id: 'tr-fixture', docNo: 'TR-00001', status: 'pendingApproval', revision: 1,
      fromLocationId: 'wh', toLocationId: 'br', dispatchDate: now,
      requestedBy: user.id, requestedByName: user.name, createdAt: now, updatedAt: now,
      submittedAt: now, items: [], history: [], note: 'R63 controlled fixture',
    }
    store(`${prefix}transfers`, { 'tr-fixture': transfer })
    const other = brand === 'rnd' ? 'lelapin__' : 'rnd__'
    store(`${other}transfers`, {
      'tr-fixture': { ...transfer, docNo: 'TR-WRONG-BRAND' },
      'other-only': { ...transfer, id: 'other-only', docNo: 'TR-OTHER-ONLY' },
    })
    store(`${prefix}stockLevels`, {})
    store(`${prefix}stockMovements`, {})
    store(`${prefix}notifications`, {
      old: {
        id: 'old', kind: 'transferSubmitted', category: 'inventory', priority: 'medium',
        to: { all: true }, audienceKeys: ['all'], params: { docNo: 'TR-00001', by: 'R63 QA', from: 'wh', to: 'br', n: 0 },
        link, active: true, readBy: {}, source: 'client', createdBy: user.id,
        createdAt: now - 10_000, updatedAt: now - 10_000, expiresAt: now + 86_400_000,
      },
    })
  }, { brand, role, link })
}

async function openBell(page: Page) {
  await page.getByRole('button', { name: /Notifications \(/ }).first().click()
}
const row = (page: Page) => page.getByRole('button').filter({ hasText: 'TR-00001' }).last()
async function readBy(page: Page, brand = 'pizza', id = 'old') {
  return page.evaluate(({ brand, id }) => JSON.parse(localStorage.getItem(`pmstock:v1:${brand === 'pizza' ? '' : brand + '__'}notifications`) || '{}')[id]?.readBy, { brand, id })
}
async function stock(page: Page) {
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => /stockLevels|stockMovements|transfers$/.test(k)).sort().map((k) => [k, localStorage.getItem(k)])))
}

for (const phone of [false, true]) {
  test(`${phone ? 'mobile' : 'desktop'}: legacy bell click opens document id, Back works, no stock writes`, async ({ page }) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 })
    await stage(page)
    await page.goto('/products')
    const before = await stock(page)
    await openBell(page)
    await row(page).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/transfers\/tr-fixture$/)
    await expect(page.locator('main')).toContainText('TR-00001')
    await expect(page.locator('main')).not.toContainText('TR-WRONG-BRAND')
    expect((await readBy(page))['r63-user']).toBeTruthy()
    expect(await stock(page)).toEqual(before)
    await page.goBack()
    await expect(page).toHaveURL(/\/products$/)
  })
}

for (const brand of ['pizza', 'lelapin', 'rnd']) {
  test(`${brand}: canonical link opens only the current namespace`, async ({ page }) => {
    await stage(page, brand, 'manager', '/transfers/tr-fixture?tab=items')
    await page.goto('/products')
    await openBell(page)
    await row(page).click()
    await expect(page).toHaveURL(/\/transfers\/tr-fixture\?tab=items$/)
    await expect(page.locator('main')).toContainText('TR-00001')
    await expect(page.locator('main')).not.toContainText('TR-WRONG-BRAND')
  })
}

for (const link of ['https://evil.example/x', '/logistics/deleted', '/logistics/other-only', '/logistics/deleted/', '/transfers/deleted/receive/']) {
  test(`refused destination ${link}: stays unread and never changes stock`, async ({ page }) => {
    await stage(page, 'pizza', 'admin', link)
    await page.goto('/products')
    const before = await stock(page)
    await openBell(page)
    await row(page).click()
    await expect(page).toHaveURL(/\/products$/)
    await expect(page.getByText(link.startsWith('https:') ? /Cannot open this notification: invalid link/ : /Transfer not found|Transfer document not found|No transfer document found/)).toBeVisible()
    expect(await readBy(page)).toEqual({})
    expect(await stock(page)).toEqual(before)
  })
}

test('popup legacy action opens the transfer (and only marks that notification)', async ({ page }) => {
  await stage(page)
  await page.goto('/products')
  await expect(page.locator('main')).toBeVisible()
  await page.waitForTimeout(1200) // host initial snapshot settles before a new occurrence arrives
  await page.evaluate(() => {
    const key = 'pmstock:v1:notifications'
    const rows = JSON.parse(localStorage.getItem(key) || '{}')
    rows.fresh = { ...rows.old, id: 'fresh', createdAt: Date.now(), updatedAt: Date.now() }
    localStorage.setItem(key, JSON.stringify(rows))
    window.dispatchEvent(new StorageEvent('storage', { key }))
  })
  const view = page.getByRole('button', { name: 'View transfer', exact: true })
  await expect(view).toBeVisible()
  await view.click()
  await expect(page).toHaveURL(/\/transfers\/tr-fixture$/)
  await expect(page.locator('main')).toContainText('TR-00001')
  expect((await readBy(page, 'pizza', 'fresh'))['r63-user']).toBeTruthy()
  expect(await readBy(page)).toEqual({})
})

for (const link of ['/logistics/deleted', 'https://evil.example/x']) {
  test(`popup ${link} is not marked opened`, async ({ page }) => {
    await stage(page, 'pizza', 'staff', link)
    await page.goto('/products')
    await expect(page.locator('main')).toBeVisible()
    await page.waitForTimeout(1200)
    await page.evaluate(() => {
      const key = 'pmstock:v1:notifications'
      const rows = JSON.parse(localStorage.getItem(key) || '{}')
      rows.fresh = { ...rows.old, id: 'fresh', createdAt: Date.now(), updatedAt: Date.now() }
      localStorage.setItem(key, JSON.stringify(rows))
      window.dispatchEvent(new StorageEvent('storage', { key }))
    })
    const card = page.locator('.notice-card').filter({ hasText: 'TR-00001' })
    await expect(card).toBeVisible()
    if (link.startsWith('https:')) await expect(card.getByRole('button', { name: 'View transfer' })).toHaveCount(0)
    else {
      await card.getByRole('button', { name: 'View transfer' }).click()
      await expect(page.getByText('Transfer document not found', { exact: true })).toBeVisible()
    }
    await expect(page).toHaveURL(/\/products$/)
    expect(await readBy(page, 'pizza', 'fresh')).toEqual({})
  })
}

test('a bookmarked missing transfer shows the existing empty state', async ({ page }) => {
  await stage(page)
  await page.goto('/transfers/deleted')
  await expect(page.locator('main')).toContainText('Transfer document not found')
})
