import { expect, test } from '@playwright/test'
import { putDoc, signIn, writeAs } from './emulator'
import { PASSWORD, PEOPLE, seedStage } from './fixture'

/**
 * A modified client: a staff member's real token, writing straight to the database and
 * skipping every check the app's screens make (audit S1–S5; plan A-rules / ADR-001).
 *
 * Each `test.fail` is a hole the audit found, recorded as the Phase 0 baseline: the write
 * is still ALLOWED today. When the rules (or the command boundary) close it, the test
 * turns red, the marker comes off, and it stays as a gate. The control at the top must
 * always pass — it proves the harness really runs the rules.
 */

const DAY = 86_400_000

test.beforeEach(async () => {
  await seedStage()
})

async function staff() {
  return signIn(PEOPLE.staffA.email, PASSWORD)
}

test('control: staff cannot make themselves admin', async () => {
  const s = await staff()
  expect(await writeAs(s.token, `users/${s.uid}`, { role: 'admin' }, { fields: ['role'] })).toBe(403)
})

test('S1: staff cannot write a stock balance directly', async () => {
  test.fail(true, 'audit S1 — closed by ADR-001 (balances written only by the trusted command boundary)')
  const s = await staff()
  const status = await writeAs(s.token, 'stockLevels/wh__flour', { id: 'wh__flour', productId: 'flour', locationId: 'wh', qty: 999, updatedAt: Date.now(), updatedBy: s.uid })
  test.info().annotations.push({ type: 'observed', description: `HTTP ${status}` })
  expect(status).toBe(403)
})

test('S2: staff cannot move stock between sites by naming a transfer that does not exist', async () => {
  test.fail(true, 'audit S2 — closed by plan item A4 (transferId must name a real, approved transfer)')
  await putDoc('locations/br1', { name: 'Branch 1', type: 'branch', active: true, createdAt: Date.now() })
  const s = await staff()
  const now = Date.now()
  const status = await writeAs(
    s.token,
    'stockMovements/hostile-1',
    {
      id: 'hostile-1', docNo: 'IS-99999', type: 'issue', productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 5,
      fromLocationId: 'wh', toLocationId: 'br1', transferId: 'no-such-transfer',
      date: now, byUserId: s.uid, byUserName: PEOPLE.staffA.name, createdAt: now,
    },
    { create: true },
  )
  test.info().annotations.push({ type: 'observed', description: `HTTP ${status}` })
  expect(status).toBe(403)
})

test('S5: staff cannot rewrite the quantity of a recorded movement', async () => {
  test.fail(true, 'audit S5 — closed by plan item A9 (movement edits are admin-only)')
  const now = Date.now()
  await putDoc('stockMovements/m-seed', {
    docNo: 'RC-00001', type: 'receive', productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 10,
    toLocationId: 'wh', date: now - DAY, byUserId: 'someone', byUserName: 'Someone', createdAt: now - DAY,
  })
  const s = await staff()
  const status = await writeAs(
    s.token,
    'stockMovements/m-seed',
    { qty: 1, edits: [{ by: s.uid, byName: PEOPLE.staffA.name, at: now, changed: ['qty'] }], updatedBy: s.uid, updatedByName: PEOPLE.staffA.name, updatedAt: now },
    { fields: ['qty', 'edits', 'updatedBy', 'updatedByName', 'updatedAt'] },
  )
  test.info().annotations.push({ type: 'observed', description: `HTTP ${status}` })
  expect(status).toBe(403)
})

test('B4: staff cannot place an order as already "ordered" without approval', async () => {
  test.fail(true, 'owner ruling 6 Oct 2026 (plan B4) — staff orders must wait for a manager or admin')
  const s = await staff()
  const now = Date.now()
  const status = await writeAs(
    s.token,
    'purchaseOrders/hostile-po',
    {
      id: 'hostile-po', docNo: 'PO-00099', supplierId: 'sup1', supplierName: 'E2E SUPPLIER', status: 'ordered', locationId: 'wh',
      orderedAt: now, lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 50 }],
      createdBy: s.uid, createdByName: PEOPLE.staffA.name, createdAt: now, updatedAt: now,
    },
    { create: true },
  )
  test.info().annotations.push({ type: 'observed', description: `HTTP ${status}` })
  expect(status).toBe(403)
})
