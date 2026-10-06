import { expect, test } from '@playwright/test'
import { getDoc, listDocs } from './emulator'
import { seedStage } from './fixture'
import { signedIn } from './app'
import { confirmButton, prepareFullReceipt } from './receive'
import { auditIntegrity } from '../src/lib/integrityAudit'

/**
 * Receiving against a purchase order (audit D1, plan item A1).
 * The ledger, the cached balance and the order must tell one story however the confirm
 * button is pressed.
 */

async function receiptsOf(poId: string) {
  return (await listDocs('stockMovements')).filter((m) => m.poId === poId && !m.voided)
}

test('one device receives an order in full: one receipt, stock and order agree', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'staffA', '/receive?po=po1')
  await prepareFullReceipt(page, 'INV-100')
  // Through the trusted command (ADR-001, .env.e2e) — not a silent fall back to the client.
  const viaCommand = page.waitForResponse('**/api/stock/receive-po')
  await confirmButton(page).click()
  expect((await viaCommand).status()).toBe(200)

  await expect.poll(async () => (await getDoc('purchaseOrders/po1'))?.status, { timeout: 20_000 }).toBe('received')
  expect((await receiptsOf('po1')).length).toBe(2) // one row per line
  expect((await getDoc('stockLevels/wh__flour'))?.qty).toBe(10)
  const po = await getDoc('purchaseOrders/po1')
  expect((po?.receipts as unknown[]).length).toBe(1)
})

/**
 * Audit D1, fixed by plan A1 (6 Oct 2026). Phase 0 baseline before the fix: flour 20,
 * four stock rows, one receipt on the order. Now a gate: the stock goes in once and the
 * second device is told the order was already received.
 */
test('two devices confirm the same delivery at once: stock goes in once', async ({ browser }) => {
  await seedStage()
  const [a, b] = await Promise.all([signedIn(browser, 'staffA', '/receive?po=po1'), signedIn(browser, 'staffB', '/receive?po=po1')])
  await prepareFullReceipt(a, 'INV-200')
  await prepareFullReceipt(b, 'INV-200')
  await Promise.all([confirmButton(a).click(), confirmButton(b).click()])
  // Let both finish, whichever way they end: neither dialog still saving.
  for (const p of [a, b]) await expect(p.getByRole('button', { name: 'กำลังบันทึก...' })).toHaveCount(0, { timeout: 30_000 })

  // Whoever lost the race is told so in words, not "insufficient permissions".
  const told = (text: string) => /เพิ่งมีคนรับของไป|รับของแล้ว/.test(text)
  const texts = await Promise.all([a, b].map((p) => p.locator('body').innerText()))
  test.info().annotations.push({ type: 'loserTold', description: String(texts.some(told)) })
  expect(texts.some(told)).toBe(true)
  expect(texts.join(' ')).not.toMatch(/PERMISSION_DENIED|insufficient permissions/i)
  const flour = (await getDoc('stockLevels/wh__flour'))?.qty
  const rows = await receiptsOf('po1')
  const po = await getDoc('purchaseOrders/po1')
  test.info().annotations.push({ type: 'observed', description: JSON.stringify({ flour, receiptRows: rows.length, poReceipts: (po?.receipts as unknown[] | undefined)?.length, poStatus: po?.status }) })
  expect(flour).toBe(10)
  expect(rows.length).toBe(2)
})

/**
 * The integrity auditor sees what the double receipt left behind, in data the real app
 * wrote. This one must pass today and after A1 alike: it is the auditor's own gate.
 */
test('the integrity auditor flags a doubled receipt the app wrote', async ({ browser }) => {
  await seedStage()
  const [a, b] = await Promise.all([signedIn(browser, 'staffA', '/receive?po=po1'), signedIn(browser, 'staffB', '/receive?po=po1')])
  await prepareFullReceipt(a, 'INV-300')
  await prepareFullReceipt(b, 'INV-300')
  await Promise.all([confirmButton(a).click(), confirmButton(b).click()])
  for (const p of [a, b]) await expect(p.getByRole('button', { name: 'กำลังบันทึก...' })).toHaveCount(0, { timeout: 30_000 })

  const load = async (c: string) => (await listDocs(c)) as never[]
  const report = auditIntegrity({
    products: await load('products'),
    locations: await load('locations'),
    stockLevels: await load('stockLevels'),
    movements: await load('stockMovements'),
    purchaseOrders: await load('purchaseOrders'),
    purchaseRequests: await load('purchaseRequests'),
    transfers: await load('transfers'),
  })
  const found = report.findings.map((f) => f.code)
  test.info().annotations.push({ type: 'observed', description: found.join(', ') || 'none' })
  // Today two devices double the stock; once A1 lands only one gets through and the
  // auditor must find nothing. Either way it has to agree with what actually happened.
  const flour = (await getDoc('stockLevels/wh__flour'))?.qty
  if (flour === 10) expect(report.findings.filter((f) => f.severity === 'critical')).toEqual([])
  else expect(found).toEqual(expect.arrayContaining(['stockNotOnPo', 'possibleDuplicateReceipt']))
})

/**
 * The connection drops after the server saved but before the answer arrived (scenario E2/E6
 * in the plan). Whatever the app does next — Firestore retrying the transaction itself, or
 * the person pressing confirm again — the receipt must be filed once.
 */
test('the answer is lost after the save: confirming again files nothing twice', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'staffA', '/receive?po=po1')
  await prepareFullReceipt(page, 'INV-400')
  let cut = false
  // The save goes to the stock command when the build sends it there (ADR-001), else
  // straight to Firestore; cut whichever carries it.
  const lose = async (route: import('@playwright/test').Route) => {
    if (cut) return route.continue()
    cut = true
    await route.fetch() // the server commits…
    await route.abort('connectionreset') // …and the reply never reaches the phone
  }
  await page.route('**/api/stock/receive-po', lose)
  await page.route('**/documents:commit*', lose)
  await confirmButton(page).click()
  // If the app surfaced the failure, the person tries again — the same receipt, the same id.
  await expect(page.getByRole('button', { name: 'กำลังบันทึก...' })).toHaveCount(0, { timeout: 30_000 })
  if (await confirmButton(page).isVisible()) await confirmButton(page).click()
  await expect.poll(async () => (await getDoc('purchaseOrders/po1'))?.status, { timeout: 20_000 }).toBe('received')
  await expect(page.getByRole('button', { name: 'กำลังบันทึก...' })).toHaveCount(0, { timeout: 30_000 })

  expect(cut).toBe(true)
  expect((await getDoc('stockLevels/wh__flour'))?.qty).toBe(10)
  expect((await receiptsOf('po1')).length).toBe(2)
  expect(((await getDoc('purchaseOrders/po1'))?.receipts as unknown[]).length).toBe(1)
})
