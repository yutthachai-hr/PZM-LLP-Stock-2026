import { expect, test, type Page } from '@playwright/test'
import { getDoc, listDocs, putDoc } from './emulator'
import { seedStage } from './fixture'
import { signedIn } from './app'
import { countDayOf } from '../src/lib/monthlyCount'
import { auditIntegrity } from '../src/lib/integrityAudit'
import { supplierAnswerDraft, toDoc } from '../src/lib/inventoryRules/notifications'
import type { PurchaseOrder } from '../src/types'

/**
 * Pre-production business flow (release gate, owner 6 Oct 2026), through the screens under
 * the real rules and the real stock-command server:
 *
 *   staff purchase request → manager approves → PO → supplier changes the date (popup and
 *   sound) → partial receipt with rejected goods → network drops, then the rest is received
 *   → transfer to a branch (a stale second tab tries to approve it too) → branch receives
 *   (double click) → monthly count with a large variance, approved → posted
 *
 * and at the end the integrity auditor finds nothing that disagrees. The supplier's own link
 * is a Pages Function the e2e server does not serve, so its effect — the notification the
 * server writes — is written with the server's own builder (supplierAnswerDraft + toDoc);
 * the endpoint itself is covered by tests/functions/supplier-po.test.ts.
 */
const DAY = 86_400_000
const MONTH = '2026-09'
const COUNT_DAY = countDayOf(MONTH)

const level = async (loc: string, product: string) => ((await getDoc(`stockLevels/${loc}__${product}`))?.qty as number | undefined) ?? 0
const toast = (page: Page, text: string | RegExp) => page.getByText(text).first()

