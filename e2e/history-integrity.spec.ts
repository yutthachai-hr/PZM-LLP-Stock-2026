import { test, expect } from '@playwright/test'
import { seedStage, PEOPLE, PASSWORD } from './fixture'
import { signedIn } from './app'
import { putDoc } from './emulator'

// This fixture reproduces the Owner's visible rows, NOT a claim about Production.
// There is deliberately no Oct 8 movement: the UI must explain its actual query scope.
const day = (key: string) => Date.parse(`${key}T00:00:00+07:00`)

test('Le Lapin PARIS HAM: Oct 8 open-ended range has honest full-product coverage', async ({ browser }) => {
  const stage = await seedStage()
  const now = Date.now()
  const person = PEOPLE.staffA
  await putDoc(`lelapin__users/${stage.uid.staffA}`, { ...person, active: true, createdAt: now }, { stampId: false })
  await putDoc('lelapin__locations/wh', { name: 'LL Warehouse', type: 'warehouse', active: true, createdAt: now })
  await putDoc('lelapin__products/paris-ham', { sku: 'LL-HAM-001', name: 'PARIS HAM (TGM)', category: 'Meat', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now })
  for (const [id, docNo, key, qty] of [
    ['opening', 'RC-00001', '2026-10-01', 10],
    ['rc87', 'RC-00087', '2026-10-09', 9.06],
    ['rc93', 'RC-00093', '2026-10-09', 0.94],
    ['rc94', 'RC-00094', '2026-10-12', 19.62],
  ] as const) {
    await putDoc(`lelapin__stockMovements/${id}`, {
      docNo, type: 'receive', productId: 'paris-ham', productName: 'PARIS HAM (TGM)', unit: 'KG', qty,
      toLocationId: 'wh', date: day(key), createdAt: now, byUserId: stage.uid.staffA, byUserName: person.name, hasPhoto: false,
    })
  }
  const page = await signedIn(browser, 'staffA')
  try {
    await page.evaluate(() => sessionStorage.setItem('pmstock:v1:tabBrand', 'lelapin'))
    await page.goto('/movements?product=paris-ham')
    await expect(page.locator('main')).toBeVisible()
    await page.locator('input[type="date"]').first().fill('2026-10-08')
    await expect(page.locator('tbody').getByText('RC-00094', { exact: true })).toBeVisible()
    await expect(page.locator('tbody').getByText('RC-00093', { exact: true })).toBeVisible()
    await expect(page.locator('tbody').getByText('RC-00087', { exact: true })).toBeVisible()
    await expect(page.getByText('RC-00001', { exact: true })).toHaveCount(0)
    // RED on main: notice instead says the GLOBAL history starts Oct 10.
    await expect(page.getByText('โหลดประวัติสินค้าครบแล้ว (4 รายการ)', { exact: true })).toBeVisible()
    await expect(page.getByText(/แสดงประวัติตั้งแต่/)).toHaveCount(0)
    const reads = () => page.evaluate(() => {
      const meter = (window as unknown as { __pzmReads: { tally: () => { stats: { label: string; docs: number; queries: number }[] } } }).__pzmReads
      return meter.tally().stats.filter(s => s.label === 'movements.product.complete')
    })
    const before = await reads()
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ docs: 4, queries: 1 })
    await page.locator('input[type="date"]').first().fill('2026-10-09')
    await page.locator('input[type="date"]').first().fill('2026-10-08')
    expect(await reads()).toEqual(before)
    console.log('HISTORY_READ_BUDGET', JSON.stringify(before))
    await page.screenshot({ path: '../pzm-recovery-20261017/history-integrity/after-owner-reproduction.png', fullPage: true })
    // A location card needs the Oct 1 opening, even though only Oct 9/12 are displayed.
    await page.locator('select').nth(1).selectOption('wh')
    await expect(page.getByRole('cell', { name: '39.62', exact: true })).toBeVisible()
  } finally {
    await page.context().close()
  }
})

for (const [brand, prefix, role] of [['pizza', '', 'staffA'], ['lelapin', 'lelapin__', 'manager'], ['rnd', 'rnd__', 'admin']] as const) {
  for (const timezoneId of ['Asia/Bangkok', 'UTC', 'America/Los_Angeles']) {
    test(`${brand} ${role} ${timezoneId}: Oct 8 includes both midnight edges, excludes Oct 9, TH and EN`, async ({ browser }) => {
      const stage = await seedStage()
      const now = Date.now()
      const user = PEOPLE[role]
      await putDoc(`${prefix}users/${stage.uid[role]}`, { ...user, active: true, createdAt: now }, { stampId: false })
      await putDoc(`${prefix}locations/wh`, { name: 'Warehouse', type: 'warehouse', active: true, createdAt: now })
      await putDoc(`${prefix}products/date-edges`, { sku: 'DATE-001', name: 'DATE EDGES', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now })
      for (const [id, date] of [['A', day('2026-10-08')], ['B', day('2026-10-09') - 1], ['C', day('2026-10-09')]] as const) {
        await putDoc(`${prefix}stockMovements/edge-${id}`, { docNo: `RC-EDGE-${id}`, type: 'receive', productId: 'date-edges', productName: 'DATE EDGES', unit: 'KG', qty: 1, toLocationId: 'wh', date, createdAt: now, byUserId: stage.uid[role], byUserName: user.name, hasPhoto: false })
      }
      const context = await browser.newContext({ timezoneId })
      const page = await context.newPage()
      try {
        await page.goto('/')
        await page.getByRole('textbox', { name: /email|อีเมล/i }).fill(user.email)
        await page.locator('input[type="password"]').fill(PASSWORD)
        await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
        await page.getByRole('button', { name: 'Pizza Mania', exact: true }).click()
        await expect(page.locator('main')).toBeVisible()
        await page.evaluate(b => sessionStorage.setItem('pmstock:v1:tabBrand', b), brand)
        await page.goto('/movements?product=date-edges')
        await expect(page.locator('[data-history-status="complete"]')).toBeVisible()
        const inputs = page.locator('input[type="date"]')
        await inputs.nth(0).fill('2026-10-08')
        await inputs.nth(1).fill('2026-10-08')
        for (const lang of ['th', 'en']) {
          if (lang === 'en') await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาอังกฤษ', exact: true }).click()
          await expect(page.locator('tbody tr')).toHaveCount(2)
          await expect(page.locator('tbody').getByText('RC-EDGE-A', { exact: true })).toBeVisible()
          await expect(page.locator('tbody').getByText('RC-EDGE-B', { exact: true })).toBeVisible()
          await expect(page.locator('tbody').getByText('RC-EDGE-C', { exact: true })).toHaveCount(0)
          await expect(page.locator('tbody').getByText(lang === 'th' ? '08/10/2569' : '08/10/2026', { exact: true })).toHaveCount(2)
        }
      } finally { await context.close() }
    })
  }
}
