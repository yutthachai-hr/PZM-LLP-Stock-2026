import { chromium } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const PORT = 5221
const BASE_URL = `http://localhost:${PORT}`

const items = [
  { name: 'แป้งสาลีตราพิซซ่ามาเนีย สูตรพิเศษสำหรับแป้งบางกรอบ (Premium Pizza Wheat Flour Extra Crisp)', sku: 'PZM-RAW-FLOUR-WHEAT-PREM-001', unit: 'KG', qty: 25 },
  { name: 'ชีสมอสซาเรลล่าขูดเส้นแท้ 100% นำเข้าจากนิวซีแลนด์ (Pure Mozzarella Shredded Cheese NZ)', sku: 'PZM-DAIRY-CHEESE-MOZZ-SHRED-002', unit: 'KG', qty: 1.063 },
  { name: 'TEA', sku: 'T', unit: 'EA', qty: 2 },
  { name: 'EGG', sku: 'E1', unit: 'EA', qty: 10 },
  { name: 'OIL', sku: 'O', unit: 'L', qty: 1 },
  { name: 'ไส้กรอกอิตาเลียนรสเผ็ดสูตรพรีเมียม (Spicy Italian Sausage Crumbles Seasoned)', sku: 'PZM-MEAT-SAUSAGE-ITALIAN-SPICY-005', unit: 'KG', qty: 6.25 },
  { name: 'P', sku: 'P-1', unit: 'EA', qty: 5 },
  { name: 'มะกอกดำสไลซ์ในน้ำเกลือปรุงรส (Black Pitted Olives Sliced in Brine Premium)', sku: 'PZM-VEG-OLIVES-BLACK-SLICED-008', unit: 'KG', qty: 2.25 },
  { name: 'ICE', sku: 'I', unit: 'BAG', qty: 4 },
  { name: 'น้ำมันมะกอกบริสุทธิ์พิเศษสกัดเย็นเกรดพรีเมียม (Extra Virgin Olive Oil Cold Pressed First Harvest)', sku: 'PZM-OIL-OLIVE-EXTRAVIRGIN-COLD-010', unit: 'L', qty: 5 },
  { name: 'Y', sku: 'Y-0', unit: 'G', qty: 50 },
  { name: 'เกลือทะเลบริสุทธิ์เกล็ดละเอียดไม่ผสมไอโอดีน (Pure Fine Natural Sea Salt Non-Iodized)', sku: 'PZM-SPICE-SALT-SEA-FINE-PURE-012', unit: 'KG', qty: 10 },
  { name: 'BOX', sku: 'B-12', unit: 'EA', qty: 50 },
  { name: 'หอมหัวใหญ่สไลซ์แช่เย็นพร้อมใช้ (Fresh White Onions Sliced Ready-To-Cook)', sku: 'PZM-VEG-ONION-WHITE-SLICED-014', unit: 'KG', qty: 7.4 },
  { name: 'PINE', sku: 'P-09', unit: 'CAN', qty: 6 },
  { name: 'แฮมหมูบดปรุงรสรมควันหั่นเต๋า (Smoked Cooked Ham Diced for Pizza Topping)', sku: 'PZM-MEAT-HAM-SMOKED-DICED-016', unit: 'KG', qty: 9.75 },
  { name: 'HAM', sku: 'H-1', unit: 'KG', qty: 1 },
  { name: 'พาร์เมซานชีสป่นแท้บ่ม 12 เดือน (Aged 12-Month Grated Pure Parmesan Cheese)', sku: 'PZM-DAIRY-PARMESAN-GRATED-12M-018', unit: 'KG', qty: 2.5 },
  { name: 'SALT', sku: 'S', unit: 'G', qty: 100 },
  { name: 'กระเทียมสดสับละเอียดในน้ำมันถั่วเหลือง (Fresh Minced Garlic Cloves in Refined Oil)', sku: 'PZM-COND-GARLIC-MINCED-OIL-020', unit: 'KG', qty: 3 },
  { name: 'กล่องพิซซ่าลูกฟูกหนาพิเศษพิมพ์ลายพรีเมียม 12 นิ้ว (Corrugated Pizza Box Premium Printed 12-inch)', sku: 'PZM-PKG-BOX-CORR-PRINT-PREM-12IN-021', unit: 'EA', qty: 100 },
]

const transferItems = items.map((it, idx) => ({
  idx,
  productId: `prod-${idx + 1}`,
  productName: it.name,
  sku: it.sku,
  unit: it.unit,
  requestedQty: it.qty,
  dispatchQty: it.qty,
  inTransitQty: it.qty,
}))

const transferDoc = {
  id: 'TR-INT-998822',
  docNo: 'TR-20261025-8822',
  status: 'inTransit',
  revision: 1,
  fromLocationId: 'wh',
  toLocationId: 'br',
  dispatchDate: Date.now() - 3600000,
  requestedBy: 'user-01',
  requestedByName: 'Logistics Receiver',
  items: transferItems,
  history: [],
  createdAt: Date.now() - 3600000,
  updatedAt: Date.now() - 1800000,
}

