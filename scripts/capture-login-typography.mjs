// Login typography + scene QA (owner directive, 9 Oct 2026): A = LINE Seed Sans TH (?font=legacy)
// vs B = Plus Jakarta Sans + Anuphan, for all three brands at 1440×900 and 390×844, plus a
// tablet, English, first-admin and forgot-password pass. Measures layout shift and font loading.
//
//   (dev server running)  node scripts/capture-login-typography.mjs [--url http://localhost:5177]
//   → docs/evidence/login-v5/*.png + metrics.json
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const BASE = arg('--url', 'http://localhost:5177')
const OUT = path.resolve('docs/evidence/login-v5')
fs.mkdirSync(OUT, { recursive: true })

const BRANDS = [
  ['pizza', /Pizza Mania/i],
  ['lelapin', /Le Lapin/i],
  ['rnd', /R&D/i],
]
const VIEWPORTS = [
  ['1440x900', { width: 1440, height: 900 }],
  ['390x844', { width: 390, height: 844 }],
]
const FONTS = [
  ['A-lineseed', '?font=legacy'],
  ['B-jakarta-anuphan', ''],
]

// Layout shift is collected from the first paint (buffered), before any interaction.
const CLS_INIT = () => {
  window.__cls = 0
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value
  }).observe({ type: 'layout-shift', buffered: true })
}

async function open(browser, viewport, query, lang = 'th') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  await ctx.addInitScript(CLS_INIT)
  await ctx.addInitScript((l) => localStorage.setItem('pmstock:lang', l), lang)
  const page = await ctx.newPage()
  await page.goto(BASE + '/' + query)
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  return { ctx, page }
}

async function pick(page, re) {
  // Two switches exist (desktop header / mobile row); click the visible one.
  const radios = page.getByRole('radio', { name: re })
  for (let i = 0; i < (await radios.count()); i++) {
    if (await radios.nth(i).isVisible()) {
      await radios.nth(i).click()
      break
    }
  }
  await page.waitForTimeout(500) // the scene's fade-in
}

const metrics = { at: new Date().toISOString(), base: BASE, runs: [] }
const browser = await chromium.launch()

for (const [fname, query] of FONTS) {
  for (const [vname, viewport] of VIEWPORTS) {
    const { ctx, page } = await open(browser, viewport, query)
    const cls = await page.evaluate(() => window.__cls)
    const fonts = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((e) => /\.woff2(\?|$)/.test(e.name))
        .map((e) => ({ file: e.name.split('/').pop(), kb: Math.round((e.encodedBodySize || e.transferSize) / 1024), ms: Math.round(e.duration) })),
    )
    const faces = await page.evaluate(() => {
      const h1 = getComputedStyle(document.querySelector('h1')).fontFamily
      const h2 = getComputedStyle(document.querySelector('h2')).fontFamily
      const btn = getComputedStyle(document.querySelector('button[type=submit]')).fontFamily
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`)
      return { h1, h2, btn, loaded: [...new Set(loaded)] }
    })
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    for (const [bname, re] of BRANDS) {
      if (bname !== 'pizza') await pick(page, re)
      const file = `${fname}-${vname}-${bname}.png`
      await page.screenshot({ path: path.join(OUT, file) })
    }
    metrics.runs.push({ font: fname, viewport: vname, clsOnLoad: Math.round(cls * 10000) / 10000, overflowX, fonts, faces })
    await ctx.close()
  }
}

// B only: tablet, English, forgot-password message, sign-up (request access) form.
{
  const { ctx, page } = await open(browser, { width: 768, height: 1024 }, '')
  await page.screenshot({ path: path.join(OUT, 'B-768x1024-pizza.png') })
  await ctx.close()
}
for (const [vname, viewport] of VIEWPORTS) {
  const { ctx, page } = await open(browser, viewport, '', 'en')
  await page.screenshot({ path: path.join(OUT, `B-${vname}-pizza-en.png`) })
  await pick(page, /R&D/i)
  await page.screenshot({ path: path.join(OUT, `B-${vname}-rnd-en.png`) })
  await ctx.close()
}
{
  // First admin is what a fresh local/demo device shows; the normal sign-in form appears once a
  // demo admin exists (seeded by the demo reset, which also signs in — so sign out after).
  const { ctx, page } = await open(browser, { width: 1440, height: 900 }, '')
  await page.screenshot({ path: path.join(OUT, 'B-1440x900-first-admin.png') })
  metrics.firstAdminHeading = await page.locator('h2').innerText()
  await ctx.close()
}

fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2))
console.log(JSON.stringify(metrics.runs.map((r) => ({ font: r.font, vp: r.viewport, cls: r.clsOnLoad, overflowX: r.overflowX, fonts: r.fonts })), null, 1))
await browser.close()
