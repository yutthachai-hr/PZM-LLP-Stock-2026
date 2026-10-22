import { test, expect, type Page } from '@playwright/test'

/**
 * P0 (owner, 22 Oct 2026): "ส่ง PO เข้า LINE บนมือถือ/แท็บเล็ต บางครั้งกดแล้วไม่ไป".
 *
 * The share sheet (and LIFF's picker, which opens a window outside LINE) only works while the
 * tap that asked for it is still "active". The stub below enforces exactly that, using the
 * browser's own `navigator.userActivation`, so a send that spends the tap on rendering,
 * uploading or writing before it shares fails here the way it fails on a slow phone.
 *
 * Demo mode, browser storage, synthetic orders. No LIFF id on localhost, so the web-share
 * provider is the one under test; LIFF outcomes are covered in tests/share-provider.test.ts.
 */
type ShareLog = { calls: number; active: boolean[]; fail: number; texts: string[] }

async function stage(page: Page, opts: { orders?: Record<string, Record<string, unknown>>; slowRenderMs?: number } = {}) {
  page.on('pageerror', (e) => console.error('Browser error:', e.message))
  if (opts.slowRenderMs) {
    // The sheet renderer is a lazily loaded chunk; on a phone's first send it arrives over the
    // mobile network. Holding it back is a slow first send, deterministically.
    await page.route(/html2canvas/, async (route) => {
      await new Promise((r) => setTimeout(r, opts.slowRenderMs))
      await route.continue()
    })
  }
  await page.addInitScript(
    ({ orders }) => {
      const w = window as unknown as { __share: ShareLog; __shareFailNext?: number }
      w.__share = { calls: 0, active: [], fail: 0, texts: [] }
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: { title?: string; text?: string }) => {
          const log = w.__share
          log.calls++
          const active = navigator.userActivation?.isActive ?? false
          log.active.push(active)
          if (!active) throw new DOMException('Must be handling a user gesture to perform a share request.', 'NotAllowedError')
          if ((w.__shareFailNext ?? 0) > 0) {
            w.__shareFailNext!--
            log.fail++
            throw new DOMException('Share failed', 'DataError')
          }
          log.texts.push(data.text ?? data.title ?? '')
        },
      })
      if (localStorage.getItem('line-send-fixture')) return
      localStorage.setItem('line-send-fixture', '1')
      const now = Date.now(), day = 86_400_000
      const user = { id: 'send-user', email: 'demo@inventory-pzm.local', name: 'Send QA', role: 'admin', active: true, createdAt: now }
      const store = (name: string, rows: Record<string, unknown>) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
      store('users', { [user.id]: user })
      localStorage.setItem('pmstock:v1:session', user.id)
      localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
      store('locations', { wh: { id: 'wh', name: 'Main Warehouse', active: true, type: 'warehouse', createdAt: now } })
      store('suppliers', { sup: { id: 'sup', name: 'QA SUPPLIER', active: true, type: 'takingReturn', createdAt: now } })
      store('products', { flour: { id: 'flour', sku: 'F-001', name: 'FLOUR', unit: 'KG', unitType: 'KG', minStock: 0, active: true, createdAt: now } })
      const line = (i: number) => ({ productId: `p${i}`, productName: `ITEM ${i}`, unit: 'KG', orderedQty: i + 1, receivedQty: 0 })
      const base = (id: string, docNo: string, extra: Record<string, unknown> = {}) => ({
        id, docNo, supplierId: 'sup', supplierName: 'QA SUPPLIER', locationId: 'wh', status: 'ordered',
        orderedAt: now - day, expectedAt: now + day, lines: [line(0)], createdBy: user.id, createdByName: user.name,
        createdAt: now - day, updatedAt: now - day, ...extra,
      })
      store('purchaseOrders', orders ?? {
        po1: base('po1', 'PO-LS-001'),
        big: base('big', 'PO-LS-002', { lines: Array.from({ length: 45 }, (_, i) => line(i)), orderedAt: now - day - 1000 }),
      })
    },
    { orders: opts.orders },
  )
  await page.goto('/orders')
  await expect(page.locator('main').getByText('QA SUPPLIER', { exact: true }).filter({ visible: true }).first()).toBeVisible()
}

