// Smart supplier resolution in the demo app (early release, Phase 2): receive without a PO,
// add SAUSAGE MIX DOLCE and confirm the supplier fills itself, labelled, with no write made.
//
//   (demo dev server running)  node scripts/capture-supplier-resolution.mjs [--url http://localhost:5178]
//   → docs/evidence/supplier-resolution/*.png + result.json
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const BASE = arg('--url', 'http://localhost:5178')
const OUT = path.resolve('docs/evidence/supplier-resolution')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => localStorage.setItem('pmstock:lang', 'th'))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

// A fresh demo device: reset seeds the catalogue and signs in as the demo admin.
await page.goto(BASE + '/')
await page.getByRole('button', { name: 'รีเซ็ตข้อมูลเดโม' }).click()
// The reset reloads the page once it has signed in; wait until the sign-in screen is gone.
await page.getByRole('button', { name: 'รีเซ็ตข้อมูลเดโม' }).waitFor({ state: 'detached', timeout: 120_000 })
await page.waitForLoadState('networkidle')

await page.goto(BASE + '/receive')
await page.waitForLoadState('networkidle')
// The demo admin sees every brand: take Pizza Mania (the SAUSAGE MIX DOLCE catalogue).
await page.getByRole('button', { name: 'Pizza Mania', exact: true }).click()
await page.waitForLoadState('networkidle')
await page.getByText('รับนอกใบสั่งซื้อ').first().click()
await page.waitForTimeout(300)
const search = page.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)')
await search.fill('SAUSAGE MIX DOLCE')
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, '1-search.png') })
await page.getByRole('button', { name: /SAUSAGE MIX DOLCE/ }).first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: path.join(OUT, '2-auto-picked.png'), fullPage: true })

const body = await page.locator('main').innerText()
const result = {
  at: new Date().toISOString(),
  autoLabelShown: body.includes('เลือกให้อัตโนมัติจากสินค้าที่เลือก'),
  // The product name also says LADER, so the label (not the name) is the evidence.
  conflictBanner: body.includes('ผู้ขายไม่ตรงกัน'),
  pageErrors: errors,
}
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 1))
await browser.close()
