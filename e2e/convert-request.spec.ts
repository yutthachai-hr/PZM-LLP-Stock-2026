import { expect, test, type Page } from '@playwright/test'
import { getDoc, listDocs, putDoc } from './emulator'
import { seedApprovedRequest, seedStage } from './fixture'
import { signedIn } from './app'
import { auditIntegrity } from '../src/lib/integrityAudit'

/**
 * Turning an approved request into orders (audit D4, plan A6). Exit gate: PR double
 * conversion = 0 — a double click, two tabs, or a lost reply all end with one order per
 * supplier and the request converted once.
 */

async function ordersOf(requestId: string) {
  return (await listDocs('purchaseOrders')).filter((o) => o.requestId === requestId)
}

async function openConvert(page: Page) {
  await page.locator('main').getByRole('button', { name: 'สร้างใบสั่งซื้อ' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

function confirmConvert(page: Page) {
  return page.getByRole('dialog').getByRole('button', { name: 'สร้างใบสั่งซื้อ' })
}

async function settled(page: Page) {
  await expect(page.getByRole('button', { name: 'กำลังสร้าง...' })).toHaveCount(0, { timeout: 30_000 })
}

/** What the gate measures: one order per supplier, each under its fixed id, converted once. */
async function expectConvertedOnce() {
  await expect.poll(async () => (await getDoc('purchaseRequests/pr1'))?.status, { timeout: 20_000 }).toBe('poCreated')
  const orders = await ordersOf('pr1')
  test.info().annotations.push({ type: 'observed', description: JSON.stringify(orders.map((o) => [o.id, o.docNo])) })
  expect(orders.map((o) => o.id).sort()).toEqual(['po_pr1_sup1', 'po_pr1_sup2'])
  const pr = await getDoc('purchaseRequests/pr1')
  expect((pr?.orders as unknown[] | undefined)?.length).toBe(2)
  expect(((pr?.history ?? []) as { action: string }[]).filter((h) => h.action === 'convertedToPo')).toHaveLength(1)
  // The stage's supplier had one order already: its counter moved by one, not two.
  expect((await getDoc('counters/purchaseOrder__sup1'))?.value).toBe(2)
  expect((await getDoc('purchaseOrders/po_pr1_sup1'))?.docNo).toBe('PO-00002')
}

test('one press: one order per supplier under fixed ids, request converted', async ({ browser }) => {
  const stage = await seedStage()
  await seedApprovedRequest(stage)
  const page = await signedIn(browser, 'manager', '/requests/pr1')
  await openConvert(page)
  await confirmConvert(page).click()
  await settled(page)
  await expectConvertedOnce()
})

test('double click on confirm: still one set of orders', async ({ browser }) => {
  const stage = await seedStage()
  await seedApprovedRequest(stage)
  const page = await signedIn(browser, 'manager', '/requests/pr1')
  await openConvert(page)
  await confirmConvert(page).dblclick()
  await settled(page)
  await expectConvertedOnce()
})

test('two tabs convert the same request at once: one set of orders, no error in words', async ({ browser }) => {
  const stage = await seedStage()
  await seedApprovedRequest(stage)
  const [a, b] = await Promise.all([signedIn(browser, 'manager', '/requests/pr1'), signedIn(browser, 'staffA', '/requests/pr1')])
  await openConvert(a)
  await openConvert(b)
  await Promise.all([confirmConvert(a).click(), confirmConvert(b).click()])
  for (const p of [a, b]) await settled(p)
  await expectConvertedOnce()
  const texts = await Promise.all([a, b].map((p) => p.locator('body').innerText()))
  expect(texts.join(' ')).not.toMatch(/PERMISSION_DENIED|insufficient permissions/i)
  // The tab that lost the race is handed the orders the other one made: its dialog closes
  // as on success (it stays open on an error).
  for (const p of [a, b]) await expect(p.getByRole('dialog')).toHaveCount(0)
})

test('the answer is lost after the save: pressing again creates nothing more', async ({ browser }) => {
  const stage = await seedStage()
  await seedApprovedRequest(stage)
  const page = await signedIn(browser, 'manager', '/requests/pr1')
  let cut = false
  await page.route('**/documents:commit*', async (route) => {
    if (cut) return route.continue()
    cut = true
    await route.fetch()
    await route.abort('connectionreset')
  })
  await openConvert(page)
  await confirmConvert(page).click()
  await settled(page)
  if (await confirmConvert(page).isVisible()) {
    await confirmConvert(page).click()
    await settled(page)
  }
  expect(cut).toBe(true)
  await expectConvertedOnce()

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
  expect(report.findings.filter((f) => f.code === 'requestStuckWithOrders')).toEqual([])
})

/**
 * A request an old conversion left halfway (one supplier's order made, request still
 * approved). Converting refuses and names the order; the admin's repair links it and
 * creates only the missing supplier's order.
 */
test('a request left halfway: conversion refuses, the admin links the leftover and the rest is created', async ({ browser }) => {
  const stage = await seedStage()
  await seedApprovedRequest(stage)
  const now = Date.now()
  await putDoc('purchaseOrders/legacy1', {
    docNo: 'PO-00002', supplierId: 'sup1', supplierName: 'E2E SUPPLIER', status: 'ordered', locationId: 'wh', orderedAt: now,
    lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 6 }], requestId: 'pr1',
    createdBy: stage.uid.manager, createdByName: 'E2E Manager', createdAt: now, updatedAt: now,
  })
  await putDoc('counters/purchaseOrder__sup1', { value: 2 })

  const manager = await signedIn(browser, 'manager', '/requests/pr1')
  await openConvert(manager)
  await confirmConvert(manager).click()
  await expect(manager.getByText(/PO-00002/).first()).toBeVisible()
  expect(await ordersOf('pr1')).toHaveLength(1)

  const admin = await signedIn(browser, 'admin', '/settings/stuckRequests')
  await admin.getByRole('button', { name: 'ตรวจหารายการที่ค้าง' }).click()
  await expect(admin.getByText('PR-00001')).toBeVisible()
  await admin.getByRole('button', { name: 'ผูกใบสั่งซื้อเดิมกับรายการนี้' }).click()
  await admin.getByRole('dialog').getByRole('button', { name: 'ผูกใบสั่งซื้อ' }).click()
  await expect(admin.getByText('ไม่มีรายการขอสั่งซื้อที่ค้าง')).toBeVisible({ timeout: 20_000 })

  const pr = await getDoc('purchaseRequests/pr1')
  expect(pr?.status).toBe('poCreated')
  expect((pr?.orders as { poId: string }[] | undefined)?.map((o) => o.poId)).toEqual(['legacy1', 'po_pr1_sup2'])
  expect((await ordersOf('pr1')).map((o) => o.id).sort()).toEqual(['legacy1', 'po_pr1_sup2'])
  expect((await getDoc('counters/purchaseOrder__sup1'))?.value).toBe(2) // nothing new for sup1
})