test('the whole business flow, end to end, leaves the books consistent', async ({ browser }) => {
  test.setTimeout(420_000)
  const stage = await seedStage()
  const now = Date.now()
  // The stage plus what the flow needs: a branch, the in-transit location, flour bought from
  // the stage's supplier, and 10 flour on the books before last month's count day.
  await putDoc('locations/b1', { name: 'Branch One', type: 'branch', active: true, createdAt: now })
  await putDoc('locations/transit', { name: 'In transit', type: 'transit', active: true, createdAt: now })
  await putDoc('products/flour', { sku: 'DRY-01-001', name: 'FLOUR', category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 0, supplierId: 'sup1', hasImage: false, active: true, createdAt: now, updatedAt: now })
  await putDoc('stockMovements/m0', {
    docNo: 'RC-00001', type: 'receive', productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 10, toLocationId: 'wh',
    date: COUNT_DAY - DAY, byUserId: stage.uid.manager, byUserName: 'E2E Manager', createdAt: now,
  })
  await putDoc('stockLevels/wh__flour', { productId: 'flour', locationId: 'wh', qty: 10, updatedAt: now, updatedBy: stage.uid.manager })
  await putDoc('counters/receive', { value: 1 })
  const timing: Record<string, number> = {}
  const step = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now()
    await test.step(name, fn)
    timing[name] = Date.now() - t0
  }

  // 1. Staff ask for 20 KG of flour for the warehouse and send it for review.
  let prId = ''
  await step('staff purchase request', async () => {
    const staff = await signedIn(browser, 'staffA', '/requests/new')
    await staff.getByLabel('คลังปลายทาง').selectOption({ label: 'Main Warehouse' })
    await staff.getByPlaceholder('ค้นหาชื่อสินค้า / รหัสสินค้า').fill('FLOUR')
    await staff.getByRole('option').getByRole('button', { name: /FLOUR/ }).first().click()
    await staff.locator('main input[type=number]').first().fill('20')
    await staff.getByRole('button', { name: 'เพิ่มรายการ' }).click()
    await expect(toast(staff, 'เพิ่ม FLOUR แล้ว')).toBeVisible()
    await staff.getByRole('button', { name: 'ส่งให้หัวหน้าตรวจ' }).click()
    await staff.getByRole('dialog').getByRole('button', { name: 'ส่งให้หัวหน้าตรวจ' }).click()
    await expect.poll(async () => (await listDocs('purchaseRequests')).find((r) => r.status === 'pendingApproval')?.id, { timeout: 20_000 }).toBeTruthy()
    prId = (await listDocs('purchaseRequests')).find((r) => r.status === 'pendingApproval')!.id
    expect((await getDoc(`purchaseRequests/${prId}`))?.intake).toEqual(['manual'])
    await staff.context().close()
  })

  // 2. The manager approves it and turns it into the order.
  const poId = () => `po_${prId}_sup1`
  const manager = await signedIn(browser, 'manager', '/')
  await step('manager approves, order placed', async () => {
    await manager.goto(`/requests/${prId}`)
    await manager.getByRole('button', { name: 'อนุมัติทั้งหมด' }).click()
    await manager.getByRole('dialog').getByRole('button', { name: 'อนุมัติ', exact: true }).click()
    await expect.poll(async () => (await getDoc(`purchaseRequests/${prId}`))?.status, { timeout: 20_000 }).toBe('approved')
    await manager.locator('main').getByRole('button', { name: 'สร้างใบสั่งซื้อ' }).click()
    await manager.getByRole('dialog').getByRole('button', { name: 'สร้างใบสั่งซื้อ' }).click()
    await expect.poll(async () => (await getDoc(`purchaseRequests/${prId}`))?.status, { timeout: 20_000 }).toBe('poCreated')
    expect((await getDoc(`purchaseOrders/${poId()}`))?.status).toBe('ordered')
  })

  // 3. The supplier moves the delivery date: the order's people get a popup and a sound.
  await step('supplier date change: popup and sound', async () => {
    await manager.goto('/')
    await manager.locator('main').click({ position: { x: 5, y: 5 } }) // a gesture, so the browser lets sound play
    const po = { ...(await getDoc(`purchaseOrders/${poId()}`)), id: poId() } as unknown as PurchaseOrder
    const at = Date.now()
    const doc = toDoc(supplierAnswerDraft(po, 'supplierDateChanged', 'c1', at + 2 * DAY, 'Somchai'), at, 'worker', 'supplier-link')
    await putDoc(`notifications/${doc.id}`, doc as unknown as Record<string, unknown>)
    await expect(manager.getByRole('status').filter({ hasText: /ผู้ขายเปลี่ยนวันส่ง/ }).first()).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(async () => manager.evaluate(() => JSON.stringify((window as unknown as { __pzmNotificationLog?: unknown[] }).__pzmNotificationLog ?? [])), { timeout: 10_000 })
      .toMatch(/"sound".*"warning"/)
  })

  // 4. Part of the delivery: 12 taken in, 3 refused as damaged, 5 still owed.
  await step('partial receipt with rejected goods', async () => {
    const staff = await signedIn(browser, 'staffA', `/receive?po=${poId()}`)
    await staff.getByLabel('รับครั้งนี้: FLOUR').fill('12')
    await staff.getByRole('button', { name: '+ ตีกลับ / ไม่รับของบางส่วน' }).first().click()
    await staff.getByLabel('จำนวนที่ตีกลับ: FLOUR').fill('3')
    await staff.getByLabel('เหตุผลที่ตีกลับ: FLOUR').selectOption('damaged')
    await staff.getByLabel(/เลขที่เอกสาร \/ ใบกำกับ/).fill('INV-BF-1')
    await staff.getByRole('button', { name: 'ตรวจสอบและรับสินค้า' }).click()
    await staff.getByRole('dialog').getByRole('button', { name: 'ยืนยันรับเข้าคลัง' }).click()
    await expect.poll(async () => ((await getDoc(`purchaseOrders/${poId()}`))?.lines as { receivedQty?: number }[] | undefined)?.[0]?.receivedQty, { timeout: 20_000 }).toBe(12)
    const po = await getDoc(`purchaseOrders/${poId()}`)
    expect(po?.status).toBe('ordered')
    expect(await level('wh', 'flour')).toBe(22) // rejected goods never enter stock
    await staff.context().close()
  })

  // 5. The rest arrives. The network drops as it is confirmed; pressing again once it is
  //    back files it exactly once.
  await step('network interruption, then the remaining receipt', async () => {
    const staff = await signedIn(browser, 'staffA', `/receive?po=${poId()}`)
    await staff.getByRole('button', { name: 'รับครบตาม PO ทั้งหมด' }).click()
    await staff.getByLabel(/เลขที่เอกสาร \/ ใบกำกับ/).fill('INV-BF-2')
    await staff.getByRole('button', { name: 'ตรวจสอบและรับสินค้า' }).click()
    const confirm = staff.getByRole('dialog').getByRole('button', { name: 'ยืนยันรับเข้าคลัง' })
    await staff.context().setOffline(true)
    await confirm.click()
    await staff.waitForTimeout(2_500)
    await staff.context().setOffline(false)
    await staff.waitForTimeout(1_000)
    if ((await getDoc(`purchaseOrders/${poId()}`))?.status !== 'received') {
      if (!(await confirm.isVisible().catch(() => false))) {
        await staff.getByRole('button', { name: 'ตรวจสอบและรับสินค้า' }).click()
      }
      await confirm.click()
    }
    await expect.poll(async () => (await getDoc(`purchaseOrders/${poId()}`))?.status, { timeout: 30_000 }).toBe('received')
    const po = await getDoc(`purchaseOrders/${poId()}`)
    expect((po?.receipts as unknown[]).length).toBe(2)
    expect(await level('wh', 'flour')).toBe(27) // 10 + 12 + 5, once
    await staff.context().close()
  })

  // 6. 5 KG to the branch. A second manager tab opened before the approval is stale: its
  //    approval must not move the stock a second time.
  let trId = ''
  await step('transfer request, approval, stale tab', async () => {
    await manager.goto('/transfers/new')
    await manager.getByLabel('จากคลัง / สาขา (ต้นทาง)').selectOption({ label: 'Main Warehouse' })
    await manager.getByLabel('ไปยังสาขา (ปลายทาง)').selectOption({ label: 'Branch One' })
    await manager.getByPlaceholder('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)').fill('FLOUR')
    await manager.getByRole('button', { name: /FLOUR/ }).first().click()
    await manager.getByRole('dialog').getByLabel('จำนวน').fill('5')
    await manager.getByRole('dialog').getByRole('button', { name: 'เพิ่มรายการ' }).click()
    await manager.getByRole('button', { name: /ส่งคำขอโอนสินค้า/ }).click()
    await expect.poll(async () => (await listDocs('transfers')).find((t) => t.status === 'pendingApproval')?.id, { timeout: 20_000 }).toBeTruthy()
    trId = (await listDocs('transfers')).find((t) => t.status === 'pendingApproval')!.id

    const stale = await manager.context().newPage()
    await stale.goto(`/transfers/${trId}`)
    await expect(stale.getByRole('button', { name: 'อนุมัติและตัดสต๊อกขนส่ง' })).toBeVisible({ timeout: 20_000 })

    await manager.goto(`/transfers/${trId}`)
    await manager.getByRole('button', { name: 'อนุมัติและตัดสต๊อกขนส่ง' }).click()
    await manager.getByRole('dialog').getByRole('button', { name: 'ยืนยันอนุมัติและตัดสต๊อก' }).click()
    await expect.poll(async () => (await getDoc(`transfers/${trId}`))?.status, { timeout: 20_000 }).toBe('inTransit')

    // The stale tab: either it has already updated and offers nothing, or pressing is refused.
    const staleButton = stale.getByRole('button', { name: 'อนุมัติและตัดสต๊อกขนส่ง' })
    if (await staleButton.isVisible().catch(() => false)) {
      await staleButton.click()
      const ok = stale.getByRole('dialog').getByRole('button', { name: 'ยืนยันอนุมัติและตัดสต๊อก' })
      if (await ok.isVisible().catch(() => false)) await ok.click()
      await expect(stale.getByText(/เอกสารมีการแก้ไข กรุณาโหลดใหม่|เอกสารไม่ได้อยู่ในสถานะรออนุมัติ/).first()).toBeVisible({ timeout: 15_000 })
    }
    await stale.close()
    expect(await level('wh', 'flour')).toBe(22)
    expect(await level('transit', 'flour')).toBe(5)
  })

  // 7. The branch receives it — the confirm pressed twice in a row files it once.
  await step('branch receives (double click)', async () => {
    await manager.goto(`/transfers/${trId}/receive`)
    await manager.getByRole('button', { name: 'รับครบตามใบส่ง' }).click()
    await manager.getByRole('button', { name: /^ยืนยันรับสินค้า$/ }).first().dblclick()
    const dialogOk = manager.getByRole('dialog').getByRole('button', { name: 'ยืนยันรับสินค้า' })
    if (await dialogOk.isVisible().catch(() => false)) await dialogOk.dblclick()
    await expect.poll(async () => (await getDoc(`transfers/${trId}`))?.status, { timeout: 20_000 }).toBe('completed')
    expect(await level('b1', 'flour')).toBe(5)
    expect(await level('transit', 'flour')).toBe(0)
  })

  // 8. Last month's count at the warehouse: 9 on the shelf against 10 on the books (10%),
  //    so the manager approves the difference before it posts.
  await step('count with a large variance, approved, posted', async () => {
    const at = Date.now()
    await putDoc(`monthlyCounts/wh__${MONTH}`, {
      locationId: 'wh', month: MONTH, countDate: COUNT_DAY, status: 'counting',
      lines: { flour: { qty: 9, by: stage.uid.staffA, byName: 'E2E Staff A', at } },
      createdBy: stage.uid.staffA, createdByName: 'E2E Staff A', createdAt: at, updatedAt: at,
    })
    await manager.goto(`/counts/wh__${MONTH}`)
    await manager.getByRole('button', { name: 'ยืนยันและปรับสต๊อก' }).first().click()
    await manager.getByRole('dialog').getByLabel(/ตรวจผลต่างมาก/).check()
    await manager.getByRole('dialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click()
    await expect.poll(async () => (await getDoc(`monthlyCounts/wh__${MONTH}`))?.status, { timeout: 20_000 }).toBe('posted')
    expect(await level('wh', 'flour')).toBe(21) // 9 counted + 17 received − 5 sent after the count day
  })

  // 9. Everything the app wrote, checked against itself.
  await step('integrity audit', async () => {
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
    test.info().annotations.push({ type: 'audit', description: JSON.stringify({ scanned: report.scanned, findings: report.findings.map((f) => `${f.severity}:${f.code}`) }) })
    expect(report.findings.filter((f) => f.severity !== 'info')).toEqual([])
  })
  test.info().annotations.push({ type: 'timing', description: JSON.stringify(timing) })
})
