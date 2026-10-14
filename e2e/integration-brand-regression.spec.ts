import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { putMany } from './emulator'
import { PASSWORD, PEOPLE, seedStage } from './fixture'
import { actualBrandState, backendStarts, observeBackendStarts } from './brandAcceptance'

/**
 * Post-merge regression for the Production report (14 Oct 2026): Le Lapin or R&D picked on
 * the sign-in screen, Pizza Mania opened. A device whose history and stale tab both say
 * another brand signs in with an explicit pick; the brand that opens is checked where it
 * lives — the consumed BrandContext, the data-layer resolver, the palette, the namespace of
 * every backend call from before sign-in, the collections delivered and the data shown.
 */

type BrandId = 'pizza' | 'lelapin' | 'rnd'
const RADIO: Record<BrandId, string> = { pizza: 'Pizza Mania', lelapin: 'Le Lapin Sandwich Delivery', rnd: 'R&D (Research & Development)' }
const ACCENT: Record<BrandId, string> = { pizza: '#b91c1c', lelapin: '#c2410c', rnd: '#003291' }
const ITEM: Record<BrandId, string> = { pizza: 'FLOUR', lelapin: 'BAGUETTE', rnd: 'SUMAC POWDER' }
const SHARED = new Set(['users', 'meta', 'revokedUsers'])
const EVIDENCE = process.env.BRAND_REGRESSION_DIR
const ownerOf = (c: string): BrandId | 'shared' => (SHARED.has(c) ? 'shared' : c.startsWith('lelapin__') ? 'lelapin' : c.startsWith('rnd__') ? 'rnd' : 'pizza')

async function stage() {
  await seedStage()
  const now = Date.now()
  const p = (path: string, name: string, sku: string) => ({
    path,
    data: { sku, name, category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now },
  })
  await putMany([
    { path: 'lelapin__locations/lwh', data: { name: 'Le Lapin Kitchen', type: 'warehouse', active: true, createdAt: now } },
    { path: 'rnd__locations/rwh', data: { name: 'R&D Kitchen', type: 'warehouse', active: true, createdAt: now } },
    p('lelapin__products/baguette', 'BAGUETTE', 'BAK-01-001'),
    p('rnd__products/sumac', 'SUMAC POWDER', 'RND-01-001'),
  ])
}

const delivered = (page: Page) =>
  page.evaluate(() => {
    const t = (window as unknown as { __pzmReads: { tally: () => { stats: { collection: string }[] } } }).__pzmReads.tally()
    return [...new Set(t.stats.map((s) => s.collection))].sort()
  })

const CASES: { pick: BrandId; stale: BrandId; width: number; lang: 'th' | 'en' }[] = [
  { pick: 'pizza', stale: 'lelapin', width: 1440, lang: 'th' },
  { pick: 'lelapin', stale: 'pizza', width: 1440, lang: 'th' },
  { pick: 'rnd', stale: 'pizza', width: 1440, lang: 'en' },
  { pick: 'pizza', stale: 'rnd', width: 390, lang: 'en' },
  { pick: 'lelapin', stale: 'pizza', width: 390, lang: 'en' },
  { pick: 'rnd', stale: 'lelapin', width: 390, lang: 'th' },
]

for (const c of CASES) {
  test(`${c.pick} picked over stale ${c.stale} at ${c.width}px (${c.lang}): context, resolver, theme, namespace and data agree`, async ({ browser }) => {
    await stage()
    const context = await browser.newContext({ viewport: { width: c.width, height: c.width === 390 ? 844 : 900 } })
    // The device's history and a stale tab both say another brand (signed out, not reset).
    await context.addInitScript(({ stale, lang }) => {
      if (sessionStorage.getItem('__seeded')) return
      sessionStorage.setItem('__seeded', '1')
      localStorage.setItem('pmstock:v1:lastBrand', stale)
      sessionStorage.setItem('pmstock:v1:tabBrand', stale)
      localStorage.setItem('pmstock:lang', lang)
    }, { stale: c.stale, lang: c.lang })
    const page = await context.newPage()
    try {
      await page.goto('/')
      const email = page.getByRole('textbox', { name: /email|อีเมล/i })
      await expect(email).toBeVisible()
      await observeBackendStarts(page)
      const radio = page.getByRole('radio', { name: RADIO[c.pick], exact: true }).locator('visible=true').first()
      await radio.click()
      await expect(radio).toHaveAttribute('aria-checked', 'true')
      await email.fill(PEOPLE.admin.email)
      await page.locator('input[type="password"]').fill(PASSWORD)
      await page.getByRole('button', { name: c.lang === 'en' ? 'Sign in' : 'เข้าสู่ระบบ', exact: true }).click()
      await expect(email).toHaveCount(0)
      await expect(page.locator('main')).toBeVisible()

      const own = c.pick === 'pizza' ? 'products' : `${c.pick}__products`
      await expect.poll(async () => {
        const seen = await delivered(page)
        const foreign = seen.filter((x) => ownerOf(x) !== 'shared' && ownerOf(x) !== c.pick)
        return foreign.length ? `foreign: ${foreign.join(',')}` : seen.includes(own) ? 'ok' : 'waiting'
      }, { timeout: 20_000 }).toBe('ok')

      const state = await actualBrandState(page)
      expect(state).toEqual({ context: c.pick, resolver: c.pick, accent: ACCENT[c.pick] })

      const starts = (await backendStarts(page)).filter((s) => !SHARED.has(s.logical))
      expect(starts.length, 'brand-scoped backend calls observed').toBeGreaterThan(0)
      expect(starts[0].resolved === own || ownerOf(starts[0].resolved) === c.pick, `first scoped call ${starts[0].resolved}`).toBe(true)
      const foreignStarts = starts.filter((s) => ownerOf(s.resolved) !== c.pick || s.resolver !== c.pick)
      expect(foreignStarts, 'backend calls against another brand').toEqual([])

      // Dashboard shows the LINE share in the interface's language (PR19), in the picked brand.
      const share = page.getByRole('button', { name: c.lang === 'en' ? 'Share to LINE' : 'แชร์ LINE', exact: true })
      await expect(share.locator('img')).toHaveAttribute('src', new RegExp(`/brand/line/share-${c.lang}(-grey)?\\.png$`))

      const stored = await page.evaluate(() => [localStorage.getItem('pmstock:v1:lastBrand'), sessionStorage.getItem('pmstock:v1:tabBrand')])
      expect(stored).toEqual([c.pick, c.pick])

      const result = { ...c, state, delivered: await delivered(page), firstScopedCall: starts[0], scopedCalls: starts.length, stored }
      if (EVIDENCE) {
        mkdirSync(EVIDENCE, { recursive: true })
        await page.screenshot({ path: `${EVIDENCE}/${c.pick}-${c.width}-${c.lang}-dashboard.png` })
        writeFileSync(`${EVIDENCE}/${c.pick}-${c.width}-${c.lang}.json`, JSON.stringify(result, null, 2))
      }

      // The catalogue is the picked brand's own data, and only that.
      await page.evaluate(() => { history.pushState({}, '', '/products'); dispatchEvent(new PopStateEvent('popstate')) })
      await expect(page.locator('main')).toContainText(ITEM[c.pick])
      const text = await page.locator('main').innerText()
      for (const other of (Object.keys(ITEM) as BrandId[]).filter((b) => b !== c.pick)) expect(text).not.toContain(ITEM[other])
      if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${c.pick}-${c.width}-${c.lang}-products.png` })
    } finally {
      await context.close()
    }
  })
}
