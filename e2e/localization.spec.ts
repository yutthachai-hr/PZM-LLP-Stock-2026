import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { putMany } from './emulator'
import { PASSWORD, PEOPLE, seedStage } from './fixture'
import { EN } from '../src/i18n/en'

const EVIDENCE = process.env.I18N_EVIDENCE_DIR
const brands = [
  { id: 'pizza', prefix: '', name: 'Pizza Mania' },
  { id: 'lelapin', prefix: 'lelapin__', name: 'Le Lapin Sandwich Delivery' },
  { id: 'rnd', prefix: 'rnd__', name: 'R&D (Research & Development)' },
] as const
const routes = [
  ['/', '', 'หน้าแรก'], ['/products', 'สินค้าคงคลัง', 'ทะเบียนสินค้า'], ['/orders', 'สั่งซื้อ', 'สั่งซื้อ'],
  ['/requests', 'รายการขอสั่งซื้อ', 'รายการขอสั่งซื้อ'], ['/transfers', 'ขนส่ง/โอนสาขา', 'ระบบส่งสินค้า'],
  ['/calendar', 'ปฏิทินคลัง', 'ปฏิทินคลัง'], ['/announcements', 'ประกาศบริษัท', 'ประกาศบริษัท'],
  ['/settings', 'ตั้งค่า', 'ตั้งค่า'], ['/reports', 'รายงาน', 'รายงาน'],
] as const

async function stage() {
  const { uid } = await seedStage()
  const now = Date.now()
  await putMany(brands.flatMap(b => [
    { path: `${b.prefix}locations/wh`, data: { name: 'Test Warehouse', type: 'warehouse', active: true, createdAt: now } },
    { path: `${b.prefix}products/flour`, data: { name: 'FLOUR', sku: 'DRY-01-001', category: 'Dry', unit: 'KG', unitType: 'KG', minStock: 5, active: true, createdAt: now, updatedAt: now } },
    { path: `${b.prefix}suppliers/sup1`, data: { name: 'E2E SUPPLIER', active: true, createdAt: now, updatedAt: now } },
    { path: `${b.prefix}stockLevels/wh__flour`, data: { locationId: 'wh', productId: 'flour', qty: 1, updatedAt: now } },
    { path: `${b.prefix}purchaseOrders/po1`, data: {
      docNo: 'PO-00014', supplierId: 'sup1', supplierName: 'E2E SUPPLIER', status: 'ordered', locationId: 'wh',
      orderedAt: now, expectedAt: now, lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10 }],
      createdBy: uid.manager, createdByName: 'ยกเลิก', createdAt: now, updatedAt: now,
    } },
  ]))
}

async function language(page: Page, lang: 'th' | 'en', mobile: boolean) {
  const current = await page.evaluate(() => localStorage.getItem('pmstock:lang') ?? 'th')
  if (current === lang) return
  if (mobile) {
    await page.goto('/more')
    await page.getByRole('button', { name: current === 'th' ? /ภาษา.*TH/ : /Language.*EN/ }).click()
  } else {
    await page.getByRole('button', { name: current === 'th' ? 'เปลี่ยนเป็นภาษาอังกฤษ' : EN['เปลี่ยนเป็นภาษาไทย'], exact: true }).click()
  }
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pmstock:lang'))).toBe(lang)
}

async function artwork(page: Page, lang: 'th' | 'en') {
  const button = page.getByRole('button', { name: lang === 'th' ? 'แชร์ LINE' : 'Share to LINE', exact: true })
  await expect(button).toBeEnabled()
  const img = button.locator('img')
  await expect(img).toHaveAttribute('src', `/brand/line/share-${lang}.png`)
  await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true)
  const box = await img.boundingBox()
  expect(box?.width).toBe(68)
  expect(box?.height).toBe(30)
  expect(await img.evaluate(el => getComputedStyle(el).objectFit)).toBe('contain')
}

