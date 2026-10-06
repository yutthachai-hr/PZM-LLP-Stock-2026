import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { seedStage } from './fixture'
import { open, signedIn } from './app'

/** Plan C exit gate: axe finds nothing serious or critical on the five main pages. */
const PAGES = ['/', '/products', '/receive', '/orders', '/inbox']

test('axe: no serious or critical violations on the main pages', async ({ browser }) => {
  test.setTimeout(120_000)
  await seedStage()
  const page = await signedIn(browser, 'manager')
  const found: Record<string, string[]> = {}
  for (const path of PAGES) {
    await open(page, path)
    await page.waitForTimeout(800)
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    if (bad.length) found[path] = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  }
  test.info().annotations.push({ type: 'axe', description: JSON.stringify(found) })
  expect(found).toEqual({})
})
