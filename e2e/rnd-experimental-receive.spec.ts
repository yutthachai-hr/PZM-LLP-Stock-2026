import { expect, test, type Browser, type Page } from '@playwright/test'
import { handleExperimentalRequest } from '../functions/_lib/experimentalReceive'
import { experimentalRestStore } from '../functions/_lib/experimentalStore'
import { listDocs, PROJECT, putMany } from './emulator'
import { PASSWORD, PEOPLE, seedStage } from './fixture'

/**
 * R&D experimental OTHER receiving (R25), in a real browser. The page's
 * /api/rnd-experimental-receive call is answered in this process by the real handler over the
 * real REST adapter, pointed at the Firestore emulator with the emulator-only owner token, so
 * the stock it files is the emulator's and nothing leaves the machine.
 */

const now = Date.now()

async function stage() {
  await seedStage()
  await putMany([
    { path: 'rnd__locations/rwh', data: { name: 'R&D Kitchen', type: 'warehouse', active: true, createdAt: now } },
    { path: 'rnd__suppliers/other', data: { name: 'OTHER', contactNumber: '', type: 'takingReturn', active: true, createdAt: now, updatedAt: now } },
    { path: 'rnd__suppliers/rsup', data: { name: 'R&D FRESH MARKET', contactNumber: '', type: 'takingReturn', active: true, createdAt: now, updatedAt: now } },
    { path: 'rnd__products/cheese-other', data: { sku: 'CHE-99-000', name: 'CHEESE-(OTHER)', category: 'CHEESE', unit: 'Each', unitType: 'EA', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now } },
  ])
}

/** The trusted endpoint in this process. `loseNext` drops one response after the write ran. */
function server() {
  const posts: { operationId: string }[] = []
  let loseNext = false
  const toEmulator: typeof fetch = (url, init) =>
    fetch(String(url).replace('https://firestore.googleapis.com/v1/', 'http://127.0.0.1:8080/v1/'), { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: 'Bearer owner' } })
  const deps = {
    enabled: true,
    store: experimentalRestStore(PROJECT, async () => 'owner', toEmulator),
    // Emulator ID tokens are unsigned; the uid is all the handler needs from them here.
    verifyUser: async (h: string | null) => (h ? (JSON.parse(Buffer.from(h.replace(/^Bearer /, '').split('.')[1], 'base64url').toString()) as { user_id?: string }).user_id ?? null : null),
  }
  async function attach(page: Page) {
    await page.route('**/api/rnd-experimental-receive', async (route) => {
      const req = route.request()
      posts.push(JSON.parse(req.postData() ?? '{}'))
      await new Promise((r) => setTimeout(r, 400)) // a slow network: room for a second tap
      const res = await handleExperimentalRequest(new Request('http://localhost/api/rnd-experimental-receive', { method: 'POST', headers: req.headers(), body: req.postData() ?? '' }), deps)
      if (loseNext) {
        loseNext = false
        return route.abort('failed') // the receipt was filed; this device never hears back
      }
      return route.fulfill({ status: res.status, json: await res.json() })
    })
  }
  return { posts, attach, loseResponse: () => (loseNext = true) }
}

const rndPicker = (page: Page) => page.getByRole('button', { name: /^R&D/ })

/** Admin (catalogue authority is admin-only) signed in to the R&D brand on the receive screen. */
async function rndAdmin(browser: Browser, attach: (p: Page) => Promise<void>): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await attach(page)
  await page.goto('/')
  await page.getByRole('textbox', { name: /email|อีเมล/i }).fill(PEOPLE.admin.email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await rndPicker(page).click()
  await expect(page.locator('main')).toBeVisible()
  await page.goto('/receive')
  await expect(rndPicker(page).or(page.locator('main'))).toBeVisible()
  if (await rndPicker(page).isVisible()) await rndPicker(page).click()
  await expect(page.getByRole('heading', { name: 'รับสินค้าเข้า' })).toBeVisible()
  return page
}

