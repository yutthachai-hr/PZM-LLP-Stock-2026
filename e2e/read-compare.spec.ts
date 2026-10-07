import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { test, type Page } from '@playwright/test'
import { open, signedIn } from './app'
import { PASSWORD, PEOPLE, type Person } from './fixture'

/**
 * One read benchmark for ANY branch (7 Oct 2026) — to compare production `main` with the
 * cloud session's branch and with their merge, on the same real data and the same steps.
 *
 * Self-contained on purpose: it loads the backup itself through the emulator's REST API
 * and only relies on what every branch has (e2e/app.ts signedIn/open, fixture PEOPLE, and
 * `window.__pzmReads.tally()`). Branches meter differently, so it reports:
 *   - delivered: documents the app received (`docs` on main's meter, `total` on the cloud
 *     branch's) — the common measure;
 *   - billed: main's estimate of what Firestore charges (cache free, >30 min resume full),
 *     where the branch's meter has it;
 *   - server: reads the stock-command server made (cloud branch's command-server), if any.
 *
 *   PZM_BACKUP=<backup.json> READ_BENCH_LABEL=<name> npx firebase emulators:exec --only firestore,auth \
 *     --project demo-pzm-e2e "npx playwright test e2e/read-compare.spec.ts"
 */

const file = process.env.PZM_BACKUP
const label = process.env.READ_BENCH_LABEL ?? 'run'
test.skip(!file, 'set PZM_BACKUP to a backup file')
test.setTimeout(600_000)

const PROJECT = 'demo-pzm-e2e'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

function enc(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)])) } }
}
const fields = (d: Record<string, unknown>) => (enc(d).mapValue as { fields: Record<string, unknown> }).fields

async function load(): Promise<Record<string, number>> {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  const backup = JSON.parse(readFileSync(file!, 'utf8')) as { brand: string; data: Record<string, Record<string, unknown>[]> }
  const prefix = backup.brand === 'lelapin' ? 'lelapin__' : ''
  const writes: unknown[] = []
  const counts: Record<string, number> = {}
  for (const [name, rows] of Object.entries(backup.data)) {
    if (name === 'users') continue
    const col = name === 'meta' ? 'meta' : `${prefix}${name}`
    counts[name] = rows.length
    for (const r of rows) if (r.id) writes.push({ update: { name: `projects/${PROJECT}/databases/(default)/documents/${col}/${r.id}`, fields: fields(r) } })
  }
  for (let i = 0; i < writes.length; i += 400) {
    const res = await fetch(`${FS}:commit`, { method: 'POST', headers: OWNER, body: JSON.stringify({ writes: writes.slice(i, i + 400) }) })
    if (!res.ok) throw new Error(`load: ${res.status} ${await res.text()}`)
  }
  for (const [, p] of Object.entries(PEOPLE) as [Person, (typeof PEOPLE)[Person]][]) {
    const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: p.email, password: PASSWORD, returnSecureToken: true }),
    })
    const uid = ((await r.json()) as { localId: string }).localId
    await fetch(`${FS}/users/${uid}`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: fields({ name: p.name, email: p.email, role: p.role, active: true, createdAt: Date.now() }) }) })
  }
  return counts
}

type AnyTally = { total: number; docs?: number; stats?: unknown[] }
const tally = (p: Page) => p.evaluate(() => (window as unknown as { __pzmReads: { tally: () => AnyTally } }).__pzmReads.tally())
const reset = (p: Page) => p.evaluate(() => (window as unknown as { __pzmReads: { reset: () => void } }).__pzmReads.reset())
const server = async (resetIt = false): Promise<number | null> => {
  try {
    const r = await fetch('http://127.0.0.1:5177/__reads', { method: resetIt ? 'POST' : 'GET' })
    return ((await r.json()) as { total: number }).total
  } catch {
    return null
  }
}
async function settle(p: Page): Promise<void> {
  let last = -1
  for (let i = 0; i < 16; i++) {
    await p.waitForTimeout(1250)
    const t = (await tally(p)).total
    if (t === last) {
      await p.waitForTimeout(1250)
      if ((await tally(p)).total === t) return
    }
    last = t
  }
}
const go = (p: Page, path: string) =>
  p.evaluate((x) => {
    history.pushState({}, '', x)
    dispatchEvent(new PopStateEvent('popstate'))
  }, path)

test('read comparison on real data', async ({ browser }) => {
  const counts = await load()
  const results: Record<string, { delivered: number; billed: number | null; server: number | null }> = {}
  const save = () => {
    mkdirSync('e2e-results', { recursive: true })
    writeFileSync(`e2e-results/read-compare-${label}.json`, JSON.stringify({ label, at: new Date().toISOString(), backupCounts: counts, results }, null, 2))
  }
  const rec = async (name: string, p: Page) => {
    await settle(p)
    const t = await tally(p)
    const s = await server()
    results[name] = { delivered: t.docs ?? t.total, billed: t.docs !== undefined ? t.total : null, server: s }
    save()
  }
  const step = async (p: Page, name: string, path: string) => {
    await reset(p)
    await server(true)
    await go(p, path)
    await rec(name, p)
  }

  // A manager's first open, then the same device again, then everyday screens.
  await server(true)
  const m = await signedIn(browser, 'manager')
  await rec('cold open (manager, new device)', m)
  await reset(m)
  await server(true)
  await open(m, '/')
  await rec('reopen app (same device)', m)
  for (const [n, path] of [['dashboard', '/'], ['products', '/products'], ['receiving', '/receive'], ['purchase orders', '/orders'], ['suppliers', '/suppliers'], ['movements', '/movements'], ['calendar', '/calendar']] as const) {
    await step(m, n, path)
  }
  await reset(m)
  await server(true)
  for (let i = 0; i < 3; i++) for (const path of ['/', '/products', '/orders', '/movements', '/calendar']) await go(m, path)
  await rec('switching screens x3', m)

  // A notification for managers, written elsewhere.
  await go(m, '/')
  await reset(m)
  const now = Date.now()
  await fetch(`${FS}/notifications/bench-${now}`, {
    method: 'PATCH', headers: OWNER,
    body: JSON.stringify({ fields: fields({ id: `bench-${now}`, kind: 'poDelayed', category: 'purchasing', priority: 'high', to: { roles: ['manager', 'admin'] }, audienceKeys: ['role:manager', 'role:admin'], params: {}, link: '/orders', active: true, readBy: {}, source: 'worker', createdBy: 'bench', createdAt: now, updatedAt: now, expiresAt: now + 7 * 86_400_000 }) }),
  })
  await rec('notification arrives', m)

  // Away more than 30 minutes, then back (branches without the hook just go offline/online).
  await reset(m)
  await m.context().setOffline(true)
  await m.evaluate(() => (window as unknown as { __pzmReads: { markLongAbsence?: () => void } }).__pzmReads.markLongAbsence?.())
  await m.waitForTimeout(1500)
  await m.context().setOffline(false)
  await m.waitForTimeout(15_000)
  await rec('back after a long absence', m)

  const tab = await m.context().newPage()
  await open(tab, '/')
  await rec('second tab', tab)

  const s = await signedIn(browser, 'staffA')
  await rec('cold open (staff, new device)', s)

  console.log(`\nREAD COMPARE (${label})`)
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(34)} delivered ${String(v.delivered).padStart(6)}  billed ${String(v.billed ?? '-').padStart(6)}  server ${String(v.server ?? '-').padStart(5)}`)
})