const row = (page: Page, id: string) => page.locator(`[data-row-key="${id}"]:visible`)
const shareLog = (page: Page) => page.evaluate(() => (window as unknown as { __share: ShareLog }).__share)
const stored = (page: Page, id: string) =>
  page.evaluate((id) => JSON.parse(localStorage.getItem('pmstock:v1:purchaseOrders') ?? '{}')[id] as Record<string, unknown>, id)
const orderCount = (page: Page) => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('pmstock:v1:purchaseOrders') ?? '{}')).length)

async function openWizard(page: Page, id: string) {
  await row(page, id).getByRole('button', { name: /^ส่ง (PO|LINE)/ }).first().click()
  return page.getByRole('dialog')
}

test('a slow first render does not spend the tap: the share opens with the gesture still active', async ({ page }) => {
  await stage(page, { slowRenderMs: 6_500 })
  const wizard = await openWizard(page, 'po1')
  const share = wizard.getByRole('button', { name: 'แชร์รูป' })
  // Ready only once the picture exists; then the tap goes straight to the share sheet.
  await expect(share).toBeEnabled({ timeout: 30_000 })
  await share.click()
  await expect(wizard.getByText('ส่งใน LINE เรียบร้อยหรือไม่?')).toBeVisible()
  const log = await shareLog(page)
  expect(log.active).toEqual([true])
  expect((await stored(page, 'po1')).shareStatus).toBe('shareOpened')
})

test('the share sheet opening is not proof of delivery: only the person confirms it', async ({ page }) => {
  await stage(page)
  const wizard = await openWizard(page, 'po1')
  await wizard.getByRole('button', { name: 'แชร์รูป' }).click()
  await expect(wizard.getByText('ส่งใน LINE เรียบร้อยหรือไม่?')).toBeVisible()
  expect((await stored(page, 'po1')).shareStatus).toBe('shareOpened')
  expect((await shareLog(page)).texts[0]).toContain('PO-LS-001')
  await wizard.getByRole('button', { name: 'ส่งแล้ว', exact: true }).click()
  await expect.poll(async () => (await stored(page, 'po1')).shareStatus).toBe('sent')
})

test('a failed share offers retry, download, copy and later; retrying never makes a second order', async ({ page }) => {
  await stage(page)
  const before = await orderCount(page)
  await page.evaluate(() => ((window as unknown as { __shareFailNext: number }).__shareFailNext = 1))
  const wizard = await openWizard(page, 'po1')
  await wizard.getByRole('button', { name: 'แชร์รูป' }).click()
  const recovery = wizard.getByRole('group', { name: 'ส่งไม่สำเร็จ' })
  await expect(recovery).toBeVisible()
  expect((await stored(page, 'po1')).shareStatus).toBe('failed')

  const download = page.waitForEvent('download')
  await recovery.getByRole('button', { name: 'ดาวน์โหลดรูป' }).click()
  expect((await download).suggestedFilename()).toBe('PO-LS-001.jpg')
  // Spy on the clipboard (WebKit has no grantable clipboard permission in automation).
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void ((window as unknown as { __copied: string }).__copied = t) } })
  })
  await recovery.getByRole('button', { name: 'คัดลอกข้อความ' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '')).toContain('PO-LS-001')

  await recovery.getByRole('button', { name: 'ลองอีกครั้ง' }).click()
  await expect(wizard.getByText('ส่งใน LINE เรียบร้อยหรือไม่?')).toBeVisible()
  expect((await shareLog(page)).active).toEqual([true, true])
  expect(await orderCount(page)).toBe(before)
  expect((await stored(page, 'po1')).shareStatus).toBe('shareOpened')
})

test('"continue later" keeps the order where it was', async ({ page }) => {
  await stage(page)
  await page.evaluate(() => ((window as unknown as { __shareFailNext: number }).__shareFailNext = 1))
  const wizard = await openWizard(page, 'po1')
  await wizard.getByRole('button', { name: 'แชร์รูป' }).click()
  await wizard.getByRole('group', { name: 'ส่งไม่สำเร็จ' }).getByRole('button', { name: 'ไว้ส่งทีหลัง' }).click()
  await expect(wizard).toBeHidden()
  expect((await stored(page, 'po1')).shareStatus).toBe('failed')
})

