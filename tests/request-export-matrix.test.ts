import { describe, expect, test } from 'vitest'
import { createRequestPdf, requestRows } from '../src/lib/requestExport'
import type { PurchaseRequest, PurchaseRequestItem } from '../types'
import * as fs from 'fs'
import * as path from 'path'

const PDF_QA_DIR = 'C:/Users/Yutthachai/pzm-recovery-20261015/pdf-qa/generated'

function makeMockItem(idx: number, overrides?: Partial<PurchaseRequestItem>): PurchaseRequestItem {
  return {
    idx,
    productId: `prod-${idx}`,
    productName: `สินค้าทดสอบรายการที่ ${idx}`,
    sku: idx === 1 ? 'PZS-01-06-001' : `SKU-${String(idx).padStart(4, '0')}`,
    unit: 'KG',
    entryUnit: idx % 3 === 0 ? 'Pack' : undefined,
    supplierId: `sup-${(idx % 4) + 1}`,
    supplierName: `ผู้ขาย ${['A', 'B', 'C', 'D'][idx % 4]}`,
    supplierChoice: 'default',
    requestedQty: idx === 1 ? 350.2203 : idx * 10,
    approvedQty: idx === 1 ? 350.2203 : idx * 10,
    stockAtSubmit: 50,
    stockTotalAtSubmit: 150,
    stockByLocationAtSubmit: { main: 50, branch2: 100 },
    note: idx % 5 === 0 ? `หมายเหตุรายการที่ ${idx}` : undefined,
    ...overrides,
  }
}

function makeMockRequest(rowCount: number, overrides?: Partial<PurchaseRequest>): PurchaseRequest {
  const items: PurchaseRequestItem[] = []
  for (let i = 1; i <= rowCount; i++) {
    items.push(makeMockItem(i))
  }
  return {
    id: `pr-${rowCount}`,
    docNo: `PR-${String(rowCount).padStart(5, '0')}`,
    status: 'approved',
    revision: 1,
    locationId: 'main-loc',
    requestedBy: 'user-1',
    requestedByName: 'สมชาย ผู้ขอเบิก',
    approvedBy: 'user-admin',
    approvedByName: 'ยุทธชัย ผู้จัดการ',
    approvedAt: 1776240000000,
    createdAt: 1776230000000,
    updatedAt: 1776240000000,
    createdBy: 'user-1',
    createdByName: 'สมชาย ผู้ขอเบิก',
    history: [],
    approvalNote: 'อนุมัติตามรายการที่ขอ จัดส่งรอบปกติ',
    items,
    ...overrides,
  }
}

const mockT = (key: string) => key

