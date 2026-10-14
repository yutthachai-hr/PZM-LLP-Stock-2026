import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * The sign-in page's brand icons (owner, 12 Oct 2026: "the motion is not visible"). Measured
 * in a real browser, not asserted from CSS text: the logos float visibly and out of step,
 * hover and selection give feedback, the button under the logo never moves (so a normal
 * click lands), and asking the system for less motion stops all of it. No sign-in needed:
 * the page renders before anyone logs in, and no test here writes anything.
 */

const VIEWS = [
  { name: 'desktop 1440', width: 1440, height: 900, hover: true },
  { name: 'tablet 1024', width: 1024, height: 768, hover: true },
  { name: 'phone 390', width: 390, height: 844, hover: false },
  { name: 'phone 375', width: 375, height: 812, hover: false },
]

// Only the switcher on screen is in the accessibility tree (the other is display:none).
const group = (page: Page) => page.getByRole('radiogroup', { name: 'แบรนด์' })
const radios = (page: Page) => group(page).getByRole('radio')
const faces = (page: Page) => group(page).locator('.brand-orb-face')

/** On-screen top of each logo, sampled every 100 ms. */
async function sampleTops(page: Page, ms: number): Promise<number[][]> {
  const out: number[][] = []
  for (let t = 0; t < ms; t += 100) {
    out.push(await faces(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top)))
    await page.waitForTimeout(100)
  }
  return out
}
/** The element's computed transform as { a, b, f } (scale/rotation terms and the Y shift), read in the page. */
const matrixOf = (loc: Locator) =>
  loc.evaluate((e) => {
    const m = new DOMMatrix(getComputedStyle(e).transform)
    return { a: m.a, b: m.b, f: m.f }
  })
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
const track = (s: number[][], k: number) => s.map((row) => row[k])

