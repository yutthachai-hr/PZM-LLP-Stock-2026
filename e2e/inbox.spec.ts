import { expect, test } from '@playwright/test'
import { putDoc } from './emulator'
import { seedStage, PEOPLE } from './fixture'
import { signedIn } from './app'

const DAY = 86_400_000

/**
 * Plan C3: the Exception Inbox gathers what waits on a manager from every screen, worst
 * first, and a row opens the record that settles it.
 */
test('a manager sees the open decisions in one list and opens one', async ({ browser }) => {
  const stage = await seedStage()
  const now = Date.now()
  // A staff member's draft order (B4) and an order three days late.
  await putDoc('purchaseOrders/po2', {
    docNo: 'PO-00002', supplierId: 'sup1', supplierName: 'E2E SUPPLIER', status: 'draft', locationId: 'wh', orderedAt: now,
    lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 5 }],
    createdBy: stage.uid.staffA, createdByName: PEOPLE.staffA.name, createdAt: now - DAY, updatedAt: now - DAY,
  })
  await putDoc('purchaseOrders/po1', {
    docNo: 'PO-00001', supplierId: 'sup1', supplierName: 'E2E SUPPLIER', status: 'ordered', locationId: 'wh', orderedAt: now - 6 * DAY, expectedAt: now - 4 * DAY,
    lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10 }],
    createdBy: stage.uid.manager, createdByName: PEOPLE.manager.name, createdAt: now - 6 * DAY, updatedAt: now - 6 * DAY,
  })

  const page = await signedIn(browser, 'manager', '/inbox')
  const list = page.getByRole('list', { name: 'งานรอตัดสินใจ' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  // The late order is critical, so it comes first.
  await expect(list.getByRole('listitem').first()).toContainText('ของยังไม่มา')
  await expect(list.getByRole('listitem').nth(1)).toContainText('ใบสั่งซื้อร่างรออนุมัติ')

  await list.getByRole('link', { name: /ใบสั่งซื้อร่างรออนุมัติ/ }).click()
  await expect(page).toHaveURL(/\/orders\?po=po2/)
})

test('staff are sent home from the inbox (the menu hides it: tests/nav-items)', async ({ browser }) => {
  await seedStage()
  const page = await signedIn(browser, 'staffA', '/inbox')
  await expect(page).toHaveURL(/\/$/)
})
