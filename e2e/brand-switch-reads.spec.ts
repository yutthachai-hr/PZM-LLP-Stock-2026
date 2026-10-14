import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createAccount, putDoc, putMany, resetEmulators } from './emulator'
import { PASSWORD, PEOPLE, type Person } from './fixture'

/**
 * What switching brand costs in Firestore reads on real data (owner, 9 Oct 2026). Two brands'
 * backups are loaded into the emulator together; a manager signs in to Pizza Mania and
 * switches Pizza → Le Lapin → Pizza → Le Lapin, each step measured once the Dashboard is quiet.
 *
 *   PZM_BACKUP_PIZZA=… PZM_BACKUP_LELAPIN=… npm run test:e2e -- e2e/brand-switch-reads.spec.ts
 *
 * Skipped without both files. Nothing leaves this machine; nothing is written but the emulator.
 */

const PIZZA = process.env.PZM_BACKUP_PIZZA
const LELAPIN = process.env.PZM_BACKUP_LELAPIN
const OUT = process.env.BRAND_EVIDENCE_DIR
test.skip(!PIZZA || !LELAPIN, 'set PZM_BACKUP_PIZZA and PZM_BACKUP_LELAPIN to run the switching read benchmark')
test.setTimeout(600_000)

interface Tally {
  total: number
  listeners: { active: number }
}
const reads = (page: Page) => page.evaluate(() => (window as unknown as { __pzmReads: { tally: () => Tally } }).__pzmReads.tally())

async function settle(page: Page): Promise<Tally> {
  let last = await reads(page)
  let quietSince = Date.now()
  const end = Date.now() + 60_000
  while (Date.now() < end) {
    await page.waitForTimeout(300)
    const now = await reads(page)
    if (now.total !== last.total) quietSince = Date.now()
    else if (Date.now() - quietSince >= 2500) return now
    last = now
  }
  return last
}

async function load(file: string) {
  const backup = JSON.parse(readFileSync(file, 'utf8')) as { brand: string; data: Record<string, Record<string, unknown>[]> }
  const prefix = backup.brand === 'pizza' ? '' : `${backup.brand}__`
  const docs: { path: string; data: Record<string, unknown> }[] = []
  for (const [name, rows] of Object.entries(backup.data)) {
    if (name === 'users' || name === 'meta') continue
    for (const row of rows) if (row.id) docs.push({ path: `${prefix}${name}/${String(row.id)}`, data: row })
  }
  await putMany(docs)
  return docs.length
}

test('reads per brand switch, real Pizza Mania and Le Lapin data', async ({ browser }) => {
  await resetEmulators()
  const loaded = { pizza: await load(PIZZA!), lelapin: await load(LELAPIN!) }
  const now = Date.now()
  for (const [key, p] of Object.entries(PEOPLE) as [Person, (typeof PEOPLE)[Person]][]) {
    const uid = await createAccount(p.email, PASSWORD)
    await putDoc(`users/${uid}`, { name: p.name, email: p.email, role: p.role, active: true, createdAt: now }, { stampId: false })
    void key
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('/')
  await page.getByRole('textbox', { name: /email|อีเมล/i }).fill(PEOPLE.manager.email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await page.getByRole('button', { name: 'Pizza Mania', exact: true }).click()
  await expect(page.locator('main')).toBeVisible()
  const steps: { step: string; reads: number; listeners: number }[] = []
  let at = await settle(page)
  steps.push({ step: 'sign in → Pizza Mania (cold)', reads: at.total, listeners: at.listeners.active })

  const trigger = page.getByRole('button', { name: /^แบรนด์: / }).first()
  for (const [label, name] of [
    ['→ Le Lapin (first time)', /Le Lapin/],
    ['→ Pizza Mania (again)', /Pizza Mania/],
    ['→ Le Lapin (again)', /Le Lapin/],
  ] as const) {
    await trigger.click()
    await page.getByRole('menuitemradio', { name }).click()
    await expect(trigger).toHaveAccessibleName(name)
    const next = await settle(page)
    steps.push({ step: label, reads: next.total - at.total, listeners: next.listeners.active })
    at = next
  }
  const result = { at: new Date().toISOString(), loaded, steps }
  console.log('SWITCH-READS', JSON.stringify(result))
  if (OUT) {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(`${OUT}/read-cost-real-data.json`, JSON.stringify(result, null, 2))
  }
  // Listeners never pile up across switches.
  expect(new Set(steps.map((s) => s.listeners)).size).toBe(1)
})
