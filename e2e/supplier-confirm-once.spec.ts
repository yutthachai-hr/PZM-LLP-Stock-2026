import { expect, test, type Page } from '@playwright/test'
import { memoryServerStore } from '../functions/_lib/memoryStore'
import { answerLink, decideDate, mintLink, viewLink, type Deps } from '../functions/_lib/supplierPo'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import { msToDateKey } from '../src/lib/supplierConfirmation'
import type { PurchaseOrder } from '../src/types'

/**
 * The supplier's page, in a real browser, answering once (owner, 12 Oct 2026: PPN SEAFOOD's
 * confirmation of PO-00005 reached the bell five times). The page is the real one; its
 * /api/supplier calls are answered in this process by the real handlers over an in-memory
 * store, so nothing leaves the machine and every request the page makes is counted.
 */

// A fake signing key for the link (>= 32 chars), not a credential.
const SECRET = 'e'.repeat(40)
const NOW = bkkAtTime(bkkDayStart(Date.now()), '10:00')
const day = (n: number) => bkkDayStart(NOW) + n * DAY_MS

/** The supplier endpoints in this process, over an in-memory store, with one PO linked. */
async function server() {
  let n = 0
  const db = memoryServerStore({
    users: { staff1: { name: 'Nok', role: 'staff', active: true }, boss: { name: 'Boss', role: 'manager', active: true } },
    purchaseOrders: {
      po5: {
        docNo: 'PO-00005',
        supplierId: 'ppn',
        supplierName: 'PPN SEAFOOD',
        status: 'ordered',
        locationId: 'main',
        orderedAt: NOW,
        expectedAt: day(2),
        lines: [{ productId: 'p1', productName: 'กุ้งขาว', unit: 'kg', orderedQty: 5 }],
        sentBy: 'staff1',
        createdBy: 'staff1',
        createdByName: 'Nok',
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
  })
  const deps: Deps = {
    store: db,
    secret: SECRET,
    now: () => Date.now(),
    makeId: () => `e${++n}`,
    verifyUser: async (h) => h?.replace(/^Bearer /, '') ?? null,
    origin: 'http://localhost:5176',
  }
  const token = (await mintLink(deps, 'Bearer staff1', { brand: 'pizza', poId: 'po5' })).body.token as string
  const posts: string[] = []
  let loseNextResponse = false
  const notes = (kind: string) => [...db.data.keys()].filter((k) => k.startsWith(`notifications/${kind}__`))

  /** Point a page (a phone) at this server. */
  async function attach(page: Page) {
    // The supplier page is its own entry (supplier.html); production maps /supplier/po/* to it.
    await page.route('**/supplier/po/**', async (route) => {
      const html = await (await fetch('http://localhost:5176/supplier.html')).text()
      await route.fulfill({ status: 200, contentType: 'text/html', body: html })
    })
    await page.route('**/api/supplier/**', async (route) => {
      const req = route.request()
      const t = decodeURIComponent(new URL(req.url()).pathname.split('/').pop()!)
      if (req.method() === 'POST') {
        posts.push(req.postData() ?? '')
        await new Promise((r) => setTimeout(r, 400)) // a slow phone network: room for a second tap
        const r = await answerLink(deps, t, JSON.parse(req.postData() ?? '{}'))
        if (loseNextResponse) {
          loseNextResponse = false
          return route.abort('failed') // write succeeded; this phone never gets its response
        }
        return route.fulfill({ status: r.status, json: r.body })
      }
      const r = await viewLink(deps, t)
      return route.fulfill({ status: r.status, json: r.body })
    })
  }
  async function approveFarDate() {
    const view = (await viewLink(deps, token)).body.view as { expectedState: string }
    await answerLink(deps, token, { action: 'propose', date: msToDateKey(day(6)), requestId: 'e2e-approved-date', expectedState: view.expectedState })
    const po = db.data.get('purchaseOrders/po5')!.doc as unknown as PurchaseOrder
    expect((await decideDate(deps, 'Bearer boss', { brand: 'pizza', poId: 'po5', changeId: po.pendingDeliveryDate!.changeId, decision: 'approve' })).status).toBe(200)
  }
  return { token, posts, notes, attach, approveFarDate, loseResponse: () => { loseNextResponse = true }, order: () => db.data.get('purchaseOrders/po5')!.doc as unknown as PurchaseOrder }
}

test.use({ viewport: { width: 390, height: 844 } })

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close()
})

