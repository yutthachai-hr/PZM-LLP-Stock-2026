// The playful brand switch (owner, 9 Oct 2026): prove the icons float, the chosen one pops, a
// hover wiggles, and reduced motion stops all of it; record a short video for the owner.
//
//   (dev server running)  node scripts/capture-brand-switch.mjs [--url http://localhost:5177]
//   → docs/evidence/login-v5/brand-switch.webm + brand-switch.json
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const BASE = arg('--url', 'http://localhost:5177')
const OUT = path.resolve('docs/evidence/login-v5')
fs.mkdirSync(OUT, { recursive: true })

const sample = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role=radio]')]
      .filter((b) => b.offsetParent)
      .map((b) => ({ brand: b.getAttribute('aria-label').split(' ')[0], checked: b.getAttribute('aria-checked'), transform: getComputedStyle(b).transform })),
  )

const browser = await chromium.launch()
const result = {}

// Normal motion, recorded.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  const frames = []
  for (let i = 0; i < 4; i++) {
    frames.push(await sample(page))
    await page.waitForTimeout(400)
  }
  result.floatsOverTime = frames
  // The icons never stop floating, so Playwright never sees them "stable": act with force
  // (a person clicks a 3 px drift without noticing; automated tests need this too).
  const radio = (re) => page.getByRole('radio', { name: re }).locator('visible=true').first()
  await radio(/R&D/).hover({ force: true })
  await page.waitForTimeout(200)
  result.hoverWiggle = await sample(page)
  await radio(/Le Lapin/).click({ force: true })
  await page.waitForTimeout(120)
  result.popMidway = await sample(page)
  await page.waitForTimeout(1200)
  await radio(/R&D/).click({ force: true })
  await page.waitForTimeout(1400)
  await radio(/Pizza/).click({ force: true })
  await page.waitForTimeout(1400)
  const video = page.video()
  await ctx.close()
  fs.renameSync(await video.path(), path.join(OUT, 'brand-switch.webm'))
}

// Reduced motion: nothing moves.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  result.reducedMotion = await sample(page)
  await ctx.close()
}

fs.writeFileSync(path.join(OUT, 'brand-switch.json'), JSON.stringify(result, null, 2))
const moved = new Set(result.floatsOverTime.flat().map((s) => `${s.brand}:${s.transform}`)).size
console.log(JSON.stringify({ distinctTransformsWhileFloating: moved, popMidway: result.popMidway.map((s) => s.transform), reducedMotion: result.reducedMotion.map((s) => s.transform) }, null, 1))
await browser.close()