test('a double tap on share opens one share sheet', async ({ page }) => {
  await stage(page)
  const wizard = await openWizard(page, 'po1')
  const share = wizard.getByRole('button', { name: 'แชร์รูป' })
  await expect(share).toBeEnabled()
  await share.dblclick()
  await expect(wizard.getByText('ส่งใน LINE เรียบร้อยหรือไม่?')).toBeVisible()
  expect((await shareLog(page)).calls).toBe(1)
})

test('back from LINE after the page was reloaded: it asks whether it went, instead of starting over', async ({ page }) => {
  await stage(page)
  let wizard = await openWizard(page, 'po1')
  await wizard.getByRole('button', { name: 'แชร์รูป' }).click()
  await expect(wizard.getByText('ส่งใน LINE เรียบร้อยหรือไม่?')).toBeVisible()
  // The phone dropped the page while LINE was in front (common on iOS for a home-screen app).
  await page.reload()
  wizard = await openWizard(page, 'po1')
  await expect(wizard.getByText('ส่งใน LINE เรียบร้อยหรือไม่?')).toBeVisible()
  await wizard.getByRole('button', { name: 'ส่งแล้ว', exact: true }).click()
  await expect.poll(async () => (await stored(page, 'po1')).shareStatus).toBe('sent')
  expect((await shareLog(page)).calls).toBe(0) // the reload reset the stub; nothing was re-shared
})

test('a two-page order resumes at the page not yet shared after a reload', async ({ page }) => {
  await stage(page)
  let wizard = await openWizard(page, 'big')
  await expect(wizard.getByText('รูปที่ 1 จาก 2')).toBeVisible()
  await wizard.getByRole('button', { name: 'แชร์รูป' }).click()
  await expect(wizard.getByText('รูปที่ 2 จาก 2')).toBeVisible()
  await page.reload()
  wizard = await openWizard(page, 'big')
  await expect(wizard.getByText('รูปที่ 2 จาก 2')).toBeVisible()
})

test('reload during an unresolved share with a failed opened write asks, never silently resends', async ({ page }) => {
  await stage(page)
  const wizard = await openWizard(page, 'po1')
  await expect(wizard.getByRole('button', { name: 'แชร์รูป' })).toBeEnabled()
  await page.evaluate(() => {
    const save = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'pmstock:v1:purchaseOrders') throw new DOMException('quota', 'QuotaExceededError')
      save.call(this, key, value)
    }
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => {
      ;(window as unknown as { __share: ShareLog }).__share.calls++
      return new Promise<void>(() => {})
    } })
  })
  await wizard.getByRole('button', { name: 'แชร์รูป' }).click()
  await expect.poll(async () => (await shareLog(page)).calls).toBe(1)
  await page.reload()
  const resumed = await openWizard(page, 'po1')
  await expect(resumed.getByText('ส่งใน LINE เรียบร้อยหรือไม่?', { exact: true })).toBeVisible()
  expect((await shareLog(page)).calls).toBe(0)
  expect(await orderCount(page)).toBe(2)
})

test('reload on an uncertain first page asks about that page, not the whole multi-page PO', async ({ page }) => {
  await stage(page)
  const wizard = await openWizard(page, 'big')
  await expect(wizard.getByRole('button', { name: 'แชร์รูป' })).toBeEnabled()
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: () => new Promise<void>(() => {}) }))
  await wizard.getByRole('button', { name: 'แชร์รูป' }).click()
  await expect.poll(async () => (await stored(page, 'big')).shareStatus).toBe('shareOpened')
  await page.reload()
  const resumed = await openWizard(page, 'big')
  await expect(resumed.getByText('ส่งใน LINE เรียบร้อยหรือไม่?', { exact: true })).toBeVisible()
  await resumed.getByRole('button', { name: 'ส่งแล้ว', exact: true }).click()
  await expect(resumed.getByText('รูปที่ 2 จาก 2', { exact: true })).toBeVisible()
  expect((await stored(page, 'big')).shareStatus).not.toBe('sent')
  expect((await shareLog(page)).calls).toBe(0)
})