for (const b of brands) for (const mobile of [false, true]) for (const who of ['manager', 'staffA'] as const) {
  test(`${b.id} ${mobile ? 'mobile' : 'desktop'} ${who}: TH → EN → TH across operational UI`, async ({ browser }) => {
    test.setTimeout(180_000)
    await stage()
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } })
    try {
      const page = await context.newPage()
      const remoteWrites: string[] = []
      await page.route('**/*', route => {
        const request = route.request()
        const url = new URL(request.url())
        if (['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue()
        if (!['GET', 'HEAD'].includes(request.method())) remoteWrites.push(`${request.method()} ${url.origin}`)
        return route.abort()
      })
      await page.addInitScript(() => {
        if (!localStorage.getItem('pmstock:lang')) localStorage.setItem('pmstock:lang', 'th')
        // This test must never open LINE or write to the OS clipboard.
        Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => {
          const w = window as unknown as { __i18nCaption: string; __finishDigest?: () => void }
          w.__i18nCaption = text
          await new Promise<void>(resolve => { w.__finishDigest = resolve })
        } }, configurable: true })
      })
      await page.goto('/')
      await page.getByRole('textbox', { name: /email|อีเมล/i }).fill(PEOPLE[who].email)
      await page.locator('input[type="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
      await page.getByRole('button', { name: b.name, exact: true }).click()
      await expect(page.locator('main')).toBeVisible()

      for (const lang of ['th', 'en', 'th'] as const) {
        await language(page, lang, mobile)
        for (const [path, title, mobileTitle] of routes) {
          // Navigate within the app without resetting persisted UI language.
          await page.evaluate(path => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
          await expect(page.locator('main')).toBeVisible()
          if (mobile) await expect(page.getByRole('banner').getByText(lang === 'en' ? EN[mobileTitle] : mobileTitle, { exact: true })).toBeVisible()
          if (title) {
            // The PageHero heading is intentionally hidden on phones; their banner is the visible page title.
            const heading = page.locator('main').getByRole('heading', { name: lang === 'en' ? EN[title] : title, exact: true, includeHidden: mobile }).first()
            if (mobile) await expect(heading).toHaveText(lang === 'en' ? EN[title] : title)
            else await expect(heading).toBeVisible()
          } else if (who === 'manager') await artwork(page, lang)
          else await expect(page.getByRole('button', { name: /^(แชร์ LINE|Share to LINE)$/ })).toHaveCount(0)
          if (path === '/products') await expect(page.locator('main').getByText('FLOUR', { exact: true }).filter({ visible: true }).first()).toBeVisible()
          if (path === '/orders') await expect(page.locator('main').getByText('PO-00014', { exact: true }).filter({ visible: true }).first()).toBeVisible()
          if (lang === 'en') {
            const leaks = await page.locator('main').evaluate(root => {
              const out: string[] = []
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
              while (walker.nextNode()) {
                const node = walker.currentNode
                const text = node.textContent?.trim() ?? ''
                const parent = node.parentElement
                if (!parent || !parent.checkVisibility() || !/[\u0e00-\u0e3e\u0e40-\u0e7f]/.test(text)) continue
                // Stored actor name and native language name, not translatable UI copy.
                if (text === 'ยกเลิก' || text === 'ไทย') continue
                out.push(text)
              }
              return out
            })
            expect(leaks, `${b.id} ${who} ${path}: untranslated UI text`).toEqual([])
          }
          if (EVIDENCE && path === '/' && who === 'manager') {
            mkdirSync(EVIDENCE, { recursive: true })
            await page.screenshot({ path: `${EVIDENCE}/${b.id}-${mobile ? '390' : '1440'}-${lang}.png` })
          }
        }
      }
      if (who === 'manager') {
        await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')) })
        for (const lang of ['th', 'en'] as const) {
          await language(page, lang, mobile)
          if (mobile) await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')) })
          await artwork(page, lang)
          await page.getByRole('button', { name: lang === 'th' ? 'แชร์ LINE' : 'Share to LINE', exact: true }).click()
          const busy = page.getByRole('button', { name: lang === 'th' ? 'กำลังเปิด LINE...' : EN['กำลังเปิด LINE...'], exact: true })
          await expect(busy).toBeDisabled()
          await expect(busy.locator('img')).toHaveAttribute('src', `/brand/line/share-${lang}-grey.png`)
          await expect.poll(() => page.evaluate(() => (window as unknown as { __i18nCaption?: string }).__i18nCaption)).toContain(lang === 'en' ? 'Daily summary' : 'สรุปประจำวัน')
          const caption = await page.evaluate(() => (window as unknown as { __i18nCaption: string }).__i18nCaption)
          expect(caption).toContain('FLOUR')
          expect(caption).toContain('/products')
          if (!mobile && lang === 'th') {
            const readState = () => page.evaluate(() => (window as unknown as { __pzmReads: { tally: () => { total: number; listeners: { active: number; bootstraps: number } } } }).__pzmReads.tally())
            const before = await readState()
            await language(page, 'en', false)
            await expect(page.getByRole('button', { name: EN['กำลังเปิด LINE...'], exact: true }).locator('img')).toHaveAttribute('src', '/brand/line/share-en-grey.png')
            await language(page, 'th', false)
            await expect(busy).toBeDisabled()
            const after = await readState()
            expect(after.listeners.active).toBe(before.listeners.active)
            expect(after.listeners.bootstraps).toBe(before.listeners.bootstraps)
            expect(after.total).toBe(before.total)
          }
          await page.evaluate(() => (window as unknown as { __finishDigest: () => void }).__finishDigest())
          await artwork(page, lang)
        }
      }
      expect(remoteWrites).toEqual([])
    } finally { await context.close() }
  })
}
