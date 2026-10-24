import { expect, test, type Page } from '@playwright/test'

/**
 * P0 (owner, 24 Oct 2026): "ส่งใบสั่งซื้อเข้า LINE" ended on a browser ERR_FAILED page at
 * `/?liff.state=…&liff.referrer=…` — LINE's redirect back into the app — while the server answered 200.
 *
 * The installed service worker answers every page load from its cached app shell. When that one cache entry is
 * gone and the worker is not (storage cleared or evicted by the phone), it fetched `/index.html` instead, and
 * Cloudflare Pages answers that with a 308 to `/`. A redirected response cannot answer a page load, so the
 * browser showed ERR_FAILED, for every page, on every reload, until the site's data was cleared.
 *
 * Runs on a production-shape build behind scripts/pages-static.mjs, which redirects `.html` the way Pages does.
 */
const LIFF_RETURN = `/?liff.state=${encodeURIComponent('/orders?send=PO-TEST&brand=pizza')}&liff.referrer=${encodeURIComponent('https://liff.line.me/')}`

async function installedWorker(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 }).catch(() => undefined)
  if (!(await page.evaluate(() => navigator.serviceWorker.controller != null))) await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 })
}

async function dropCachedShell(page: Page, everything: boolean): Promise<string[]> {
  return page.evaluate(async (everything) => {
    const dropped: string[] = []
    for (const name of await caches.keys()) {
      if (everything) { await caches.delete(name); dropped.push(name); continue }
      const cache = await caches.open(name)
      for (const req of await cache.keys()) {
        const p = new URL(req.url).pathname
        if (p === '/' || p === '/index.html') { await cache.delete(req); dropped.push(p) }
      }
    }
    return dropped
  }, everything)
}

for (const everything of [false, true]) {
  test(`LINE's return URL still opens the app when the cached shell is gone (${everything ? 'all caches' : 'shell entry'})`, async ({ page }) => {
    await installedWorker(page)
    expect(await dropCachedShell(page, everything)).not.toHaveLength(0)
    const res = await page.goto(LIFF_RETURN)
    expect(res?.status()).toBe(200)
    await expect(page.locator('#root')).not.toBeEmpty()
    // And the next ordinary page load works too: the worker is not left broken.
    const again = await page.goto('/orders')
    expect(again?.status()).toBe(200)
    await expect(page.locator('#root')).not.toBeEmpty()
  })
}

test('the installed app still opens with no network (the cached shell is kept)', async ({ page, context }) => {
  await installedWorker(page)
  await context.setOffline(true)
  try {
    await page.goto('/orders')
    await expect(page.locator('#root')).not.toBeEmpty()
  } finally {
    await context.setOffline(false)
  }
})