for (const view of VIEWS) {
  test.describe(view.name, () => {
    test.use({ viewport: { width: view.width, height: view.height } })

    test.beforeEach(async ({ page }) => {
      // ponytail: domcontentloaded + explicit radios count sufficient; avoids window.load stall on keepalive sockets
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await expect(radios(page)).toHaveCount(3)
      // Let the selection pop on first paint finish.
      await page.waitForTimeout(900)
    })

    test('the logos float visibly, out of step, while the buttons stay put', async ({ page }) => {
      await expect(group(page).locator('.brand-orb-float')).toHaveCount(3)
      for (const n of await group(page).locator('.brand-orb-float').evaluateAll((els) => els.map((e) => [getComputedStyle(e).animationName, getComputedStyle(e).animationPlayState]))) {
        expect(n).toEqual(['brand-orb-float', 'running'])
      }
      const boxesBefore = await radios(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
      // A full period of the slowest logo (4.2s): over a shorter window the travel depends on
      // where in its cycle sampling starts, and 2.4s windows measured under 3px at some phases.
      const s = await sampleTops(page, 4400)
      const boxesAfter = await radios(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
      // Each logo travels a visible distance (5px design; at least 3.5px over one period).
      for (let k = 0; k < 3; k++) expect(range(track(s, k)), `logo ${k} travel`).toBeGreaterThan(3.5)
      // Out of step: at some moment two logos are at clearly different heights.
      const maxGap = Math.max(...s.map((row) => Math.max(range([row[0], row[1]]), range([row[1], row[2]]), range([row[0], row[2]]))))
      expect(maxGap, 'stagger between logos').toBeGreaterThan(2.5)
      // The hit areas never moved.
      expect(boxesAfter).toEqual(boxesBefore)
      for (const b of boxesAfter) {
        expect(b.width).toBeGreaterThanOrEqual(44)
        expect(b.height).toBeGreaterThanOrEqual(44)
      }
    })

    test('a normal click selects the brand, and the page follows', async ({ page }) => {
      const lapin = group(page).getByRole('radio', { name: /Le Lapin/ })
      await lapin.click() // no force: the button does not move
      await expect(lapin).toHaveAttribute('aria-checked', 'true')
      await expect(group(page).getByRole('radio', { name: 'Pizza Mania' })).toHaveAttribute('aria-checked', 'false')
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Le Lapin')
      // The pop and the pulse run once on the newly chosen logo, then it rests larger.
      const face = lapin.locator('.brand-orb-face')
      expect(await face.evaluate((e) => getComputedStyle(e).animationName)).toBe('brand-orb-pop')
      expect(await lapin.locator('.brand-orb-pulse').evaluate((e) => getComputedStyle(e).animationName)).toBe('brand-orb-pulse')
      await page.mouse.move(5, view.height - 5) // off the icon: the resting size, not the hover one
      await page.waitForTimeout(900)
      const m = await matrixOf(face)
      expect(m.a).toBeCloseTo(1.06, 2)
      // Still selected after the animation has finished, and R&D can be chosen next.
      await expect(lapin).toHaveAttribute('aria-checked', 'true')
      const rnd = group(page).getByRole('radio', { name: /R&D/ })
      await rnd.click()
      await expect(rnd).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByRole('heading', { level: 1 })).toContainText('R&D')
    })

    test('nothing overflows, clips or overlaps, even with the pulse and the selected ring', async ({ page }) => {
      for (const name of ['Pizza Mania', /Le Lapin/, /R&D/]) {
        await group(page).getByRole('radio', { name }).click()
        await page.waitForTimeout(150) // mid-pop / mid-pulse: the widest moment
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        const rects = await radios(page).evaluateAll((els) =>
          els.map((b) => {
            const face = b.querySelector('.brand-orb-face')!
            // The selected ring is a 5px box-shadow outside the face, scaled with it.
            const shadowRing = b.getAttribute('aria-checked') === 'true' ? 5 * new DOMMatrix(getComputedStyle(face).transform).a : 0
            const r = face.getBoundingClientRect()
            return { left: r.left - shadowRing, right: r.right + shadowRing, top: r.top - shadowRing }
          }),
        )
        for (let k = 0; k < 2; k++) expect(rects[k].right, `logos ${k} and ${k + 1} overlap`).toBeLessThan(rects[k + 1].left)
        for (const r of rects) {
          expect(r.left).toBeGreaterThanOrEqual(0)
          expect(r.top).toBeGreaterThanOrEqual(0)
        }
      }
    })

    if (view.hover) {
      test('hover lifts and tilts the logo and gives it full colour, then it settles back', async ({ page }) => {
        const rnd = group(page).getByRole('radio', { name: /R&D/ })
        const face = rnd.locator('.brand-orb-face')
        const rest = await face.evaluate((e) => ({ o: getComputedStyle(e).opacity, f: getComputedStyle(e).filter }))
        expect(Number(rest.o)).toBeLessThan(0.9)
        await rnd.hover()
        await page.waitForTimeout(450)
        const on = await face.evaluate((e) => ({ o: getComputedStyle(e).opacity, f: getComputedStyle(e).filter }))
        expect(Number(on.o)).toBe(1)
        expect(on.f).toBe('none')
        const m = await matrixOf(face)
        expect(m.f, 'lift').toBeLessThan(-2)
        const deg = Math.abs((Math.atan2(m.b, m.a) * 180) / Math.PI)
        expect(deg, 'tilt').toBeGreaterThan(3)
        expect(deg, 'tilt').toBeLessThanOrEqual(7)
        await page.mouse.move(5, view.height - 5)
        await page.waitForTimeout(500)
        expect((await matrixOf(face)).f).toBeCloseTo(0, 1)
      })
    }

    test('keyboard: one tab stop, arrows move the choice, and focus is visible', async ({ page }) => {
      const checked = group(page).getByRole('radio', { checked: true })
      await checked.focus()
      await page.keyboard.press('ArrowRight')
      const lapin = group(page).getByRole('radio', { name: /Le Lapin/ })
      await expect(lapin).toBeFocused()
      await expect(lapin).toHaveAttribute('aria-checked', 'true')
      expect(await radios(page).evaluateAll((els) => els.map((e) => e.getAttribute('tabindex')))).toEqual(['-1', '0', '-1'])
      // Focus came from the keyboard, so the logo carries a visible outline.
      const outline = await lapin.locator('.brand-orb-face').evaluate((e) => ({ s: getComputedStyle(e).outlineStyle, w: parseFloat(getComputedStyle(e).outlineWidth) }))
      expect(outline.s).not.toBe('none')
      expect(outline.w).toBeGreaterThanOrEqual(2)
      await page.keyboard.press('ArrowLeft')
      await expect(group(page).getByRole('radio', { name: 'Pizza Mania' })).toHaveAttribute('aria-checked', 'true')
    })
  })
}

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } })

  test('asking for less motion stops the float, the pop and the pulse; choosing still works', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(radios(page)).toHaveCount(3)
    const anims = await group(page).locator('.brand-orb-float, .brand-orb-face, .brand-orb-pulse').evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName))
    expect(new Set(anims)).toEqual(new Set(['none']))
    const s = await sampleTops(page, 1200)
    for (let k = 0; k < 3; k++) expect(range(track(s, k))).toBeLessThan(0.5)
    const lapin = group(page).getByRole('radio', { name: /Le Lapin/ })
    await lapin.click()
    await expect(lapin).toHaveAttribute('aria-checked', 'true')
    expect(await lapin.locator('.brand-orb-face').evaluate((e) => getComputedStyle(e).transform)).toBe('none')
    await lapin.hover()
    expect(await lapin.locator('.brand-orb-face').evaluate((e) => getComputedStyle(e).transform)).toBe('none')
  })
})