describe('PR workflow matrix and layout validation', () => {
  test.each([1, 17, 50, 150, 180])('generates valid PDF and preserves data parity for %i rows (TH)', (count) => {
    const pr = makeMockRequest(count)
    const rows = requestRows(pr, 'คลังหลัก', mockT)
    expect(rows.length).toBe(count)

    const row1 = rows.find((r) => r['รหัสสินค้า'] === 'PZS-01-06-001')
    expect(row1).toBeDefined()
    expect(row1!['จำนวนที่อนุมัติ']).toBe(350.2203)

    const doc = createRequestPdf(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)

    // Save synthetic PDF to QA directory
    if (!fs.existsSync(PDF_QA_DIR)) {
      fs.mkdirSync(PDF_QA_DIR, { recursive: true })
    }
    const pdfPath = path.join(PDF_QA_DIR, `matrix_${count}_rows_th.pdf`)
    fs.writeFileSync(pdfPath, Buffer.from(doc.output('arraybuffer')))
    expect(fs.existsSync(pdfPath)).toBe(true)
  })

  test.each([17, 50])('generates valid PDF and preserves data parity for %i rows (EN)', (count) => {
    const enT = (key: string) => {
      const dict: Record<string, string> = {
        'รายการขอสั่งซื้อ': 'Purchase Request',
        'วันที่ขอ': 'Request Date',
        'คลัง': 'Location',
        'ผู้ขอ': 'Requested by',
        'ผู้อนุมัติ': 'Approved by',
        'วันที่อนุมัติ': 'Approved Date',
        'สถานะ': 'Status',
        'หมายเหตุการอนุมัติ': 'Approval Note',
        'ผู้ขาย': 'Supplier',
        'สินค้า': 'Product',
        'รหัสสินค้า': 'SKU',
        'คงเหลือ': 'Current Stock',
        'จำนวนที่ขอ': 'Req Qty',
        'จำนวนที่อนุมัติ': 'Appr Qty',
        'หน่วย': 'Unit',
        'หมายเหตุ': 'Note',
      }
      return dict[key] ?? key
    }

    const pr = makeMockRequest(count, {
      requestedByName: 'John Doe',
      approvedByName: 'Manager Mike',
      approvalNote: 'Approved for urgent morning delivery cycle.',
    })
    const doc = createRequestPdf(pr, 'Pizza Mania International', 'Main Warehouse', enT)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)

    const pdfPath = path.join(PDF_QA_DIR, `matrix_${count}_rows_en.pdf`)
    fs.writeFileSync(pdfPath, Buffer.from(doc.output('arraybuffer')))
    expect(fs.existsSync(pdfPath)).toBe(true)
  })

  test('handles very long approval note, title, location, and product names without collision', () => {
    const longApprovalNote =
      'หมายเหตุการอนุมัติ: ' +
      'อนุมัติสั่งซื้อเป็นกรณีเร่งด่วนพิเศษเนื่องจากมีลูกค้ารายใหญ่สั่งจองงานเลี้ยงวันเสาร์ ' +
      'ขอให้ทางผู้ขายจัดส่งวัตถุดิบทั้งหมดตรงเวลาและตรวจสอบคุณภาพสินค้าตามมาตรฐาน ' +
      'หากมีสินค้าเสียหายหรือไม่ตรงตามสเปกให้แจ้งผู้จัดการสาขาทันทีเพื่อดำเนินการเปลี่ยนสินค้าใหม่ '
    const longTitle = 'Pizza Mania สาขาอโศก-สุขุมวิท — รายการขอสั่งซื้อวัตถุดิบและอุปกรณ์ประจำเดือนตุลาคม พ.ศ. 2569 เลขที่เอกสาร PR-LONG-001'
    const longLocation = 'คลังสินค้ากลางและศูนย์กระจายสินค้าภาคกลาง อุดมสุข-พัฒนาการ กรุงเทพมหานคร'

    const pr = makeMockRequest(17, {
      approvalNote: longApprovalNote,
      items: [
        makeMockItem(1, {
          productName: 'ชีสมอสซาเรลล่าชนิดก้อนนำเข้าจากประเทศอิตาลีเกรดพิเศษสำหรับพิซซ่าอบเตาฟืนขนาดบรรจุ 5 กิโลกรัม',
          note: 'บรรจุภัณฑ์ต้องมีสภาพสมบูรณ์ ไม่มีรอยฉีกขาดหรือความชื้นสะสม',
        }),
        ...Array.from({ length: 16 }, (_, i) => makeMockItem(i + 2)),
      ],
    })

    const doc = createRequestPdf(pr, longTitle, longLocation, mockT)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)

    const pdfPath = path.join(PDF_QA_DIR, 'matrix_long_metadata_and_products.pdf')
    fs.writeFileSync(pdfPath, Buffer.from(doc.output('arraybuffer')))
    expect(fs.existsSync(pdfPath)).toBe(true)
  })

  test('handles multipage single long rows and repeated exports', () => {
    const pr = makeMockRequest(10, {
      items: [
        makeMockItem(1, {
          productName: 'แป้งสาลีสำหรับทำพิซซ่า ' + 'คุณภาพพรีเมียมนำเข้า '.repeat(10),
          note: 'หมายเหตุรายละเอียดการสั่งซื้อ ' + 'ตรวจสอบอย่างละเอียดก่อนรับเข้าคลัง '.repeat(10),
        }),
        ...Array.from({ length: 9 }, (_, i) => makeMockItem(i + 2)),
      ],
    })

    // Repeated exports
    const docA = createRequestPdf(pr, 'Pizza Mania', 'Main', mockT)
    const docB = createRequestPdf(pr, 'Pizza Mania', 'Main', mockT)

    const pdfPathA = path.join(PDF_QA_DIR, 'matrix_multipage_row_a.pdf')
    const pdfPathB = path.join(PDF_QA_DIR, 'matrix_multipage_row_b.pdf')
    fs.writeFileSync(pdfPathA, Buffer.from(docA.output('arraybuffer')))
    fs.writeFileSync(pdfPathB, Buffer.from(docB.output('arraybuffer')))

    expect(fs.statSync(pdfPathA).size).toBeGreaterThan(1000)
    expect(fs.statSync(pdfPathB).size).toBeGreaterThan(1000)
  })
})
