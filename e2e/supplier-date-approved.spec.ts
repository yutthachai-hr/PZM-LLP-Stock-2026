import { expect, test, type Page } from '@playwright/test'
import { memoryServerStore } from '../functions/_lib/memoryStore'
import { answerLink, decideDate, mintLink, viewLink, type Deps } from '../functions/_lib/supplierPo'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import { msToDateKey } from '../src/lib/supplierConfirmation'
import type { PurchaseOrder } from '../src/types'

/**
 * P0 (owner, 22 Oct 2026) — Pizza Mania / MMP / PO-00003: purchasing approved the supplier's
 * 26 Oct, then the supplier's page still offered "confirm 22 Oct" and pressing it undid the
 * approval. The real supplier page in a phone browser (LINE in-app UA); /api/supplier answered
 * in this process over an in-memory store, synthetic orders only. No URL is printed.
 */

const SECRET = 'q'.repeat(40) // a fake signing key for synthetic links, not a credential
const NOW = bkkAtTime(bkkDayStart(Date.now()), '10:00')
const day = (n: number) => bkkDayStart(NOW) + n * DAY_MS
const LINE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.6.0'
const COLLECTION = { pizza: 'purchaseOrders', lelapin: 'lelapin__purchaseOrders', rnd: 'rnd__purchaseOrders' } as const
const COMPANY = { pizza: 'Pizza Mania', lelapin: 'Le Lapin Sandwich Delivery', rnd: 'R&D (Research & Development)' } as const

async function approvedOrder(brand: keyof typeof COLLECTION) {
  let n = 0
  const db = memoryServerStore({
    users: { staff1: { name: 'Nok', role: 'staff', active: true }, boss: { name: 'Boss', role: 'manager', active: true } },
    [COLLECTION[brand]]: {
      po3: {
        docNo: 'PO-00003', supplierId: 'mmp', supplierName: 'MMP', status: 'ordered', locationId: 'main', orderedAt: NOW, expectedAt: day(0), // asked for today ("22 Oct")
        lines: [{ productId: 'p1', productName: 'มอสซาเรลล่า', unit: 'kg', orderedQty: 10 }], sentBy: 'staff1', createdBy: 'staff1', createdByName: 'Nok', createdAt: NOW, updatedAt: NOW,
      },
    },
  })
  const deps: Deps = { store: db, secret: SECRET, now: () => Date.now(), makeId: () => `e${++n}`, verifyUser: async (h) => h?.replace(/^Bearer /, '') ?? null, origin: 'http://localhost:5176' }
  const token = (await mintLink(deps, 'Bearer staff1', { brand, poId: 'po3' })).body.token as string
  const view = (await viewLink(deps, token)).body.view as { expectedState: string }
  await answerLink(deps, token, { action: 'propose', date: msToDateKey(day(4)), name: 'MMP', requestId: 'po3-propose-26', expectedState: view.expectedState }) // "26 Oct", beyond the range
  const order = () => db.data.get(`${COLLECTION[brand]}/po3`)!.doc as unknown as PurchaseOrder
  expect((await decideDate(deps, 'Bearer boss', { brand, poId: 'po3', changeId: order().pendingDeliveryDate!.changeId, decision: 'approve' })).status).toBe(200)
  const posts: string[] = []
  async function attach(page: Page) {
    await page.route('**/supplier/po/**', async (route) => {
      const html = await (await fetch('http://localhost:5176/supplier.html')).text()
      await route.fulfill({ status: 200, contentType: 'text/html', body: html })
    })
    await page.route('**/api/supplier/**', async (route) => {
      const req = route.request()
      const t = decodeURIComponent(new URL(req.url()).pathname.split('/').pop()!)
      if (req.method() === 'POST') posts.push(req.postData() ?? '')
      const r = req.method() === 'POST' ? await answerLink(deps, t, JSON.parse(req.postData() ?? '{}')) : await viewLink(deps, t)
      return route.fulfill({ status: r.status, json: r.body })
    })
  }
  // Purchasing amends the quantity only (owner, 22 Oct 2026): a new link for the revised order.
  async function reviseQty() {
    db.touch(COLLECTION[brand], 'po3', { revision: 1, revisions: [{ rev: 1, at: NOW, by: 'staff1', byName: 'Nok', reason: 'more', changes: [{ kind: 'qty', productName: 'มอสซาเรลล่า', unit: 'kg', from: 10, to: 12 }] }] })
    return (await mintLink(deps, 'Bearer staff1', { brand, poId: 'po3' })).body.token as string
  }
  return { token, attach, posts, order, reviseQty }
}

