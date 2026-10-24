import { test, expect, type Page } from '@playwright/test'
import * as path from 'node:path'
import * as fs from 'node:fs'

const VIEWPORTS = [
  { width: 320, height: 600, label: '320' },
  { width: 375, height: 667, label: '375' },
  { width: 390, height: 844, label: '390' },
  { width: 414, height: 896, label: '414' },
  { width: 768, height: 1024, label: '768' },
  { width: 1024, height: 768, label: '1024' },
  { width: 1440, height: 900, label: '1440' },
]

const SCREENS = [
  { name: 'TransferDetail', path: '/transfers/tr-001' },
  { name: 'TransferReceive', path: '/transfers/tr-001/receive' },
  {
    name: 'POReceive',
    path: '/receive',
    action: async (page: Page) => {
      const poBtn = page.getByRole('button', { name: /จากใบสั่งซื้อ|PO/i }).first()
      if (await poBtn.isVisible().catch(() => false)) await poBtn.click()
    },
  },
  {
    name: 'ManualReceive',
    path: '/receive',
    action: async (page: Page) => {
      const manBtn = page.getByRole('button', { name: /รับตรง|ไม่มี PO|manual/i }).first()
      if (await manBtn.isVisible().catch(() => false)) await manBtn.click()
    },
  },
  { name: 'Issue', path: '/issue' },
  { name: 'StockCount', path: '/counts/br__2026-10' },
  {
    name: 'Barcode',
    path: '/receive',
    action: async (page: Page) => {
      const scanBtn = page.locator('button[aria-label*="สแกน"], button:has-text("สแกนบาร์โค้ด")').first()
      if (await scanBtn.isVisible().catch(() => false)) await scanBtn.click()
    },
  },
  { name: 'Requests', path: '/requests/pr-001' },
  { name: 'Orders', path: '/orders' },
  { name: 'Notifications', path: '/announcements' },
  {
    name: 'Modals_BottomSheet',
    path: '/',
    action: async (page: Page) => {
      const plus = page.locator('nav.fixed.bottom-0 button[aria-label="ทำรายการ"]')
      if (await plus.isVisible().catch(() => false)) {
        await plus.click()
        await page.waitForSelector('[role="dialog"]').catch(() => {})
      }
    },
  },
]

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'docs/mission/r72/screenshots')

