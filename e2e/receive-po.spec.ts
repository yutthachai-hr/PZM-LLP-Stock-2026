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
  await confirmButton(page).click()

  await expect.poll(async () => (await getDoc('purchaseOrders/po1'))?.status, { timeout: 20_000 }).toBe('received')
  expect((await receiptsOf('po1')).length).toBe(2) // one row per line
  expect((await getDoc('stockLevels/wh__flour'))?.qty).toBe(10)
  const po = await getDoc('purchaseOrders/po1')
  expect((po?.receipts as unknown[]).length).toBe(1)
})

/**
 * KNOWN DEFECT (audit D1), recorded as the Phase 0 baseline: stock is filed in one
 * transaction and the order updated in a second write, so two devices pressing confirm at
 * once both file the stock. `test.fail` keeps the suite green while the defect stands and
 * turns red the day A1 fixes it — then the marker comes off and this becomes a gate.
 */
test('two devices confirm the same delivery at once: stock goes in once', async ({ browser }) => {
  test.fail(true, 'audit D1 — fixed by plan item A1 (idempotent receipt in one transaction)')
  await seedStage()
  const [a, b] = await Promise.all([signedIn(browser, 'staffA', '/receive?po=po1'), signedIn(browser, 'staffB', '/receive?po=po1')])
  await prepareFullReceipt(a, 'INV-200')
  await prepareFullReceipt(b, 'INV-200')
  await Promise.all([confirmButton(a).click(), confirmButton(b).click()])
  // Let both finish, whichever way they end: neither dialog still saving.
  for (const p of [a, b]) await expect(p.getByRole('button', { name: 'กำลังบันทึก...' })).toHaveCount(0, { timeout: 30_000 })

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