async function draftOneExperimental(page: Page, invoiceNo: string) {
  await page.getByRole('radio', { name: /รับนอกใบสั่งซื้อ/ }).click()
  await page.getByLabel(/ผู้ขาย \(Supplier\)/).selectOption('other')
  await page.getByRole('button', { name: '+ เพิ่มสินค้าทดลอง' }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('ชื่อสินค้าทดลอง').fill('Synthetic Smoked Cheese')
  await form.getByLabel('รายละเอียด / สเปก').fill('200 g')
  await form.getByLabel('จำนวนสินค้าทดลอง').fill('5')
  await form.getByLabel('หน่วยสินค้าทดลอง').selectOption('Pack')
  await form.getByRole('button', { name: 'เพิ่มในร่างใบรับ' }).click()
  await expect(form).toHaveCount(0)
  await page.getByLabel(/เลขที่เอกสาร \/ ใบกำกับ/).fill(invoiceNo)
}

async function review(page: Page) {
  await page.getByRole('button', { name: 'ตรวจสอบและรับสินค้า' }).locator('visible=true').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Synthetic Smoked Cheese')).toBeVisible()
  return dialog.getByRole('button', { name: 'ยืนยันรับเข้าคลัง' })
}

async function filed() {
  const products = (await listDocs('rnd__products')).filter((p) => p.id !== 'cheese-other')
  const levels = await listDocs('rnd__stockLevels')
  const moves = await listDocs('rnd__stockMovements')
  return { products, levels, moves }
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

test('a double tap on confirm files one experimental receipt: one request, one new item, stock once', async ({ browser }) => {
  await stage()
  const { posts, attach } = server()
  const page = await rndAdmin(browser, attach)
  await draftOneExperimental(page, 'SYN-R27-1')
  const confirm = await review(page)

  // Two taps in the same frame, before React can re-render the button as disabled.
  await confirm.evaluate((b: HTMLButtonElement) => {
    b.click()
    b.click()
  })
  await expect(page.getByRole('button', { name: 'กำลังบันทึก...' })).toHaveCount(0, { timeout: 30_000 })
  await expect.poll(async () => (await filed()).moves.length, { timeout: 20_000 }).toBe(1)

  expect(posts).toHaveLength(1)
  const { products, levels } = await filed()
  expect(products).toHaveLength(1)
  expect(products[0]).toMatchObject({ category: 'CHEESE', name: 'Synthetic Smoked Cheese', supplierId: 'other' })
  expect(String(products[0].sku)).toMatch(/^RND-\d{6}$/)
  expect(levels.map((l) => l.qty)).toEqual([5])
  await expect(page.getByText(/บันทึกไม่สำเร็จ/)).toHaveCount(0)
})

test('rows keyed under OTHER survive a mode switch and a different supplier refuses review instead of misfiling them', async ({ browser }) => {
  await stage()
  const { posts, attach } = server()
  const page = await rndAdmin(browser, attach)
  await draftOneExperimental(page, 'SYN-R27-3')
  await page.getByRole('radio', { name: /จากใบสั่งซื้อ/ }).click()
  await page.getByRole('radio', { name: /รับนอกใบสั่งซื้อ/ }).click()
  await page.getByLabel(/ผู้ขาย \(Supplier\)/).selectOption('rsup')
  await page.getByRole('button', { name: 'ตรวจสอบและรับสินค้า' }).locator('visible=true').first().click()
  await expect(page.getByText(/มีสินค้าทดลองในร่าง/)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Back on the R&D OTHER supplier the same rows are still there and file normally.
  await page.getByLabel(/ผู้ขาย \(Supplier\)/).selectOption('other')
  await (await review(page)).click()
  await expect.poll(async () => (await filed()).moves.length, { timeout: 20_000 }).toBe(1)
  expect(posts).toHaveLength(1)
})

test('a lost response keeps the draft and the same operation: confirming again files nothing twice', async ({ browser }) => {
  await stage()
  const { posts, attach, loseResponse } = server()
  const page = await rndAdmin(browser, attach)
  await draftOneExperimental(page, 'SYN-R27-2')
  loseResponse()
  await (await review(page)).click()
  await expect(page.getByText(/บันทึกไม่ชัดเจน/)).toBeVisible()
  expect((await filed()).moves).toHaveLength(1) // it did file, the device just never heard

  await (await review(page)).click() // the frozen draft is still there
  await expect.poll(() => posts.length).toBe(2)
  expect(posts[1].operationId).toBe(posts[0].operationId)
  const { products, levels, moves } = await filed()
  expect(products).toHaveLength(1)
  expect(moves).toHaveLength(1)
  expect(levels.map((l) => l.qty)).toEqual([5])
})
