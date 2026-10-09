// A note for each item on a purchase request (owner, 9 Oct 2026), from both tabs of the picker:
// typed while adding, shown on the line in the request.
//
//   (demo dev server running)  node scripts/capture-request-item-notes.mjs [--url http://localhost:5180]
//   → docs/evidence/request-item-notes/*.png + result.json
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const BASE = arg('--url', 'http://localhost:5180')
const OUT = path.resolve('docs/evidence/request-item-notes')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => localStorage.setItem('pmstock:lang', 'th'))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(BASE + '/')
await page.getByRole('button', { name: 'รีเซ็ตข้อมูลเดโม' }).click()
await page.getByRole('button', { name: 'รีเซ็ตข้อมูลเดโม' }).waitFor({ state: 'detached', timeout: 120_000 })
await page.goto(BASE + '/requests/new')
await page.getByRole('button', { name: 'Pizza Mania', exact: true }).click()
await page.waitForLoadState('networkidle')

// Supplier tab: pick the first supplier that has products, key a quantity, the note appears.
await page.getByRole('tab', { name: 'ผู้ขาย' }).or(page.getByRole('button', { name: 'ผู้ขาย', exact: true })).first().click()
const select = page.locator('select').filter({ hasText: '— เลือกผู้ขาย —' }).first()
const options = await select.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean))
let row
for (const v of options) {
  await select.selectOption(v)
  row = page.locator('li').filter({ has: page.getByRole('spinbutton', { name: 'จำนวน' }) }).first()
  if (await row.count()) break
}
const product = (await row.locator('.truncate').first().innerText()).trim()
await row.getByRole('spinbutton', { name: 'จำนวน' }).fill('3')
const note = row.getByRole('textbox', { name: `หมายเหตุของ "${product}"` })
await note.fill('ส่งก่อน 10 โมง')
await page.screenshot({ path: path.join(OUT, '1-supplier-tab-note.png') })
await note.press('Enter')
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(OUT, '2-in-request.png') })
const lineNote = await page.getByRole('textbox', { name: `หมายเหตุของ "${product}"` }).last().inputValue()

const result = { at: new Date().toISOString(), product, noteOnLine: lineNote, ok: lineNote === 'ส่งก่อน 10 โมง', pageErrors: errors }
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 1))
await browser.close()