test('a persisted confirmed-delivery receipt offers status-only recovery, never another share', async ({ page }) => {
  await stage(page)
  // Synthetic persisted SDK-confirmed receipt, not a real LINE delivery or physical-device test.
  await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('pmstock:v1:purchaseOrders')!).po1
    const fp = JSON.stringify([o.id, o.revision ?? 0, o.expectedAt ?? 0, o.note ?? '', o.lines.map((l: { productId: string; orderedQty: number; unit: string }) => [l.productId, l.orderedQty, l.unit])])
    localStorage.setItem('pmstock:v1:send-progress', JSON.stringify({ 'pizza:send-user:po1': { page: 0, at: Date.now(), fp, attempt: { page: 0, version: 1, confirmed: true } } }))
  })
  await page.reload()
  const wizard = await openWizard(page, 'po1')
  await expect(wizard.getByText('LINE ส่งแล้ว แต่บันทึกสถานะไม่สำเร็จ', { exact: true })).toBeVisible()
  await expect(wizard.getByRole('button', { name: 'แชร์รูป' })).toBeDisabled()
  await wizard.getByRole('button', { name: 'บันทึกสถานะอีกครั้ง' }).click()
  await expect.poll(async () => (await stored(page, 'po1')).shareStatus).toBe('sent')
  expect((await shareLog(page)).calls).toBe(0)
  expect(await orderCount(page)).toBe(2)
})