test('the supplier confirms once: a double tap sends one answer, and the page does not offer it again', async ({ page }) => {
  const { token, posts, notes, attach } = await server()
  await attach(page)
  await page.goto(`/supplier/po/${token}`)
  const confirm = page.getByRole('button', { name: /^✅ ยืนยันส่งวันที่/ })
  await expect(confirm).toBeVisible()

  // Two taps in the same frame, before React can re-render the button as disabled.
  await confirm.evaluate((b: HTMLButtonElement) => {
    b.click()
    b.click()
  })
  await expect(page.getByText(/^บันทึกวันส่ง .* เรียบร้อย/)).toBeVisible()
  expect(posts).toHaveLength(1)
  expect(notes('supplierConfirmed')).toHaveLength(1)

  // Done: the page says so instead of offering the same button again, also after a reload.
  await expect(confirm).toHaveCount(0)
  await expect(page.getByText(/^✅ ยืนยันส่งวันที่ .* แล้ว$/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/^✅ ยืนยันส่งวันที่ .* แล้ว$/)).toBeVisible()
  await expect(confirm).toHaveCount(0)

  // Picking the agreed date again is pointed out and cannot be sent; a different one can.
  await page.getByRole('button', { name: /เลือกวันส่งอื่น/ }).click()
  const send = page.getByRole('button', { name: 'ยืนยันวันที่เลือก' })
  await expect(page.getByText('วันที่นี้ยืนยันไว้แล้ว เลือกวันอื่นหากต้องการเปลี่ยน')).toBeVisible()
  await expect(send).toBeDisabled()
  await page.locator('input[type="date"]').fill(msToDateKey(day(3)))
  await expect(send).toBeEnabled()
  await send.click()
  await expect(page.getByText(/^บันทึกวันส่ง .* เรียบร้อย/)).toBeVisible()
  expect(posts).toHaveLength(2)
  expect(notes('supplierDateChanged')).toHaveLength(1)
  expect(notes('supplierConfirmed')).toHaveLength(1)
  // The page still fits a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a stale second device must refresh, then sees the existing confirmation in English', async ({ page, browser }) => {
  const { token, posts, notes, attach } = await server()
  await attach(page)
  await page.goto(`/supplier/po/${token}`)
  await expect(page.getByRole('button', { name: /^✅ ยืนยันส่งวันที่/ })).toBeVisible()

  // Another phone answers while this page sits open.
  const other = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const phone2 = await other.newPage()
  await attach(phone2)
  await phone2.goto(`/supplier/po/${token}`)
  await phone2.getByRole('button', { name: /^✅ ยืนยันส่งวันที่/ }).click()
  await expect(phone2.getByText(/^บันทึกวันส่ง .* เรียบร้อย/)).toBeVisible()
  await other.close()

  // A new request against the old view is a conflict, even for the same date.
  await page.getByRole('button', { name: 'EN' }).click()
  const accept = page.getByRole('button', { name: /^✅ Accept / })
  await accept.click()
  await expect(page.getByRole('alert')).toContainText('This order has changed')
  await expect(accept).toBeDisabled()
  expect(posts).toHaveLength(2)
  await page.getByRole('button', { name: 'Refresh order' }).click()
  await expect(page.getByText(/^✅ Delivery on .* confirmed$/)).toBeVisible()
  expect(posts).toHaveLength(2) // refresh never resubmits
  expect(notes('supplierConfirmed')).toHaveLength(1)
})