const productsMap = {}
items.forEach((it, idx) => {
  productsMap[`prod-${idx + 1}`] = {
    id: `prod-${idx + 1}`,
    sku: it.sku,
    name: it.name,
    unit: it.unit,
    unitType: it.unit,
    category: 'Ingredient',
    active: true,
    minStock: 5,
    cost: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
})

async function initPage(page) {
  await page.addInitScript(({ transferDoc, productsMap }) => {
    const now = Date.now()
    const store = (name, rows) => localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))
    const user = { id: 'logistics-staff', email: 'staff@pzm.local', name: 'Logistics Receiver', role: 'admin', active: true, createdAt: now }
    store('users', { 'logistics-staff': user })
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
    store('locations', {
      wh: { id: 'wh', name: 'Main Kitchen Warehouse (ครัวกลาง)', active: true, type: 'warehouse', createdAt: now },
      br: { id: 'br', name: 'Sarasin Branch (สาขาสารสิน)', active: true, type: 'branch', createdAt: now },
    })
    store('products', productsMap)
    store('transfers', { [transferDoc.id]: transferDoc })
    localStorage.setItem('pmstock:lang', 'th')
  }, { transferDoc, productsMap })
}

export async function runChecks(options = {}) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  await initPage(page)

  const viewports = [320, 360, 375, 390, 414, 430]
  const report = {
    normal: [],
    root200: [],
    decimalTyping: null,
    headerPollution: null,
  }

  const outDir = options.outDir || 'docs/mission/r72/artifacts/reflow'
  fs.mkdirSync(outDir, { recursive: true })

  // 1. Normal font test across all 6 viewports
  for (const w of viewports) {
    await page.setViewportSize({ width: w, height: 750 })
    await page.goto(`${BASE_URL}/transfers/${transferDoc.id}/receive`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.space-y-3', { timeout: 10000 })

    const res = await page.evaluate(() => {
      const computedFont = window.getComputedStyle(document.documentElement).fontSize
      const scrollWidth = document.documentElement.scrollWidth
      const innerWidth = window.innerWidth
      const lineContainer = document.querySelector('.space-y-3.pb-32') || document.querySelector('.space-y-3')
      const firstCard = lineContainer?.firstElementChild
      const checkboxLabel = firstCard?.querySelector('label')
      const cbRect = checkboxLabel?.getBoundingClientRect()
      const buttons = Array.from(firstCard?.querySelectorAll('button') || [])
      const minus = buttons.find(b => b.textContent?.trim() === '−')
      const minusRect = minus?.getBoundingClientRect()
      const plus = buttons.find(b => b.textContent?.trim() === '+')
      const plusRect = plus?.getBoundingClientRect()
      const input = firstCard?.querySelector('input[type="number"]') || document.querySelector('input[type="number"]')
      const inputRect = input?.getBoundingClientRect()
      const inputCS = input ? window.getComputedStyle(input) : null
      const padLeft = inputCS ? parseFloat(inputCS.paddingLeft) : 0
      const padRight = inputCS ? parseFloat(inputCS.paddingRight) : 0
      const borderLeft = inputCS ? parseFloat(inputCS.borderLeftWidth) : 0
      const borderRight = inputCS ? parseFloat(inputCS.borderRightWidth) : 0
      const contentWidth = inputRect ? (inputRect.width - padLeft - padRight - borderLeft - borderRight) : 0

      // Canvas text measurement
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const font = inputCS ? `${inputCS.fontWeight} ${inputCS.fontSize} ${inputCS.fontFamily}` : '18px sans-serif'
      ctx.font = font
      const textMetrics = ctx.measureText('1.063')

      return {
        computedFont,
        scrollWidth,
        innerWidth,
        hasHScroll: scrollWidth > innerWidth,
        overflow: scrollWidth - innerWidth,
        cbSize: cbRect ? { w: Math.round(cbRect.width), h: Math.round(cbRect.height) } : null,
        minusSize: minusRect ? { w: Math.round(minusRect.width), h: Math.round(minusRect.height) } : null,
        plusSize: plusRect ? { w: Math.round(plusRect.width), h: Math.round(plusRect.height) } : null,
        inputSize: inputRect ? { w: Math.round(inputRect.width), h: Math.round(inputRect.height) } : null,
        inputPaddingH: Math.round(padLeft + padRight),
        contentWidth: Math.round(contentWidth * 10) / 10,
        canvasTextWidth: Math.round(textMetrics.width * 10) / 10,
        isClipped: contentWidth < textMetrics.width,
      }
    })
    report.normal.push({ width: w, ...res })
  }

  // 2. ROOT font 200% test across all 6 viewports
  for (const w of viewports) {
    await page.setViewportSize({ width: w, height: 750 })
    await page.goto(`${BASE_URL}/transfers/${transferDoc.id}/receive`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.space-y-3', { timeout: 10000 })

    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    await page.waitForTimeout(150)

    const res = await page.evaluate(() => {
      const computedFont = window.getComputedStyle(document.documentElement).fontSize
      const scrollWidth = document.documentElement.scrollWidth
      const innerWidth = window.innerWidth

      const leafOverflows = []
      document.querySelectorAll('*').forEach(el => {
        if (el.children.length === 0 || Array.from(el.children).every(c => c.getBoundingClientRect().width === 0)) {
          const r = el.getBoundingClientRect()
          if (r.right > innerWidth) {
            leafOverflows.push({
              tag: el.tagName,
              text: el.textContent?.slice(0, 30),
              className: typeof el.className === 'string' ? el.className : '',
              right: Math.round(r.right),
              left: Math.round(r.left),
              width: Math.round(r.width),
            })
          }
        }
      })

      const lineContainer = document.querySelector('.space-y-3.pb-32') || document.querySelector('.space-y-3')
      const firstCard = lineContainer?.firstElementChild
      const checkboxLabel = firstCard?.querySelector('label')
      const cbRect = checkboxLabel?.getBoundingClientRect()
      const buttons = Array.from(firstCard?.querySelectorAll('button') || [])
      const minus = buttons.find(b => b.textContent?.trim() === '−')
      const minusRect = minus?.getBoundingClientRect()
      const plus = buttons.find(b => b.textContent?.trim() === '+')
      const plusRect = plus?.getBoundingClientRect()
      const input = firstCard?.querySelector('input[type="number"]') || document.querySelector('input[type="number"]')
      const inputRect = input?.getBoundingClientRect()
      const inputCS = input ? window.getComputedStyle(input) : null
      const padLeft = inputCS ? parseFloat(inputCS.paddingLeft) : 0
      const padRight = inputCS ? parseFloat(inputCS.paddingRight) : 0
      const borderLeft = inputCS ? parseFloat(inputCS.borderLeftWidth) : 0
      const borderRight = inputCS ? parseFloat(inputCS.borderRightWidth) : 0
      const contentWidth = inputRect ? (inputRect.width - padLeft - padRight - borderLeft - borderRight) : 0

      // Canvas text measurement under root 200%
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const font = inputCS ? `${inputCS.fontWeight} ${inputCS.fontSize} ${inputCS.fontFamily}` : '36px sans-serif'
      ctx.font = font
      const textMetrics = ctx.measureText('1.063')

      return {
        computedFont,
        scrollWidth,
        innerWidth,
        hasHScroll: scrollWidth > innerWidth,
        overflow: scrollWidth - innerWidth,
        leafOverflows,
        cbSize: cbRect ? { w: Math.round(cbRect.width), h: Math.round(cbRect.height) } : null,
        minusSize: minusRect ? { w: Math.round(minusRect.width), h: Math.round(minusRect.height) } : null,
        plusSize: plusRect ? { w: Math.round(plusRect.width), h: Math.round(plusRect.height) } : null,
        inputSize: inputRect ? { w: Math.round(inputRect.width), h: Math.round(inputRect.height) } : null,
        inputPaddingH: Math.round(padLeft + padRight),
        contentWidth: Math.round(contentWidth * 10) / 10,
        canvasTextWidth: Math.round(textMetrics.width * 10) / 10,
        isClipped: contentWidth < textMetrics.width,
      }
    })
    report.root200.push({ width: w, ...res })

    await page.screenshot({ path: path.join(outDir, `green-receive-${w}-root200.png`) })
    if (w === 320 || w === 360) {
      const inputLocator = page.locator('input[type="number"]').nth(1)
      if (await inputLocator.count() > 0) {
        await inputLocator.screenshot({ path: path.join(outDir, `green-input-qty-${w}-root200.png`) })
      }
    }
  }

  // 3. Test sequential typing 1.063 under root 200% at 360px
  await page.setViewportSize({ width: 360, height: 750 })
  await page.goto(`${BASE_URL}/transfers/${transferDoc.id}/receive`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.space-y-3', { timeout: 10000 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await page.waitForTimeout(100)

  // Find second card (item 1: Mozzarella Cheese)
  const cheeseInput = page.locator('input[type="number"]').nth(1)
  await cheeseInput.click()
  await cheeseInput.fill('')
  await cheeseInput.type('1.063', { delay: 30 })
  const finalVal = await cheeseInput.inputValue()
  report.decimalTyping = { expected: '1.063', actual: finalVal, passed: finalVal === '1.063' }

  // 4. Test cross route header pollution:
  // After visiting /transfers/id/receive, navigate to / and check header buttons
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(200)
  const headerCheck = await page.evaluate(() => {
    const headerBtns = Array.from(document.querySelectorAll('header button'))
    const polluted = headerBtns.map(btn => {
      const cs = window.getComputedStyle(btn)
      return {
        text: btn.textContent?.trim().slice(0, 20),
        maxWidth: cs.maxWidth,
        maxHeight: cs.maxHeight,
        isPolluted: cs.maxWidth === '44px' && cs.maxHeight === '44px',
      }
    })
    return {
      hasHeader: headerBtns.length > 0,
      buttons: polluted,
      isPolluted: polluted.some(b => b.isPolluted),
    }
  })
  report.headerPollution = headerCheck

  await browser.close()
  return report
}

if (process.argv[1] && process.argv[1].endsWith('test-font-reflow.mjs')) {
  runChecks().then((res) => {
    console.log(JSON.stringify(res, null, 2))
  }).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
