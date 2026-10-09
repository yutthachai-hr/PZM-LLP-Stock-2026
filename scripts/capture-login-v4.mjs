import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const OUT_DIR = path.resolve('docs/evidence/login-v3-qa')
fs.mkdirSync(OUT_DIR, { recursive: true })

async function run() {
  const browser = await chromium.launch()

  // 1. Desktop 1440x900 capture & video (Version A: Clean background)
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  })
  const page = await context.newPage()
  await page.goto('http://localhost:5175')
  await page.waitForLoadState('networkidle')

  // Reset demo session if any to ensure clean unauthenticated sign-in view
  await page.evaluate(() => localStorage.removeItem('pmstock:v1:session'))
  await page.reload()
  await page.waitForLoadState('networkidle')

  // 1440x900 - Pizza Mania
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT_DIR, 'v4-1440x900-pizza.png') })

  // Switch to Le Lapin
  const lelapinBtn = page.getByRole('radio', { name: /Le Lapin/i })
  await lelapinBtn.hover()
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(OUT_DIR, 'v4-hover-lelapin.png') })
  await lelapinBtn.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT_DIR, 'v4-1440x900-lelapin.png') })

  // Switch to R&D
  const rndBtn = page.getByRole('radio', { name: /R&D/i })
  await rndBtn.hover()
  await page.waitForTimeout(200)
  await rndBtn.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT_DIR, 'v4-1440x900-rnd.png') })

  // Test form values preservation
  await page.getByRole('textbox', { name: /email|อีเมล/i }).fill('manager@kitchen.test')
  await page.locator('input[type="password"]').fill('secret123')
  await page.getByRole('radio', { name: /Pizza Mania/i }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT_DIR, 'v4-form-preserved.png') })

  // Test expanded demo panel
  const summary = page.locator('summary')
  if (await summary.count() > 0) {
    await summary.click()
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(OUT_DIR, 'v4-demo-expanded.png') })
    await summary.click()
  }

  await context.close()

  // 2. Desktop 1440x900: Version B (Ambient Background Experiment)
  const ambContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const ambPage = await ambContext.newPage()
  await ambPage.goto('http://localhost:5175?ambient=1')
  await ambPage.waitForLoadState('networkidle')
  await ambPage.waitForTimeout(300)
  await ambPage.screenshot({ path: path.join(OUT_DIR, 'v4-ambient-1440x900-pizza.png') })

  await ambPage.getByRole('radio', { name: /Le Lapin/i }).click()
  await ambPage.waitForTimeout(300)
  await ambPage.screenshot({ path: path.join(OUT_DIR, 'v4-ambient-1440x900-lelapin.png') })

  await ambPage.getByRole('radio', { name: /R&D/i }).click()
  await ambPage.waitForTimeout(300)
  await ambPage.screenshot({ path: path.join(OUT_DIR, 'v4-ambient-1440x900-rnd.png') })
  await ambContext.close()

  // 3. Desktop 1920x1080 (Full HD)
  const fhdContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const fhdPage = await fhdContext.newPage()
  await fhdPage.goto('http://localhost:5175')
  await fhdPage.waitForLoadState('networkidle')
  await fhdPage.screenshot({ path: path.join(OUT_DIR, 'v4-1920x1080-pizza.png') })
  await fhdPage.getByRole('radio', { name: /Le Lapin/i }).click()
  await fhdPage.waitForTimeout(300)
  await fhdPage.screenshot({ path: path.join(OUT_DIR, 'v4-1920x1080-lelapin.png') })
  await fhdPage.getByRole('radio', { name: /R&D/i }).click()
  await fhdPage.waitForTimeout(300)
  await fhdPage.screenshot({ path: path.join(OUT_DIR, 'v4-1920x1080-rnd.png') })
  await fhdContext.close()

  // 4. Short Desktop Viewports: 1366x768 & 1366x650
  const shortContext = await browser.newContext({ viewport: { width: 1366, height: 650 } })
  const shortPage = await shortContext.newPage()
  await shortPage.goto('http://localhost:5175')
  await shortPage.waitForLoadState('networkidle')
  await shortPage.screenshot({ path: path.join(OUT_DIR, 'v4-1366x650-pizza.png') })
  await shortContext.close()

  const laptopContext = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const laptopPage = await laptopContext.newPage()
  await laptopPage.goto('http://localhost:5175')
  await laptopPage.waitForLoadState('networkidle')
  await laptopPage.screenshot({ path: path.join(OUT_DIR, 'v4-1366x768-pizza.png') })
  await laptopPage.getByRole('radio', { name: /Le Lapin/i }).click()
  await laptopPage.waitForTimeout(300)
  await laptopPage.screenshot({ path: path.join(OUT_DIR, 'v4-1366x768-lelapin.png') })
  await laptopPage.getByRole('radio', { name: /R&D/i }).click()
  await laptopPage.waitForTimeout(300)
  await laptopPage.screenshot({ path: path.join(OUT_DIR, 'v4-1366x768-rnd.png') })
  await laptopContext.close()

  // 5. Tablet: 768x1024
  const tabContext = await browser.newContext({ viewport: { width: 768, height: 1024 } })
  const tabPage = await tabContext.newPage()
  await tabPage.goto('http://localhost:5175')
  await tabPage.waitForLoadState('networkidle')
  await tabPage.screenshot({ path: path.join(OUT_DIR, 'v4-768x1024-pizza.png') })
  await tabPage.getByRole('radio', { name: /R&D/i }).click()
  await tabPage.waitForTimeout(300)
  await tabPage.screenshot({ path: path.join(OUT_DIR, 'v4-768x1024-rnd.png') })
  await tabContext.close()

  // 6. Mobile: 375x812 & 390x844
  const m375Context = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const m375Page = await m375Context.newPage()
  await m375Page.goto('http://localhost:5175')
  await m375Page.waitForLoadState('networkidle')
  await m375Page.screenshot({ path: path.join(OUT_DIR, 'v4-375x812-pizza.png') })
  await m375Page.getByRole('radio', { name: /Le Lapin/i }).click()
  await m375Page.waitForTimeout(300)
  await m375Page.screenshot({ path: path.join(OUT_DIR, 'v4-375x812-lelapin.png') })
  await m375Page.getByRole('radio', { name: /R&D/i }).click()
  await m375Page.waitForTimeout(300)
  await m375Page.screenshot({ path: path.join(OUT_DIR, 'v4-375x812-rnd.png') })
  await m375Context.close()

  const m390Context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const m390Page = await m390Context.newPage()
  await m390Page.goto('http://localhost:5175')
  await m390Page.waitForLoadState('networkidle')
  await m390Page.screenshot({ path: path.join(OUT_DIR, 'v4-390x844-rnd.png') })
  await m390Context.close()

  await browser.close()
  console.log('Successfully captured all Login V4 refinement screenshots and video.')
}

run().catch(console.error)
