// R67 Phase 1 (local, synthetic): a staging-mode dev server in a real browser. The production
// web config is planted in localStorage first; the app must still resolve only the staging
// project, and no request may name the production project. Usage: node scripts/staging-local-check.mjs <baseUrl> <out.json>
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const [base, out] = process.argv.slice(2)
const PROD = 'pzm-stock-x5'
const browser = await chromium.launch()
const page = await browser.newPage()
const urls = []
page.on('request', (r) => urls.push(r.url()))
await page.addInitScript((prod) => {
  localStorage.setItem('pmstock:firebaseConfig', JSON.stringify({ apiKey: 'prod-key', authDomain: `${prod}.firebaseapp.com`, projectId: prod, appId: '1:789071579161:web:x' }))
}, PROD)
await page.goto(base + '/', { waitUntil: 'load' })
await page.waitForTimeout(4000)
const seen = await page.evaluate(async () => {
  const cfg = await import('/src/firebase/config.ts')
  const backend = await import('/src/backend/index.ts').catch(() => ({}))
  const tier = await import('/src/lib/deployTier.ts')
  return {
    demoMode: cfg.isDemoMode(),
    resolvedProject: cfg.getFirebaseConfig()?.projectId ?? null,
    savedConfigIgnored: JSON.parse(localStorage.getItem('pmstock:firebaseConfig')).projectId,
    backendMode: backend.BACKEND_MODE ?? null,
    hostTier: tier.hostTier(location.hostname),
  }
})
await browser.close()
const external = urls.filter((u) => !u.startsWith(base))
const result = {
  checkedAt: new Date().toISOString(), base, ...seen,
  requests: urls.length, externalRequests: external.map((u) => new URL(u).host + new URL(u).pathname.slice(0, 60)),
  anyRequestNamesProduction: urls.some((u) => u.includes(PROD) || u.includes('789071579161')),
}
result.pass = result.resolvedProject === 'pzm-stock-staging' && !result.anyRequestNamesProduction && result.backendMode === 'cloud'
writeFileSync(out, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 1))
process.exitCode = result.pass ? 0 : 1
