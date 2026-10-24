// R67 Release B: a phone opening production for the first time after the hotfix. Public pages only.
// Usage: node sw-fresh.cjs <emptyProfileDir> <out.json>
const fs = require('fs');
const { chromium } = require('C:/Users/Yutthachai/PZM-LLP-Stock-2026/node_modules/playwright');
const ORIGIN = 'https://pzmstock.pages.dev';
const [profile, outFile] = process.argv.slice(2);
if (fs.existsSync(profile)) throw new Error('profile must be new');
const settle = async (page, url) => {
  const failed = []; const onFail = (r) => { if (r.isNavigationRequest()) failed.push(r.failure()?.errorText) };
  page.on('requestfailed', onFail);
  let status = null, error = null;
  try { const r = await page.goto(url, { waitUntil: 'load', timeout: 45000 }); status = r?.status() ?? null } catch (e) { error = e.message.split('\n')[0] }
  await page.waitForTimeout(4000);
  const root = await page.locator('#root').evaluate((el) => el.childElementCount > 0).catch(() => false);
  const finalPath = await page.evaluate(() => location.pathname + location.search).catch(() => null);
  const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 80);
  page.off('requestfailed', onFail);
  return { url: url.replace(ORIGIN, ''), status, rootRendered: root, finalPath, navFailures: failed, error, visible: text };
};
(async () => {
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, serviceWorkers: 'allow' });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const out = { checkedAt: new Date().toISOString(), steps: [] };
  const s = (step, r) => out.steps.push({ step, ...r });
  s('first open /', await settle(page, ORIGIN + '/'));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 }).catch(() => {});
  s('reload (now controlled)', await settle(page, ORIGIN + '/'));
  s('service worker', await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration(); const shell = [];
    for (const k of await caches.keys()) for (const q of await (await caches.open(k)).keys()) { const p = new URL(q.url).pathname; if (p === '/' || p === '/index.html') shell.push(p) }
    return { controlled: !!navigator.serviceWorker.controller, active: r?.active?.state ?? null, cachedShell: shell };
  }));
  await ctx.setOffline(true);
  s('offline launch /', await settle(page, ORIGIN + '/'));
  s('offline deep link /orders', await settle(page, ORIGIN + '/orders'));
  await ctx.setOffline(false);
  s('LIFF return /?liff.state=%2Forders', await settle(page, ORIGIN + '/?liff.state=%2Forders'));
  s('supplier page bypasses the shell /supplier/po/x', await settle(page, ORIGIN + '/supplier/po/not-a-token'));
  await ctx.close();
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), { flag: 'wx' });
  for (const st of out.steps) console.log(`${st.step.padEnd(48)} ${JSON.stringify(Object.fromEntries(Object.entries(st).filter(([k]) => k !== 'step')))}`);
})().catch((e) => { console.error(e.message); process.exitCode = 1 });
