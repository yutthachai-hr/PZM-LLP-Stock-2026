import { expect, test } from '@playwright/test'
import { getDoc, listDocs } from './emulator'
import { seedStage } from './fixture'
import { signedIn } from './app'
import { confirmButton, prepareFullReceipt } from './receive'

/**
 * Changing a placed order while the goods are being checked in (plan A7). The order is
 * read and written inside one transaction for cancel / amend / close short, so a cancel
 * racing a receipt ends one way or the other, never as a cancelled order with stock in.
 */
test('cancel and receive pressed at the same moment: the order and the ledger agree', async ({ browser }) => {
  await seedStage()
  const [receiver, buyer] = await Promise.all([signedIn(browser, 'staffA', '/receive?po=po1'), signedIn(browser, 'manager', '/orders?po=po1')])
  await prepareFullReceipt(receiver, 'INV-A7')

  // The buyer opens the order in the side panel and gets the cancel dialog ready.
  await buyer.getByRole('button', { name: 'เพิ่มเติม' }).click()
  await buyer.getByRole('button', { name: 'ยกเลิกใบสั่งซื้อ' }).click()
  await buyer.getByRole('dialog').locator('textarea').fill('ผู้ขายแจ้งของหมด')
  const cancelConfirm = buyer.getByRole('dialog').getByRole('button', { name: 'ยกเลิกใบสั่งซื้อ' })

  await Promise.all([confirmButton(receiver).click(), cancelConfirm.click()])
  await expect(receiver.getByRole('button', { name: 'กำลังบันทึก...' })).toHaveCount(0, { timeout: 30_000 })
  await buyer.waitForTimeout(3000)

  const po = await getDoc('purchaseOrders/po1')
  const rows = (await listDocs('stockMovements')).filter((m) => m.poId === 'po1' && !m.voided)
  const flour = (await getDoc('stockLevels/wh__flour'))?.qty ?? 0
  test.info().annotations.push({ type: 'observed', description: JSON.stringify({ status: po?.status, rows: rows.length, flour }) })
  if (po?.status === 'cancelled') {
    expect(rows).toHaveLength(0)
    expect(flour).toBe(0)
  } else {
    expect(po?.status).toBe('received')
    expect(rows).toHaveLength(2)
    expect(flour).toBe(10)
    expect(po?.cancelledAt).toBeUndefined()
  }
})