test.use({ viewport: { width: 375, height: 812 }, userAgent: LINE_UA })

for (const brand of ['pizza', 'lelapin', 'rnd'] as const) {
  test(`${brand}: after purchasing approved the supplier's date, the page shows it as agreed and offers no stale confirm`, async ({ page }) => {
    const s = await approvedOrder(brand)
    await s.attach(page)
    await page.goto(`/supplier/po/${s.token}`)
    await expect(page.getByText(COMPANY[brand])).toBeVisible()
    await expect(page.getByText(/^วันที่ตกลงล่าสุด: /)).toBeVisible()
    await expect(page.getByText('ฝ่ายจัดซื้ออนุมัติแล้ว ไม่ต้องยืนยันซ้ำ')).toBeVisible()
    await expect(page.getByRole('button', { name: /^✅ ยืนยันส่งวันที่/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /ขอเปลี่ยนวันส่งอีกครั้ง/ })).toBeVisible()

    await page.getByRole('button', { name: 'EN' }).click()
    await expect(page.getByText(/^Latest agreed date: /)).toBeVisible()
    await expect(page.getByText('Approved by purchasing — no need to confirm again')).toBeVisible()
    await expect(page.getByRole('button', { name: /^✅ Accept / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Request another delivery date/ })).toBeVisible()
    expect(s.posts).toHaveLength(0)
    expect(s.order().confirmedDeliveryDate).toBe(day(4))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('an explicit request for another date still works and follows the approval rule', async ({ page }) => {
  const s = await approvedOrder('pizza')
  await s.attach(page)
  await page.goto(`/supplier/po/${s.token}`)
  await page.getByRole('button', { name: /ขอเปลี่ยนวันส่งอีกครั้ง/ }).click()
  await page.locator('input[type="date"]').fill(msToDateKey(day(6)))
  await page.getByRole('button', { name: 'ยืนยันวันที่เลือก' }).click()
  await expect(page.getByText(/^ส่งคำขอเลื่อนเป็นวันที่/)).toBeVisible()
  expect(s.posts).toHaveLength(1)
  expect(s.order().supplierConfirmationStatus).toBe('pending_date_approval')
  expect(s.order().confirmedDeliveryDate).toBe(day(4)) // the approved date stands while it waits
})

for (const lang of ['th', 'en'] as const) {
  test(`${lang}: after a quantity-only revision the supplier acknowledges it and the approved date stands`, async ({ page }) => {
    const s = await approvedOrder('pizza')
    const revised = await s.reviseQty()
    expect(s.order()).toMatchObject({ supplierConfirmationStatus: 'waiting', requestedDeliveryDate: day(4), confirmedDeliveryDate: day(4) })
    await s.attach(page)
    await page.goto(`/supplier/po/${revised}`)
    if (lang === 'en') await page.getByRole('button', { name: 'EN' }).click()
    const accept = page.getByRole('button', { name: lang === 'th' ? /^✅ ยืนยันส่งวันที่/ : /^✅ Accept / })
    await expect(accept).toHaveCount(1)
    await accept.click()
    await expect.poll(() => s.order().supplierConfirmationStatus).toBe('confirmed')
    expect(s.posts).toHaveLength(1)
    expect(s.order()).toMatchObject({ confirmedDeliveryDate: day(4), expectedAt: day(4), requestedDeliveryDate: day(4) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