test('a lost response retries the exact request and state once, without a second notification', async ({ page }) => {
  const s = await server()
  await s.attach(page)
  await page.goto(`/supplier/po/${s.token}`)
  const accept = page.getByRole('button', { name: /^✅ ยืนยันส่งวันที่/ })
  await expect(accept).toBeVisible()
  s.loseResponse()
  await accept.click()
  await expect(page.getByRole('alert')).toContainText('เชื่อมต่อไม่ได้')
  await accept.click()
  await expect(page.getByText(/^บันทึกวันส่ง .* เรียบร้อย/)).toBeVisible()
  expect(s.posts).toHaveLength(2)
  expect(JSON.parse(s.posts[1])).toEqual(JSON.parse(s.posts[0]))
  expect(s.notes('supplierConfirmed')).toHaveLength(1)
  expect(s.order().deliveryDateHistory!.filter((h) => h.source === 'supplier')).toHaveLength(1)
})

test('an unseen pending proposal survives a stale phone; refresh permits intentional return to approved C', async ({ page, browser }) => {
  const s = await server()
  await s.approveFarDate()
  await s.attach(page)
  await page.goto(`/supplier/po/${s.token}`)
  await expect(page.getByText('วันส่งที่ยืนยัน', { exact: true })).toBeVisible()
  // Since PO-00003 (22 Oct 2026) an approved date offers no "confirm the requested date": this
  // phone starts an explicit change instead, unaware of the other phone.
  await expect(page.getByRole('button', { name: /^✅ ยืนยันส่งวันที่/ })).toHaveCount(0)
  await page.getByRole('button', { name: /ขอเปลี่ยนวันส่งอีกครั้ง/ }).click()
  await page.locator('input[type="date"]').fill(msToDateKey(day(3)))
  const oldAccept = page.getByRole('button', { name: 'ยืนยันวันที่เลือก' })
  const other = await browser.newContext({ viewport: { width: 375, height: 812 } })
  try {
    const phone2 = await other.newPage()
    await s.attach(phone2)
    await phone2.goto(`/supplier/po/${s.token}`)
    await phone2.getByRole('button', { name: /ขอเปลี่ยนวันส่งอีกครั้ง/ }).click()
    await phone2.locator('input[type="date"]').fill(msToDateKey(day(7)))
    await phone2.getByRole('button', { name: 'ยืนยันวันที่เลือก' }).click()
    await expect(phone2.getByText(/^ส่งคำขอเลื่อนเป็นวันที่/)).toBeVisible()
    const before = structuredClone(s.order())
    await oldAccept.click()
    await expect(page.getByRole('alert')).toContainText('ใบสั่งซื้อนี้เปลี่ยนแล้ว')
    await expect(oldAccept).toBeDisabled()
    expect(s.order()).toEqual(before)
    expect(s.notes('supplierDatePending')).toHaveLength(2)
    const postCount = s.posts.length
    await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }).click()
    await expect(page.getByText('วันที่ขอเลื่อน', { exact: true })).toBeVisible()
    expect(s.posts).toHaveLength(postCount)
    if (!(await page.locator('input[type="date"]').isVisible())) await page.getByRole('button', { name: /ขอเปลี่ยนวันส่งอีกครั้ง/ }).click()
    await page.locator('input[type="date"]').fill(msToDateKey(day(6)))
    await expect(page.getByText('วันที่นี้เกินช่วงที่ตกลง จะต้องรอฝ่ายจัดซื้ออนุมัติก่อน')).toHaveCount(0)
    await page.getByRole('button', { name: 'ยืนยันวันที่เลือก' }).click()
    await expect(page.getByText(/^บันทึกวันส่ง .* เรียบร้อย/)).toBeVisible()
    expect(s.order().pendingDeliveryDate).toBeUndefined()
    expect(s.order().confirmedDeliveryDate).toBe(day(6))
    expect(s.notes('supplierDatePending')).toHaveLength(2)
    expect(s.notes('supplierDateChanged')).toHaveLength(1)
    expect(s.order().deliveryDateHistory!.slice(-2).map((h) => h.action)).toEqual(['superseded', 'autoApplied'])
  } finally {
    await other.close()
  }
})
