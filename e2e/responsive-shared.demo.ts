import { test, expect, type Page } from '@playwright/test'
import * as path from 'node:path'
import * as fs from 'node:fs'

const VIEWPORTS = [
  { width: 320, height: 600, label: '320_phone_narrow' },
  { width: 375, height: 667, label: '375_iphone_se' },
  { width: 390, height: 844, label: '390_iphone_12_14' },
  { width: 414, height: 896, label: '414_iphone_xr_plus' },
  { width: 768, height: 1024, label: '768_tablet_portrait' },
  { width: 1024, height: 768, label: '1024_tablet_landscape' },
  { width: 1440, height: 900, label: '1440_desktop' },
]

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
  top: number
  bottom: number
  left: number
  right: number
}

export async function stage(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear()
    const now = Date.now()
    const store = (name: string, rows: Record<string, unknown>) =>
      localStorage.setItem(`pmstock:v1:${name}`, JSON.stringify(rows))

    const user = {
      id: 'transit-user',
      email: 'demo@inventory-pzm.local',
      name: 'Transit QA สมชาย สายลุย',
      role: 'admin',
      active: true,
      createdAt: now,
    }
    store('users', { 'transit-user': user })
    localStorage.setItem('pmstock:v1:session', user.id)
    localStorage.setItem('pmstock:v1:lastBrand', 'pizza')
    localStorage.setItem('pmstock:lang', 'th')

    store('locations', {
      wh: { id: 'wh', name: 'คลังสินค้าหลัก Main Warehouse', type: 'warehouse', active: true, createdAt: now },
      br: { id: 'br', name: 'สาขาทองหล่อ Thonglor Branch', type: 'branch', active: true, createdAt: now + 1 },
      transit: { id: 'transit', name: 'ระหว่างขนส่ง (Transit)', type: 'transit', active: true, createdAt: now + 2 },
    })

    // 21 products with long Thai/English names, SKUs, and decimal quantities
    const products: Record<string, unknown> = {}
    const transferItems: unknown[] = []
    for (let i = 1; i <= 21; i++) {
      const id = `p${i}`
      const sku = `TH-BKK-WH1-SKU-${String(i).padStart(4, '0')}-EXTRA-LONG-SPEC`
      const name =
        i === 1
          ? 'แป้งสาลีอเนกประสงค์เกรดพรีเมียมตรานกพิราบ 100% Organic Unbleached All-Purpose Flour (Extra Fine Mill)'
          : i === 2
            ? 'ไส้กรอกหมูรมควันสไตล์เวียนนาดั้งเดิม Smoked Vienna Pork Sausages with Natural Sheep Casing'
            : `วัตถุดิบทดสอบรายการที่ ${i} Long Product Name Description For Testing Responsive Viewport Overflows Item ${i}`
      const unit = i % 2 === 0 ? 'KG' : 'Pack'
      const cost = +(25.5 + i * 1.25).toFixed(2)
      products[id] = {
        id,
        sku,
        name,
        category: i <= 5 ? 'Dry' : i <= 10 ? 'Chilled' : i <= 15 ? 'Frozen' : 'Packaging',
        unit: unit === 'KG' ? 'กิโลกรัม' : 'แพ็ค',
        unitType: unit,
        minStock: 5,
        active: true,
        cost,
        createdAt: now,
        updatedAt: now,
      }
      transferItems.push({
        idx: i - 1,
        productId: id,
        productName: name,
        sku,
        unit,
        dispatchQty: +(i * 1.063).toFixed(3),
        dispatchEntryQty: +(i * 1.063).toFixed(3),
        dispatchEntryUnit: unit,
        requestedQty: +(i * 1.063).toFixed(3),
      })
    }
    store('products', products)

    store('transfers', {
      'tr-001': {
        id: 'tr-001',
        docNo: 'TR-20261025-0001',
        status: 'inTransit',
        revision: 1,
        fromLocationId: 'wh',
        toLocationId: 'br',
        dispatchDate: now,
        requestedBy: user.id,
        requestedByName: user.name,
        note: 'โอนสินค้าด่วนพิเศษสำหรับวันหยุดสุดสัปดาห์ Extra Urgent Weekend Batch Special Handling Required',
        items: transferItems,
        history: [],
        createdAt: now,
        updatedAt: now,
      },
    })

    store('suppliers', {
      'sup-001': {
        id: 'sup-001',
        name: 'บริษัท ฟู๊ดแกลเลอรี่ จำกัด (Food Gallery Co., Ltd.) สาขาใหญ่',
        code: 'V-00001',
        contactNumber: '02-123-4567',
        email: 'order@foodgallery.co.th',
        type: 'takingReturn',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    })

    store('purchaseOrders', {
      'po-001': {
        id: 'po-001',
        docNo: 'PO-20261025-0001',
        supplierId: 'sup-001',
        supplierName: 'บริษัท ฟู๊ดแกลเลอรี่ จำกัด (Food Gallery Co., Ltd.) สาขาใหญ่',
        status: 'ordered',
        locationId: 'wh',
        orderedAt: now,
        expectedAt: now + 86400000,
        lines: [
          {
            productId: 'p1',
            productName:
              'แป้งสาลีอเนกประสงค์เกรดพรีเมียมตรานกพิราบ 100% Organic Unbleached All-Purpose Flour (Extra Fine Mill)',
            unit: 'KG',
            orderedQty: 25.5,
          },
          {
            productId: 'p2',
            productName:
              'ไส้กรอกหมูรมควันสไตล์เวียนนาดั้งเดิม Smoked Vienna Pork Sausages with Natural Sheep Casing',
            unit: 'KG',
            orderedQty: 10.125,
          },
        ],
        createdBy: user.id,
        createdByName: user.name,
        createdAt: now,
        updatedAt: now,
      },
    })

    store('purchaseRequests', {
      'pr-001': {
        id: 'pr-001',
        docNo: 'PR-20261025-0001',
        status: 'pendingApproval',
        revision: 1,
        locationId: 'br',
        note: 'ขอสั่งซื้อวัตถุดิบเร่งด่วนสำหรับสาขาประจำสัปดาห์',
        items: [
          {
            idx: 0,
            productId: 'p1',
            productName:
              'แป้งสาลีอเนกประสงค์เกรดพรีเมียมตรานกพิราบ 100% Organic Unbleached All-Purpose Flour (Extra Fine Mill)',
            sku: 'TH-BKK-WH1-SKU-0001-EXTRA-LONG-SPEC',
            unit: 'KG',
            supplierId: 'sup-001',
            supplierName: 'บริษัท ฟู๊ดแกลเลอรี่ จำกัด (Food Gallery Co., Ltd.) สาขาใหญ่',
            supplierChoice: 'usual',
            requestedQty: 50.25,
          },
        ],
        requestedBy: user.id,
        requestedByName: user.name,
        history: [],
        createdBy: user.id,
        createdByName: user.name,
        createdAt: now,
        updatedAt: now,
      },
    })

    store('monthlyCounts', {
      'br__2026-10': {
        id: 'br__2026-10',
        locationId: 'br',
        month: '2026-10',
        countDate: now,
        status: 'counting',
        lines: {
          p1: { productId: 'p1', unit: 'KG', count: 12.35, countedAt: now, countedBy: user.id },
          p2: { productId: 'p2', unit: 'KG', count: 4.875, countedAt: now, countedBy: user.id },
        },
        createdBy: user.id,
        createdByName: user.name,
        createdAt: now,
        updatedAt: now,
      },
    })

    store('notifications', {
      'n-001': {
        id: 'n-001',
        kind: 'reorder',
        category: 'stock',
        priority: 'normal',
        to: { all: true },
        params: { productName: 'แป้งสาลีอเนกประสงค์เกรดพรีเมียมตรานกพิราบ', count: 1 },
        link: '/products/p1/card',
        active: true,
        readBy: {},
        source: 'client',
        createdBy: 'system',
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 86400000,
      },
    })
  })
}

test('probe: stage demo and check navigation on port 5215', async ({ page }) => {
  await stage(page)
  await page.goto('/')
  await expect(page.locator('main')).toBeVisible()
})
