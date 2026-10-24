// R67 Release B: reopen a profile that had the OLD service worker (closing the browser = LINE's in-app
// browser closed). Which shell is cached tells which SW is in charge. Public pages only, no sign-in.
// Usage: node sw-reopen.cjs <profileDir> <out.json>
const fs = require('fs');
const { chromium } = require('C:/Users/Yutthachai/PZM-LLP-Stock-2026/node_modules/playwright');
const ORIGIN = 'https://pzmstock.pages.dev';
const [profile, outFile] = process.argv.slice(2);
const shellKeys = (page) => page.evaluate(async () => {
  const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) { const u = new URL(r.url); if (u.pathname === '/' || u.pathname === '/index.html') out.push(u.pathname + u.search.replace(/=.*/, '=…')) } return out;
});
const load = async (page, url) => {
  const failed = []; const onFail = (r) => { if (r.isNavigationRequest()) failed.push(r.failure()?.errorText) };
  page.on('requestfailed', onFail);
  let status = null, error = null;
  try { const r = await page.goto(url, { waitUntil: 'load', timeout: 45000 }); status = r?.status() ?? null } catch (e) { error = e.message.split('\n')[0] }
  const root = await page.locator('#root').evaluate((el) => el.childElementCount > 0).catch(() => false);
  page.off('requestfailed', onFail);
  return { url: url.replace(ORIGIN, ''), status, rootRendered: root, navFailures: failed, error };
};
(async () => {
  const out = { checkedAt: new Date().toISOString(), steps: [] };
  for (let round = 1; round <= 2; round++) {
    // Each round is a fresh launch of the same profile: no client of the old worker survives it.
    const ctx = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'allow' });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    const s = (step, r) => out.steps.push({ round, step, ...r });
    s('open /', await load(page, ORIGIN + '/'));
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 }).catch(() => {});
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { active: r?.active?.state ?? null, waiting: r?.waiting?.state ?? null } });
    s('service worker', { ...reg, cachedShell: await shellKeys(page) });
    if (round === 2) {
      await ctx.setOffline(true); s('offline launch /', await load(page, ORIGIN + '/')); await ctx.setOffline(false);
      s('deep link /orders', await load(page, ORIGIN + '/orders'));
      s('LIFF return /?liff.state=', await load(page, ORIGIN + '/?liff.state=%2Forders%3Fresume%3Dsend'));
      const evicted = await page.evaluate(async () => { let n = 0; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) { const p = new URL(r.url).pathname; if (p === '/' || p === '/index.html') { await c.delete(r); n++ } } } return n });
      s('shell evicted (P0 condition)', { evicted });
      s('deep link /orders after eviction', await load(page, ORIGIN + '/orders'));
      s('open / after eviction', await load(page, ORIGIN + '/'));
      s('LIFF return after eviction', await load(page, ORIGIN + '/?liff.state=%2Forders'));
    }
    await ctx.close();
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), { flag: 'wx' });
  for (const st of out.steps) console.log(`R${st.round} ${st.step.padEnd(34)} ${JSON.stringify(Object.fromEntries(Object.entries(st).filter(([k]) => !['round', 'step'].includes(k))))}`);
})().catch((e) => { console.error(e.message); process.exitCode = 1 });