test('a brand switch while the LIFF picker is open cannot stamp another brand sent', async ({ page }) => {
  // Wizard contract stub only: no real LIFF login, image upload, chat or supplier message.
  await page.route('**/src/share/index.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    export { statusFor } from '/src/share/PurchaseShareProvider.ts';
    export async function pickShareProvider() {
      return { id: 'line-liff', label: 'ส่ง LINE', needsHosting: false,
        share: () => new Promise(resolve => { window.__finishPicker = resolve; }) };
    }
  ` }))
  await stage(page)
  const wizard = await openWizard(page, 'po1')
  await expect(wizard.getByRole('button', { name: 'ส่ง LINE', exact: true })).toBeEnabled()
  await wizard.getByRole('button', { name: 'ส่ง LINE', exact: true }).click()
  await expect.poll(async () => (await stored(page, 'po1')).shareStatus).toBe('shareOpened')
  await page.evaluate(async () => {
    const orders = JSON.parse(localStorage.getItem('pmstock:v1:purchaseOrders')!)
    localStorage.setItem('pmstock:v1:lelapin__purchaseOrders', JSON.stringify(orders))
    const path = '/src/brand/brand.ts'
    const brand = await import(/* @vite-ignore */ path)
    brand.setActiveBrand('lelapin')
    ;(window as unknown as { __finishPicker: (o: string) => void }).__finishPicker('sent')
  })
  await expect(wizard.getByText('LINE ส่งแล้ว แต่บันทึกสถานะไม่สำเร็จ', { exact: true }).or(wizard.getByText('ส่งครบทุกรายแล้ว', { exact: true }))).toBeVisible()
  expect((await stored(page, 'po1')).shareStatus).not.toBe('sent')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pmstock:v1:lelapin__purchaseOrders')!).po1.shareStatus)).not.toBe('sent')
})

test('the tap only shares: tap-to-share stays short on a slow phone CPU', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CPU throttling needs the Chromium DevTools protocol')
  await stage(page, {
    orders: undefined,
  })
  await page.addInitScript(() => {
    document.addEventListener('pointerdown', () => ((window as unknown as { __tap: number }).__tap = performance.now()), true)
  })
  await page.reload()
  const wizard = await openWizard(page, 'big')
  const share = wizard.getByRole('button', { name: 'แชร์รูป' })
  await expect(share).toBeEnabled({ timeout: 30_000 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 })
  await page.evaluate(() => {
    const real = navigator.share.bind(navigator)
    Object.defineProperty(navigator, 'share', { configurable: true, value: (d: ShareData) => {
      ;(window as unknown as { __at: number }).__at = performance.now()
      return real(d)
    } })
  })
  await share.click()
  await expect(wizard.getByText('รูปที่ 2 จาก 2')).toBeVisible({ timeout: 60_000 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const ms = await page.evaluate(() => (window as unknown as { __at: number }).__at - (window as unknown as { __tap: number }).__tap)
  // R36 measurement before this change: 10.3 s at 8x for 30 lines, all of it inside the tap.
  expect(ms).toBeLessThan(1_000)
})

// R38 review, finding A: progress belongs to the order as it was, and to the person sending it.
async function sharePageOne(page: Page) {
  const wizard = await openWizard(page, 'big')
  await expect(wizard.getByText('รูปที่ 1 จาก 2')).toBeVisible()
  await wizard.getByRole('button', { name: 'แชร์รูป' }).click()
  await expect(wizard.getByText('รูปที่ 2 จาก 2')).toBeVisible()
}

test('an order amended while it is being sent goes back to page 1', async ({ page }) => {
  await stage(page)
  await sharePageOne(page)
  const wizard = page.getByRole('dialog')
  // The app's own live-update event (data/useSupplierRefresh.ts), as when an amendment or a
  // supplier answer arrives while the page is open.
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('pmstock:v1:purchaseOrders')!)
    const next = { ...all.big, revision: 1, updatedAt: Date.now(), lines: all.big.lines.map((l: { orderedQty: number }, i: number) => (i === 0 ? { ...l, orderedQty: 99 } : l)) }
    window.dispatchEvent(new CustomEvent('pzm:order-updated', { detail: next }))
  })
  await expect(wizard.getByText('รูปที่ 1 จาก 2')).toBeVisible()
  await expect(page.getByText('ใบสั่งซื้อถูกแก้ไขระหว่างส่ง — เริ่มส่งใหม่ที่รูปที่ 1')).toBeVisible()
  // The sheet now shows the amended line, and that is what the next tap shares.
  await expect(wizard.locator('#send-sheet')).toContainText('99')
})

test('a status-only update during a multi-page send keeps the page', async ({ page }) => {
  await stage(page)
  await sharePageOne(page)
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('pmstock:v1:purchaseOrders')!)
    window.dispatchEvent(new CustomEvent('pzm:order-updated', { detail: { ...all.big, supplierConfirmationStatus: 'waiting', updatedAt: Date.now() } }))
  })
  await page.waitForTimeout(500)
  await expect(page.getByRole('dialog').getByText('รูปที่ 2 จาก 2')).toBeVisible()
})

test('another person on the same device starts at page 1', async ({ page }) => {
  await stage(page)
  await sharePageOne(page)
  await page.evaluate(() => {
    const users = JSON.parse(localStorage.getItem('pmstock:v1:users')!)
    users['other-user'] = { ...users['send-user'], id: 'other-user', name: 'Other QA' }
    localStorage.setItem('pmstock:v1:users', JSON.stringify(users))
    localStorage.setItem('pmstock:v1:session', 'other-user')
  })
  await page.reload()
  const wizard = await openWizard(page, 'big')
  await expect(wizard.getByText('รูปที่ 1 จาก 2')).toBeVisible()
})

// R38 review, finding B: a status write that fails while the share sheet is open is not a failed send.
test('a status write that fails during the share does not mark the order failed', async ({ page }) => {
  await stage(page)
  await page.addInitScript(() => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if ((window as unknown as { __blockOrders?: boolean }).__blockOrders && /^pmstock:v1:purchaseOrders$/.test(key)) throw new DOMException('quota', 'QuotaExceededError')
      return real.call(this, key, value)
    }
  })
  await page.reload()
  const wizard = await openWizard(page, 'po1')
  const share = wizard.getByRole('button', { name: 'แชร์รูป' })
  await expect(share).toBeEnabled()
  await page.evaluate(() => ((window as unknown as { __blockOrders: boolean }).__blockOrders = true))
  await share.click()
  await expect(wizard.getByText('ส่งใน LINE เรียบร้อยหรือไม่?')).toBeVisible()
  await expect(wizard.getByRole('group', { name: 'ส่งไม่สำเร็จ' })).toHaveCount(0)
  expect((await stored(page, 'po1')).shareStatus).toBeUndefined()
  // The person confirms while writes still fail: the question stays, nothing is lost.
  await wizard.getByRole('button', { name: 'ส่งแล้ว', exact: true }).click()
  await expect(wizard.getByText('ส่งใน LINE เรียบร้อยหรือไม่?')).toBeVisible()
  await page.evaluate(() => ((window as unknown as { __blockOrders: boolean }).__blockOrders = false))
  await wizard.getByRole('button', { name: 'ส่งแล้ว', exact: true }).click()
  await expect.poll(async () => (await stored(page, 'po1')).shareStatus).toBe('sent')
  expect((await shareLog(page)).calls).toBe(1)
})
