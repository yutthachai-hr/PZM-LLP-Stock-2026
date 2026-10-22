import { expect, test, type Page } from '@playwright/test'
import { memoryServerStore } from '../functions/_lib/memoryStore'
import { answerLink, mintLink, viewLink, type Deps } from '../functions/_lib/supplierPo'
import { bkkAtTime, bkkDayStart, DAY_MS } from '../src/lib/inventoryRules/time'
import { msToDateKey } from '../src/lib/supplierConfirmation'

/**
 * P0 (owner, 21 Oct 2026): Pizza Mania PO-00002's link was opened on 16 Oct and refused as
 * "ลิงก์นี้หมดอายุแล้ว" on 21 Oct. An old link — minted days ago, its signed timestamp long
 * gone, its asked-for date in the past — must still open its open order, say the date has
 * passed, and take a new date under the usual approval rule. Real supplier page in a phone
 * browser with a LINE in-app user agent; /api/supplier answered in this process over an
 * in-memory store. Synthetic order, nothing leaves the machine, no URL is printed.
 */

const SECRET = 'e'.repeat(40) // a fake signing key for the link, not a credential
const TODAY = bkkAtTime(bkkDayStart(Date.now()), '10:00')
const day = (n: number) => bkkDayStart(TODAY) + n * DAY_MS
const LINE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.6.0'

async function oldLink() {
  let clock = day(-5) // the link was sent five days ago…
  let n = 0
  const db = memoryServerStore({
    users: { staff1: { name: 'Nok', role: 'staff', active: true } },
    purchaseOrders: {
      po2: {
        docNo: 'PO-00002', supplierId: 'syn', supplierName: 'SYNTHETIC FOODS', status: 'ordered', locationId: 'main',
        orderedAt: day(-5), expectedAt: day(-3), // …asking for a day that has now gone by
        lines: [{ productId: 'p1', productName: 'มอสซาเรลล่า', unit: 'kg', orderedQty: 10 }],
        sentBy: 'staff1', createdBy: 'staff1', createdByName: 'Nok', createdAt: day(-5), updatedAt: day(-5),
      },
    },
    inventorySchedules: { settings: { supplierLinkTtlDays: 1 } }, // its signed timestamp ran out four days ago
  })
  const deps: Deps = { store: db, secret: SECRET, now: () => clock, makeId: () => `e${++n}`, verifyUser: async (h) => h?.replace(/^Bearer /, '') ?? null, origin: 'http://localhost:5176' }
  const token = (await mintLink(deps, 'Bearer staff1', { brand: 'pizza', poId: 'po2' })).body.token as string
  clock = Date.now()
  const posts: string[] = []
  async function attach(page: Page) {
    await page.route('**/supplier/po/**', async (route) => {
      const html = await (await fetch('http://localhost:5176/supplier.html')).text()
      await route.fulfill({ status: 200, contentType: 'text/html', body: html })
    })
    await page.route('**/api/supplier/**', async (route) => {
      const req = route.request()
      const t = decodeURIComponent(new URL(req.url()).pathname.split('/').pop()!)
      clock = Date.now()
      if (req.method() === 'POST') posts.push(req.postData() ?? '')
      const r = req.method() === 'POST' ? await answerLink(deps, t, JSON.parse(req.postData() ?? '{}')) : await viewLink(deps, t)
      return route.fulfill({ status: r.status, json: r.body })
    })
  }
  return { token, attach, posts, order: () => db.data.get('purchaseOrders/po2')!.doc }
}

test.use({ viewport: { width: 375, height: 812 }, userAgent: LINE_UA })

test('an old link to an open order opens, says the asked date has passed, and takes a new date (TH and EN)', async ({ page }) => {
  const s = await oldLink()
  await s.attach(page)
  await page.goto(`/supplier/po/${s.token}`)

  await expect(page.getByText('PO-00002')).toBeVisible()
  await expect(page.getByText(/หมดอายุ/)).toHaveCount(0)
  await expect(page.getByText(/^วันส่งที่ขอไว้ \(.*\) ผ่านมาแล้ว$/)).toBeVisible()
  // A past date is never confirmed silently: no accept button for it, and the picker starts today.
  await expect(page.getByRole('button', { name: /^✅ ยืนยันส่งวันที่/ })).toHaveCount(0)
  await page.getByRole('button', { name: /เลือกวันส่งอื่น/ }).click()
  const picker = page.locator('input[type="date"]')
  await expect(picker).toHaveValue(msToDateKey(day(0)))
  await expect(picker).toHaveAttribute('min', msToDateKey(day(0)))

  await page.getByRole('button', { name: 'EN' }).click()
  await expect(page.getByText(/^The requested delivery date \(.*\) has passed$/)).toBeVisible()
  await page.getByRole('button', { name: 'ไทย' }).click()

  // Four days after the asked date is beyond the 2-day range: it waits for purchasing.
  await picker.fill(msToDateKey(day(1)))
  await page.getByRole('button', { name: 'ยืนยันวันที่เลือก' }).click()
  await expect(page.getByText(/^ส่งคำขอเลื่อนเป็นวันที่/)).toBeVisible()
  expect(s.posts).toHaveLength(1)
  const o = s.order() as { status: string; requestedDeliveryDate?: number; confirmedDeliveryDate?: number; supplierConfirmationStatus?: string }
  expect(o.status).toBe('ordered')
  expect(o.requestedDeliveryDate).toBe(day(-3))
  expect(o.confirmedDeliveryDate).toBeUndefined()
  expect(o.supplierConfirmationStatus).toBe('pending_date_approval')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
