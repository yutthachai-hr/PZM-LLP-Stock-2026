// The top bar's global search in the demo app (early release, Phase 3): Ctrl+K, grouped
// results, keyboard navigation, Escape closing only the results, and a deep link.
//
//   (demo dev server running)  node scripts/capture-global-search.mjs [--url http://localhost:5179]
//   → docs/evidence/global-search/*.png + result.json
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const BASE = arg('--url', 'http://localhost:5179')
const OUT = path.resolve('docs/evidence/global-search')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const result = { at: new Date().toISOString() }

async function session(viewport, lang) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript((l) => localStorage.setItem('pmstock:lang', l), lang)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE + '/')
  await page.getByRole('button', { name: lang === 'th' ? 'รีเซ็ตข้อมูลเดโม' : 'Reset demo data' }).click()
  await page.getByRole('button', { name: lang === 'th' ? 'รีเซ็ตข้อมูลเดโม' : 'Reset demo data' }).waitFor({ state: 'detached', timeout: 120_000 })
  await page.getByRole('button', { name: 'Pizza Mania', exact: true }).click()
  await page.waitForLoadState('networkidle')
  return { ctx, page, errors }
}

// Desktop, Thai: Ctrl+K from anywhere, a product query, a page query, keyboard + Escape.
{
  const { ctx, page, errors } = await session({ width: 1440, height: 900 }, 'th')
  await page.getByRole('combobox').waitFor()
  await page.locator('main').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+k')
  const box = page.getByRole('combobox')
  result.ctrlKFocuses = await box.evaluate((el) => el === document.activeElement)
  await box.fill('sausage')
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(OUT, '1440-th-product.png') })
  await box.fill('รับ')
  await page.waitForTimeout(250)
  result.groupsForRap = await page.locator('#topbar-results [role=presentation] > div[role=presentation]').allInnerTexts()
  await page.screenshot({ path: path.join(OUT, '1440-th-pages.png') })
  await page.keyboard.press('ArrowDown')
  result.activeAfterDown = await page.locator('[role=option][aria-selected=true]').innerText()
  await page.keyboard.press('Escape')
  // (type=search: the browser also clears the text on Escape, as the box always did.)
  result.escapeClosesResults = (await page.locator('#topbar-results').count()) === 0
  await box.fill('sausage')
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/products\/.+\/card/)
  result.enterDeepLink = new URL(page.url()).pathname
  result.pageErrorsTh = errors
  await ctx.close()
}

// Phone, English: the search opens over the bar.
{
  const { ctx, page, errors } = await session({ width: 390, height: 844 }, 'en')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('combobox').fill('order')
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(OUT, '390-en-pages.png') })
  result.pageErrorsEn = errors
  await ctx.close()
}

fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 1))
await browser.close()
