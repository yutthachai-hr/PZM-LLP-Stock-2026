// R67 Release B canary on the public production site. No sign-in, no form input, no business data.
// install: open the site in a persistent profile so today's service worker installs (old SW before the merge).
// verify:  reopen the same profile after the deploy: SW update, navigation, deep link, LIFF return, offline launch.
// Usage: node sw-canary.cjs <install|verify> <profileDir> <out.json>
const fs = require('fs');
const { chromium } = require('C:/Users/Yutthachai/PZM-LLP-Stock-2026/node_modules/playwright');
const ORIGIN = 'https://pzmstock.pages.dev';
const [mode, profile, outFile] = process.argv.slice(2);
const swInfo = (page) => page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const text = await (await fetch('/sw.js', { cache: 'no-store' })).text();
  return {
    controlled: !!navigator.serviceWorker.controller,
    active: reg?.active?.state ?? null, waiting: reg?.waiting?.state ?? null, installing: reg?.installing?.state ?? null,
    serverHandler: (text.match(/createHandlerBoundToURL\("([^"]*)"\)/) || [])[1] ?? null,
    caches: (await caches.keys()).length,
  };
});
const load = async (page, url) => {
  const failed = []; const onFail = (r) => { if (r.isNavigationRequest()) failed.push(`${r.url()} ${r.failure()?.errorText}`) };
  page.on('requestfailed', onFail);
  let status = null, error = null;
  try { const r = await page.goto(url, { waitUntil: 'load', timeout: 45000 }); status = r?.status() ?? null } catch (e) { error = e.message.split('\n')[0] }
  const root = await page.locator('#root').evaluate((el) => el.childElementCount > 0).catch(() => false);
  page.off('requestfailed', onFail);
  return { url: url.replace(ORIGIN, ''), status, error, rootRendered: root, navFailures: failed };
};
(async () => {
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'allow' });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const out = { mode, checkedAt: new Date().toISOString(), origin: ORIGIN, steps: [] };
  try {
    out.steps.push({ step: 'open /', ...(await load(page, ORIGIN + '/')) });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null || false, null, { timeout: 30000 }).catch(() => {});
    if (mode === 'install') {
      await page.reload({ waitUntil: 'load' });
      out.sw = await swInfo(page);
    } else {
      out.swBeforeUpdate = await swInfo(page);
      // What UpdateBanner does on a visible tab, then what its "update" tap sends.
      await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r?.update() });
      await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r?.waiting || r?.installing) || false }, null, { timeout: 30000 }).catch(() => {});
      out.updateBanner = await page.getByRole('button', { name: /อัปเดต|Update|รีโหลด|Reload/i }).first().isVisible().catch(() => false);
      await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); r?.waiting?.postMessage({ type: 'SKIP_WAITING' }) });
      await page.waitForTimeout(3000);
      out.steps.push({ step: 'reload after update', ...(await load(page, ORIGIN + '/')) });
      out.swAfterUpdate = await swInfo(page);
      // The P0: the cached shell is gone (as phones evict it) and navigation must still work.
      out.evicted = await page.evaluate(async () => {
        let n = 0; for (const k of await caches.keys()) { const c = await caches.open(k); for (const req of await c.keys()) if (req.mode === 'navigate' || /\/(index\.html)?(\?.*)?$/.test(new URL(req.url).pathname + new URL(req.url).search)) { await c.delete(req); n++ } } return n;
      });
      out.steps.push({ step: 'shell evicted: open /', ...(await load(page, ORIGIN + '/')) });
      out.steps.push({ step: 'deep link /orders', ...(await load(page, ORIGIN + '/orders')) });
      out.steps.push({ step: 'LIFF return /?liff.state=', ...(await load(page, ORIGIN + '/?liff.state=%2Forders%3Fresume%3Dsend')) });
      await ctx.setOffline(true);
      out.steps.push({ step: 'offline launch /', ...(await load(page, ORIGIN + '/')) });
      await ctx.setOffline(false);
    }
  } finally { await ctx.close() }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e.message); process.exitCode = 1 });