export async function stage(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear()
    const now = Date.now()
    const store = (name: string, rows: Record<string, unknown>) =>
      localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))

    const user = {
      id: 'transit-user',
      email: 'demo@inventory-pzm.local',
      name: 'Transit QA สมชาย สายลุย',
      role: 'admin',
      active: true,
      createdAt: now,
    }
    store('users', { 'transit-user': user })
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
    localStorage.setItem('pmstock:lang', 'th')

    store('locations', {
      wh: { id: 'wh', name: 'คลังสินค้าหลัก Main Warehouse', type: 'warehouse', active: true, createdAt: now },
      br: { id: 'br', name: 'สาขาทองหล่อ Thonglor Branch', type: 'branch', active: true, createdAt: now + 1 },
      transit: { id: 'transit', name: 'ระหว่างขนส่ง (Transit)', type: 'transit', active: true, createdAt: now + 2 },
    })

    const products: Record<string, unknown> = {}
    const transferItems: unknown[] = []
    for (let i = 1; i <= 21; i++) {
      const id = `p${i}`
      const sku = `TH-BKK-WH1-SKU-${String(i).padStart(4, '0')}-EXTRA-LONG-SPEC`
      const name =
        i === 1
          ? 'แป้งสาลีอเนกประสงค์เกรดพรีเมียมตรานกพิราบ 100% Organic Unbleached All-Purpose Flour (Extra Fine Mill)'
          : i === 2
            ? 'ไส้กรอกหมูรมควันสไตล์เวียนนาดั้งเดิม Smoked Vienna Pork Sausages with Natural Sheep Casing'
            : `วัตถุดิบทดสอบรายการที่ ${i} Long Product Name Description For Testing Responsive Viewport Overflows Item ${i}`
      const unit = i % 2 === 0 ? 'KG' : 'Pack'
      const cost = +(25.5 + i * 1.25).toFixed(2)
      products[id] = {
        id,
        sku,
        name,
        category: i <= 5 ? 'Dry' : i <= 10 ? 'Chilled' : i <= 15 ? 'Frozen' : 'Packaging',
        unit: unit === 'KG' ? 'กิโลกรัม' : 'แพ็ค',
        unitType: unit,
        minStock: 5,
        active: true,
        cost,
        createdAt: now,
        updatedAt: now,
      }
      transferItems.push({
        idx: i - 1,
        productId: id,
        productName: name,
        sku,
        unit,
        dispatchQty: +(i * 1.063).toFixed(3),
        dispatchEntryQty: +(i * 1.063).toFixed(3),
        dispatchEntryUnit: unit,
        requestedQty: +(i * 1.063).toFixed(3),
      })
    }
    store('products', products)

    store('transfers', {
      'tr-001': {
        id: 'tr-001',
        docNo: 'TR-20261025-0001',
        status: 'inTransit',
        revision: 1,
        fromLocationId: 'wh',
        toLocationId: 'br',
        dispatchDate: now,
        requestedBy: user.id,
        requestedByName: user.name,
        note: 'โอนสินค้าด่วนพิเศษสำหรับวันหยุดสุดสัปดาห์ Extra Urgent Weekend Batch Special Handling Required',
        items: transferItems,
        history: [],
        createdAt: now,
        updatedAt: now,
      },
    })

    store('suppliers', {
      'sup-001': {
        id: 'sup-001',
        name: 'บริษัท ฟู๊ดแกลเลอรี่ จำกัด (Food Gallery Co., Ltd.) สาขาใหญ่',
        code: 'V-00001',
        contactNumber: '02-123-4567',
        email: 'order@foodgallery.co.th',
        type: 'takingReturn',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    })

    store('purchaseOrders', {
      'po-001': {
        id: 'po-001',
        docNo: 'PO-20261025-0001',
        supplierId: 'sup-001',
        supplierName: 'บริษัท ฟู๊ดแกลเลอรี่ จำกัด (Food Gallery Co., Ltd.) สาขาใหญ่',
        status: 'ordered',
        locationId: 'wh',
        orderedAt: now,
        expectedAt: now + 86400000,
        lines: [
          {
            productId: 'p1',
            productName:
              'แป้งสาลีอเนกประสงค์เกรดพรีเมียมตรานกพิราบ 100% Organic Unbleached All-Purpose Flour (Extra Fine Mill)',
            unit: 'KG',
            orderedQty: 25.5,
          },
          {
            productId: 'p2',
            productName:
              'ไส้กรอกหมูรมควันสไตล์เวียนนาดั้งเดิม Smoked Vienna Pork Sausages with Natural Sheep Casing',
            unit: 'KG',
            orderedQty: 10.125,
          },
        ],
        createdBy: user.id,
        createdByName: user.name,
        createdAt: now,
        updatedAt: now,
      },
    })

    store('purchaseRequests', {
      'pr-001': {
        id: 'pr-001',
        docNo: 'PR-20261025-0001',
        status: 'pendingApproval',
        revision: 1,
        locationId: 'br',
        note: 'ขอสั่งซื้อวัตถุดิบเร่งด่วนสำหรับสาขาประจำสัปดาห์',
        items: [
          {
            idx: 0,
            productId: 'p1',
            productName:
              'แป้งสาลีอเนกประสงค์เกรดพรีเมียมตรานกพิราบ 100% Organic Unbleached All-Purpose Flour (Extra Fine Mill)',
            sku: 'TH-BKK-WH1-SKU-0001-EXTRA-LONG-SPEC',
            unit: 'KG',
            supplierId: 'sup-001',
            supplierName: 'บริษัท ฟู๊ดแกลเลอรี่ จำกัด (Food Gallery Co., Ltd.) สาขาใหญ่',
            supplierChoice: 'usual',
            requestedQty: 50.25,
          },
        ],
        requestedBy: user.id,
        requestedByName: user.name,
        history: [],
        createdBy: user.id,
        createdByName: user.name,
        createdAt: now,
        updatedAt: now,
      },
    })

    store('monthlyCounts', {
      'br__2026-10': {
        id: 'br__2026-10',
        locationId: 'br',
        month: '2026-10',
        countDate: now,
        status: 'counting',
        lines: {
          p1: { productId: 'p1', unit: 'KG', count: 12.35, countedAt: now, countedBy: user.id },
          p2: { productId: 'p2', unit: 'KG', count: 4.875, countedAt: now, countedBy: user.id },
        },
        createdBy: user.id,
        createdByName: user.name,
        createdAt: now,
        updatedAt: now,
      },
    })

    store('notifications', {
      'n-001': {
        id: 'n-001',
        kind: 'reorder',
        category: 'stock',
        priority: 'normal',
        to: { all: true },
        params: { productName: 'แป้งสาลีอเนกประสงค์เกรดพรีเมียมตรานกพิราบ', count: 1 },
        link: '/products/p1/card',
        active: true,
        readBy: {},
        source: 'client',
        createdBy: 'system',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 86400000,
      },
    })
  })
}

