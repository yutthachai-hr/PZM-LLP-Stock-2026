// R66 Release B (PR53) read-only production check: public GETs only, no app start, no auth.
// Usage: node verify-prod-sw.cjs [origin]  -> exit 0 only when the deployed SW binds navigation to "/".
const origin = process.argv[2] || 'https://pzmstock.pages.dev';
(async () => {
  const get = async (p, init) => { const r = await fetch(origin + p, { redirect: 'manual', cache: 'no-store', ...init }); return { status: r.status, location: r.headers.get('location'), text: r.status === 200 ? await r.text() : '' }; };
  const root = await get('/');
  const sw = await get('/sw.js');
  const app = root.text.match(/assets\/app-[\w-]+\.js/)?.[0] ?? null;
  const handler = sw.text.match(/createHandlerBoundToURL\("([^"]*)"\)/)?.[1] ?? null;
  const checks = {
    rootHtml200: root.status === 200,
    swJs200: sw.status === 200,
    navigationBoundToRoot: handler === '/',
    precacheHasRootNotIndexHtml: /url:"\/",revision/.test(sw.text) && !/url:"index\.html"/.test(sw.text),
    denylistApi: sw.text.includes('\\/api\\/'),
    denylistSupplierPo: sw.text.includes('\\/supplier\\/po\\/'),
    cleanupOutdatedCaches: sw.text.includes('cleanupOutdatedCaches'),
  };
  const out = { checkedAt: new Date().toISOString(), origin, appAsset: app, swHandler: handler, checks, pass: Object.values(checks).every(Boolean) };
  console.log(JSON.stringify(out, null, 1));
  process.exitCode = out.pass ? 0 : 1;
})().catch((e) => { console.error(e.message); process.exitCode = 2; });
