// R72 MAIN browser proof for same-page router transitions (Suppliers ?id, Issue ?import/?mode).
// Usage: node nav-browser-proof.cjs <checkoutWithPrivateNodeModules> <port> <outJson>
// Demo mode only (browser localStorage); no emulator, no Firebase, no Production.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [checkout, port = '5219', outJson] = process.argv.slice(2)
const { chromium } = require(path.join(checkout, 'node_modules/@playwright/test'))
const base = `http://127.0.0.1:${port}`

async function waitUp(url, ms = 90000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('vite did not start')
}

// What useNavigate() does: a history entry carrying a fresh React Router location key.
async function spaNav(page, url, n) {
  await page.evaluate(({ url, n }) => {
    window.history.pushState({ usr: null, key: `r72proof${n}`, idx: 1000 + n }, '', url)
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  }, { url, n })
  await page.waitForTimeout(400)
}

async function stage(page, role) {
  await page.addInitScript(({ role }) => {
    if (sessionStorage.getItem('r72staged')) return
    sessionStorage.setItem('r72staged', '1')
    const now = Date.now()
    const user = { id: 'r72-nav', email: 'nav@inventory-pzm.local', name: 'R72 Nav QA', role, siteIds: ['wh', 'br'], active: true, createdAt: now }
    localStorage.setItem('pmstock:v1:users', JSON.stringify({ [user.id]: user }))
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
    localStorage.setItem('pmstock:lang', 'th')
    localStorage.setItem('pmstock:v1:locations', JSON.stringify({
      wh: { id: 'wh', name: 'คลังหลัก', active: true, type: 'warehouse', createdAt: now },
      br: { id: 'br', name: 'สาขาสยาม', active: true, type: 'branch', createdAt: now + 1 },
    }))
    const sup = (id, name, code) => ({ id, name, code, contactNumber: '020000000', email: '', type: 'takingReturn', active: true, createdAt: now })
    localStorage.setItem('pmstock:v1:suppliers', JSON.stringify({
      'sup-a': sup('sup-a', 'R72 ผู้ขายอัลฟา', 'V-00001'),
      'sup-b': sup('sup-b', 'R72 ผู้ขายเบต้า', 'V-00002'),
    }))
  }, { role })
}

async function run() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'demo', '--host', '127.0.0.1', '--port', port, '--strictPort'], { cwd: checkout, stdio: 'ignore' })
  const results = []
  const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail)) }
  try {
    await waitUp(base)
    const browser = await chromium.launch()
    try {
      // ---- Suppliers, phone drawer
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'th-TH' })
      const page = await ctx.newPage()
      await stage(page, 'admin')
      const drawer = page.getByRole('dialog', { name: 'รายละเอียดผู้ขาย' })
      await page.goto(`${base}/suppliers?id=sup-a`)
      await drawer.waitFor({ timeout: 20000 })
      check('suppliers deep link ?id=A opens A', await drawer.getByText('R72 ผู้ขายอัลฟา').first().isVisible(), {})
      await spaNav(page, '/suppliers?id=sup-b', 1)
      check('suppliers SPA ?id=A -> ?id=B shows B', await drawer.getByText('R72 ผู้ขายเบต้า').first().isVisible().catch(() => false), {})
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      check('suppliers drawer closes manually and stays closed', !(await drawer.isVisible()), { url: page.url() })
      await spaNav(page, '/suppliers?id=sup-b', 2)
      check('suppliers SPA same ?id=B after close reopens B', await drawer.getByText('R72 ผู้ขายเบต้า').first().isVisible().catch(() => false), {})
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      await page.getByText('R72 ผู้ขายอัลฟา').first().click()
      await page.waitForTimeout(400)
      const manualA = await drawer.getByText('R72 ผู้ขายอัลฟา').first().isVisible().catch(() => false)
      await spaNav(page, '/suppliers?id=sup-b', 3)
      check('suppliers manual pick A then explicit SPA same ?id=B shows B', manualA && await drawer.getByText('R72 ผู้ขายเบต้า').first().isVisible().catch(() => false), { manualA })
      await ctx.close()

      // ---- Issue modes, admin (manager default = transfer)
      const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'th-TH' })
      const p2 = await ctx2.newPage()
      await stage(p2, 'admin')
      const importModal = p2.getByRole('dialog', { name: 'นำเข้ารายการสินค้า' })
      const posRadio = p2.getByRole('radio', { name: /ตัดตามยอดขาย POS/ })
      const transferRadio = p2.getByRole('radio', { name: /โอนไปสาขา/ })
      await p2.goto(`${base}/issue?import=1`)
      await importModal.waitFor({ timeout: 20000 }).catch(() => {})
      check('issue initial ?import=1 opens import', await importModal.isVisible(), { url: p2.url() })
      check('issue one-shot import flag removed from URL', !p2.url().includes('import=1'), { url: p2.url() })
      await p2.keyboard.press('Escape')
      await p2.waitForTimeout(300)
      await posRadio.click()
      check('issue manual POS selected', (await posRadio.getAttribute('aria-checked')) === 'true', {})
      await spaNav(p2, '/issue?import=1', 4)
      await importModal.waitFor({ timeout: 5000 }).catch(() => {})
      check('issue POS -> SPA ?import=1 switches to transfer and opens import', (await transferRadio.getAttribute('aria-checked')) === 'true' && await importModal.isVisible(), { url: p2.url() })
      const urlAfter = p2.url()
      await p2.waitForTimeout(1500)
      check('issue no URL/state loop after flag removal', p2.url() === urlAfter && !urlAfter.includes('import=1'), { urlAfter, later: p2.url() })
      await p2.keyboard.press('Escape')
      await p2.waitForTimeout(300)
      await spaNav(p2, '/issue?mode=pos', 5)
      check('issue SPA ?mode=pos switches to POS', (await posRadio.getAttribute('aria-checked')) === 'true', {})
      await transferRadio.click()
      await p2.waitForTimeout(800)
      check('issue manual transfer kept while URL still ?mode=pos', (await transferRadio.getAttribute('aria-checked')) === 'true', { url: p2.url() })
      await spaNav(p2, '/issue?mode=pos', 6)
      check('issue explicit SPA same ?mode=pos after manual switch returns POS', (await posRadio.getAttribute('aria-checked')) === 'true', {})
      await ctx2.close()
    } finally {
      await browser.close()
    }
  } finally {
    vite.kill()
  }
  const out = { at: new Date().toISOString(), checkout, port, passed: results.filter((r) => r.pass).length, total: results.length, results }
  if (outJson) fs.writeFileSync(outJson, JSON.stringify(out, null, 2))
  console.log(`TOTAL ${out.passed}/${out.total}`)
  process.exitCode = out.passed === out.total ? 0 : 1
}

run().catch((e) => { console.error(e); process.exitCode = 2 })