test.describe('Audit Matrix Capture', () => {
  test.setTimeout(300000)

  test('capture before matrix screenshots and geometry data', async ({ page }) => {
    const isAfter = process.env.AUDIT_MODE === 'after'
    const outSubdir = isAfter ? 'after' : 'before'
    const targetDir = path.join(SCREENSHOT_DIR, outSubdir)
    fs.mkdirSync(targetDir, { recursive: true })

    const records: Record<string, unknown>[] = []

    for (const scr of SCREENS) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await stage(page)
        await page.goto(scr.path)
        await page.waitForTimeout(200)

        if (scr.action) {
          try {
            await scr.action(page)
            await page.waitForTimeout(150)
          } catch {
            // sub-action non-blocking
          }
        }

        const metrics = await page.evaluate(() => {
          const docEl = document.documentElement
          const scrollW = docEl.scrollWidth
          const clientW = docEl.clientWidth
          const hasHorizScroll = scrollW > clientW + 1

          const nav = document.querySelector('nav.fixed.bottom-0') as HTMLElement | null
          const plus = nav ? (nav.querySelector('button[aria-label="ทำรายการ"]') as HTMLElement | null) : null
          const fa = document.querySelector('div.sticky.-mx-4') as HTMLElement | null

          const navRect = nav ? nav.getBoundingClientRect() : null
          const plusRect = plus ? plus.getBoundingClientRect() : null
          const faRect = fa ? fa.getBoundingClientRect() : null

          let plusProtrusion = 0
          if (navRect && plusRect) {
            plusProtrusion = Math.max(0, Math.round(navRect.top - plusRect.top))
          }

          let faOverlap = 0
          if (faRect && plusRect) {
            const vOverlap = Math.max(0, Math.round(faRect.bottom - plusRect.top))
            const hOverlap = Math.max(0, Math.min(faRect.right, plusRect.right) - Math.max(faRect.left, plusRect.left))
            if (vOverlap > 0 && hOverlap > 0) {
              faOverlap = vOverlap
            }
          }

          return {
            scrollW,
            clientW,
            hasHorizScroll,
            plusProtrusion,
            faOverlap,
            navHeight: navRect ? Math.round(navRect.height) : null,
            faHeight: faRect ? Math.round(faRect.height) : null,
          }
        })

        const shotFilename = `${scr.name}_${vp.label}.png`
        const shotPath = path.join(targetDir, shotFilename)
        await page.screenshot({ path: shotPath, fullPage: false })

        records.push({
          screen: scr.name,
          width: vp.width,
          label: vp.label,
          metrics,
          screenshotRel: `docs/mission/r72/screenshots/${outSubdir}/${shotFilename}`,
        })
      }
    }

    const dataPath = path.join(SCREENSHOT_DIR, `${outSubdir}-metrics.json`)
    fs.writeFileSync(dataPath, JSON.stringify(records, null, 2), 'utf-8')
    console.log(`[AUDIT] Saved ${records.length} records to ${dataPath}`)
  })
})

