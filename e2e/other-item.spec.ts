import { expect, test, type Browser, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { getDoc, listDocs, putDoc } from './emulator'
import { PASSWORD, PEOPLE, seedStage, type Person } from './fixture'
import { open } from './app'

/**
 * Smart "Other" item (R&D, 8 Oct 2026), end to end on the emulator with the real server
 * command (e2e/command-server.mjs runs functions/_lib/stockCommands):
 *
 *   staff: R&D → new request → VEGETABLE-(OTHER) → type "Sumac powder" → not found → create
 *          → the line carries the real name and a new RND code, pending review → submit
 *   staff: the same item typed again → offered (pending), used → same product, no new code
 *   staff: an existing catalogue item typed → "existing item", its own code
 *   manager: approves → order → the order line is the new product, by id, with its name
 *   staff: receives it → stock goes to THAT product only
 */
const SHOTS = 'test-results/other-item'

async function rndSession(browser: Browser, who: Person, path: string, size = { width: 1440, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ viewport: size })
  const page = await context.newPage()
  await page.goto('/')
  await page.getByPlaceholder('you@email.com').fill(PEOPLE[who].email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await page.getByRole('button', { name: /R&D/ }).click()
  await expect(page.locator('main')).toBeVisible()
  await open(page, path)
  return page
}

async function startRequest(page: Page, first = false) {
  // The destination is chosen once; a request with lines keeps it.
  if (first) await page.getByLabel('คลังปลายทาง').selectOption({ label: 'R&D Kitchen' })
  await page.getByPlaceholder('ค้นหาชื่อสินค้า / รหัสสินค้า').fill('OTHER')
  await page.getByRole('option').getByRole('button', { name: /VEGETABLE-\(OTHER\)/ }).first().click()
  await expect(page.getByRole('region', { name: 'ระบุสินค้าอื่น' })).toBeVisible()
}

test('R&D → Other → type a name → create or reuse → request → order → receive: the right product all the way', async ({ browser }) => {
  test.setTimeout(240_000)
  mkdirSync(SHOTS, { recursive: true })
  await seedStage()
  const now = Date.now()
  await putDoc('rnd__locations/wh', { name: 'R&D Kitchen', type: 'warehouse', active: true, createdAt: now })
  await putDoc('rnd__suppliers/sup1', { name: 'RND SUPPLIER', contactNumber: '020000000', type: 'takingReturn', active: true, createdAt: now, updatedAt: now })
  await putDoc('rnd__suppliers/sup2', { name: 'SECOND SUPPLIER', contactNumber: '020000001', type: 'takingReturn', active: true, createdAt: now, updatedAt: now })
  await putDoc('rnd__products/vgt-other', { sku: 'VGT-02-20-001', name: 'VEGETABLE-(OTHER)', category: 'Vegetable', unit: '', unitType: '', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now })
  await putDoc('rnd__products/thyme', { sku: 'VGT-02-01-003', name: 'THYME (YCUBE SOLUTIONS)', category: 'Vegetable', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, supplierId: 'sup1', createdAt: now, updatedAt: now })

  // 1. A new item, created from the request (desktop).
  const staff = await rndSession(browser, 'staffA', '/requests/new')
  await startRequest(staff, true)
  const panel = staff.getByRole('region', { name: 'ระบุสินค้าอื่น' })
  // Typing costs no Firestore reads: the brand's products are on the device, aliases were
  // read once when the panel opened. Counted by the app's own meter.
  await staff.waitForTimeout(1500)
  await staff.evaluate(() => (window as unknown as { __pzmReads: { reset: () => void } }).__pzmReads.reset())
  for (const ch of 'Sumac powder') await panel.getByLabel('ชื่อสินค้า *').press(ch === ' ' ? 'Space' : ch)
  await panel.getByLabel('สเปก / ขนาด (ถ้ามี)').fill('500 g bag')
  await panel.getByLabel('หน่วย', { exact: true }).fill('KG')
  await expect(panel.getByText('ไม่พบสินค้านี้ในระบบ')).toBeVisible()
  const typingReads = await staff.evaluate(() => (window as unknown as { __pzmReads: { tally: () => { total: number } } }).__pzmReads.tally().total)
  console.log('OTHER-ITEM typing reads:', typingReads)
  expect(typingReads).toBe(0)
  await staff.screenshot({ path: `${SHOTS}/1-new-item-1440.png`, fullPage: true })
  await panel.getByRole('button', { name: 'สร้างรหัสใหม่และใช้' }).click()
  await expect(staff.getByText('สินค้าใหม่ รอตรวจสอบ').first()).toBeVisible()
  await expect.poll(async () => (await getDoc('rnd__products/rnd_other_000001'))?.review, { timeout: 15_000 }).toBe('pending')
  expect(await getDoc('rnd__products/rnd_other_000001')).toMatchObject({ sku: 'RND-000001', name: 'Sumac powder', spec: '500 g bag', category: 'Vegetable', unitType: 'KG' })
  await staff.locator('main select').filter({ hasText: 'เลือกผู้ขาย' }).selectOption({ label: 'SECOND SUPPLIER' }) // any supplier: identity does not follow it
  await staff.locator('main input[type=number]').first().fill('2')
  await staff.getByRole('button', { name: 'เพิ่มรายการ' }).click()
  await expect(staff.getByText('Sumac powder').first()).toBeVisible()

  // 2. The same item typed again (another spelling) is offered — not a second code.
  await startRequest(staff)
  const offered = staff.getByRole('region', { name: 'ระบุสินค้าอื่น' })
  await offered.getByLabel('ชื่อสินค้า *').fill('SUMAC  POWDER')
  await offered.getByLabel('สเปก / ขนาด (ถ้ามี)').fill('500G BAG')
  await offered.getByLabel('หน่วย', { exact: true }).fill('kg')
  await expect(offered.getByText('มีคนเสนอไว้แล้ว')).toBeVisible()
  await offered.getByRole('button', { name: 'ใช้รายการนี้' }).first().click()
  await expect(staff.getByText('RND-000001').first()).toBeVisible()
  await staff.locator('main').getByRole('button', { name: 'เปลี่ยน', exact: true }).first().click()

  // 3. An existing catalogue item typed in "Other" is that item.
  await startRequest(staff)
  const known = staff.getByRole('region', { name: 'ระบุสินค้าอื่น' })
  await known.getByLabel('ชื่อสินค้า *').fill('thyme (ycube solutions)')
  await expect(known.getByText('สินค้าเดิม — ใช้รหัสเดิม')).toBeVisible()
  await known.getByRole('button', { name: 'ใช้รายการนี้' }).first().click()
  await expect(staff.getByText('VGT-02-01-003').first()).toBeVisible()
  await staff.locator('main').getByRole('button', { name: 'เปลี่ยน', exact: true }).first().click()

  await staff.getByRole('button', { name: 'ส่งให้หัวหน้าตรวจ' }).click()
  await staff.getByRole('dialog').getByRole('button', { name: 'ส่งให้หัวหน้าตรวจ' }).click()
  await expect.poll(async () => (await listDocs('rnd__purchaseRequests')).find((r) => r.status === 'pendingApproval')?.id, { timeout: 20_000 }).toBeTruthy()
  const pr = (await listDocs('rnd__purchaseRequests')).find((r) => r.status === 'pendingApproval')!
  const item = (pr.items as Record<string, unknown>[]).find((i) => i.productId === 'rnd_other_000001')
  expect(item).toMatchObject({ productName: 'Sumac powder', sku: 'RND-000001', supplierId: 'sup2', requestedQty: 2 })
  expect((await listDocs('rnd__products')).filter((p) => String(p.sku).startsWith('RND-'))).toHaveLength(1)
  await staff.context().close()

  // Phone width: the panel fits, nothing overflows sideways.
  const phone = await rndSession(browser, 'staffB', '/requests/new', { width: 375, height: 812 })
  await startRequest(phone, true)
  await phone.getByRole('region', { name: 'ระบุสินค้าอื่น' }).getByLabel('ชื่อสินค้า *').fill('Sumac')
  await phone.screenshot({ path: `${SHOTS}/2-suggestions-375.png`, fullPage: true })
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await phone.context().close()

  // 4. The manager approves and orders: the order line is the new product, by id.
  const manager = await rndSession(browser, 'manager', `/requests/${pr.id}`)
  await expect(manager.getByText('สินค้าใหม่ รอตรวจสอบ').filter({ visible: true }).first()).toBeVisible()
  await manager.screenshot({ path: `${SHOTS}/3-manager-review-1440.png`, fullPage: true })
  await manager.getByRole('button', { name: 'อนุมัติทั้งหมด' }).click()
  await manager.getByRole('dialog').getByRole('button', { name: 'อนุมัติ', exact: true }).click()
  await expect.poll(async () => (await getDoc(`rnd__purchaseRequests/${pr.id}`))?.status, { timeout: 20_000 }).toBe('approved')
  await manager.locator('main').getByRole('button', { name: 'สร้างใบสั่งซื้อ' }).click()
  await manager.getByRole('dialog').getByRole('button', { name: 'สร้างใบสั่งซื้อ' }).click()
  await expect.poll(async () => (await getDoc(`rnd__purchaseRequests/${pr.id}`))?.status, { timeout: 20_000 }).toBe('poCreated')
  const poId = `po_${pr.id}_sup2`
  const po = await getDoc(`rnd__purchaseOrders/${poId}`)
  expect((po?.lines as Record<string, unknown>[]).map((l) => [l.productId, l.productName])).toEqual([['rnd_other_000001', 'Sumac powder']])
  await manager.context().close()

  // 5. Received: stock goes to that product, and only to it.
  const receiver = await rndSession(browser, 'staffA', `/receive?po=${poId}`)
  await receiver.getByRole('button', { name: 'รับครบตาม PO ทั้งหมด' }).click()
  await receiver.getByLabel(/เลขที่เอกสาร \/ ใบกำกับ/).fill('INV-RND-1')
  await receiver.getByRole('button', { name: 'ตรวจสอบและรับสินค้า' }).click()
  await receiver.getByRole('dialog').getByRole('button', { name: 'ยืนยันรับเข้าคลัง' }).click()
  await expect.poll(async () => (await getDoc('rnd__stockLevels/wh__rnd_other_000001'))?.qty, { timeout: 20_000 }).toBe(2)
  const levels = await listDocs('rnd__stockLevels')
  expect(levels.map((l) => l.id)).toEqual(['wh__rnd_other_000001'])
  expect((await listDocs('stockLevels')).some((l) => String(l.productId).startsWith('rnd_'))).toBe(false) // never another brand
  await receiver.context().close()
})