// -----------------------------------------------------------------------------
// RED GEOMETRY PROOFS: Exact measurements demonstrating the defects
// -----------------------------------------------------------------------------
test.describe('RED Geometry Proofs (Pre-Fix Baseline)', () => {
  test('PROOF: Floating plus button protrudes 24px above BottomTabBar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stage(page)
    await page.goto('/')

    const nav = page.locator('nav.fixed.bottom-0')
    await expect(nav).toBeVisible()
    const plus = nav.locator('button[aria-label="ทำรายการ"]')
    await expect(plus).toBeVisible()

    const navBox = await nav.boundingBox()
    const plusBox = await plus.boundingBox()

    expect(navBox).not.toBeNull()
    expect(plusBox).not.toBeNull()

    const protrusion = Math.round(navBox!.y - plusBox!.y)
    console.log(`[MEASUREMENT PROOF] BottomTabBar y: ${navBox!.y}, plus y: ${plusBox!.y}, protrusion: ${protrusion}px`)

    // In a correct non-overlapping navigation bar, protrusion above bar must be 0
    // In baseline code, this FAILS because protrusion is 24px / 25px!
    expect(protrusion).toBe(0)
  })

  test('PROOF: Floating plus button overlaps FormActions and sits above it in z-index', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stage(page)
    await page.goto('/transfers/tr-001/receive')

    const formActions = page.locator('div.sticky.-mx-4')
    await expect(formActions).toBeVisible()
    const nav = page.locator('nav.fixed.bottom-0')
    const plus = nav.locator('button[aria-label="ทำรายการ"]')
    await expect(plus).toBeVisible()

    const faBox = await formActions.boundingBox()
    const plusBox = await plus.boundingBox()

    expect(faBox).not.toBeNull()
    expect(plusBox).not.toBeNull()

    const faBottom = faBox!.y + faBox!.height
    const verticalOverlap = Math.max(0, Math.round(faBottom - plusBox!.y))
    console.log(`[MEASUREMENT PROOF] FormActions bottom: ${faBottom}, Plus top: ${plusBox!.y}, Vertical Overlap: ${verticalOverlap}px`)

    // In a correct layout, floating nav button must NOT overlap FormActions (overlap should be 0)
    // In baseline code, this FAILS because overlap is 25px!
    expect(verticalOverlap).toBe(0)

    // FormActions should have explicit z-index (e.g. z-20) to prevent content bleed
    const faZ = await page.evaluate(() => {
      const el = document.querySelector('div.sticky.-mx-4')
      return el ? window.getComputedStyle(el).zIndex : null
    })
    console.log(`[MEASUREMENT PROOF] FormActions z-index: ${faZ}`)
    expect(faZ).toBe('20')
  })

  test('PROOF: Safe-area inset squeezes BottomTabBar content when height is fixed at 4.5rem', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 0, bottom: 34, left: 0, right: 0 },
    })

    await stage(page)
    await page.goto('/')

    const data = await page.evaluate(() => {
      const nav = document.querySelector('nav.fixed.bottom-0') as HTMLElement
      if (!nav) return null
      const cs = window.getComputedStyle(nav)
      const rect = nav.getBoundingClientRect()
      const totalH = rect.height
      const padB = parseFloat(cs.paddingBottom)
      const availableContentH = totalH - padB
      const link = nav.querySelector('a') as HTMLElement
      const linkH = link ? link.getBoundingClientRect().height : 0
      return { totalH, padB, availableContentH, linkH }
    })

    console.log(`[MEASUREMENT PROOF] Safe Area: totalH=${data?.totalH}px, padBottom=${data?.padB}px, availableContentH=${data?.availableContentH}px, linkH=${data?.linkH}px`)

    // Touch targets must be >= 44px high.
    // In baseline code, availableContentH is 42.5px (< 44px), so this FAILS!
    expect(data?.availableContentH).toBeGreaterThanOrEqual(44)
  })

  test('PROOF: FormActions flex-wrap on narrow viewports', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 })
    await stage(page)
    await page.goto('/transfers/tr-001/receive')

    const formActions = page.locator('div.sticky.-mx-4')
    await expect(formActions).toBeVisible()

    const flexWrap = await formActions.evaluate((el) => {
      return window.getComputedStyle(el).flexWrap
    })

    console.log(`[MEASUREMENT PROOF] FormActions flex-wrap: ${flexWrap}`)
    // On responsive forms with multi-element actions, flex-wrap must be 'wrap'
    // In baseline code, this FAILS because it is 'nowrap'!
    expect(flexWrap).toBe('wrap')
  })
})
