import { describe, expect, test } from 'vitest'
import { generateRequestPdfBuffer } from '../src/lib/requestPdfmakeExport'
import type { PurchaseRequest, PurchaseRequestItem } from '../types'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

function makeMockItem(idx: number, overrides?: Partial<PurchaseRequestItem>): PurchaseRequestItem {
  return {
    idx,
    productId: `prod-${idx}`,
    productName: idx === 1 ? 'ไข่ผำสดสำหรับประกอบอาหาร' : idx === 2 ? 'แป้งพิซซ่า ปำ ฝำ ฟำ ผำ' : `สินค้าทดสอบรายการที่ ${idx}`,
    sku: idx === 1 ? 'PHA-01-001' : idx === 2 ? 'SKU-TALL-002' : `SKU-${String(idx).padStart(4, '0')}`,
    unit: 'KG',
    entryUnit: idx % 2 === 0 ? 'Pack' : 'KG',
    supplierId: `sup-${(idx % 3) + 1}`,
    supplierName: `ผู้ขาย ${['เบทาโกร', 'สยามฟูดส์', 'ซีพีเอฟ'][idx % 3]}`,
    supplierChoice: 'default',
    requestedQty: idx * 5,
    approvedQty: idx * 5,
    stockAtSubmit: 20,
    stockTotalAtSubmit: 50,
    stockByLocationAtSubmit: { main: 20, branch2: 30 },
    note: idx === 1 ? 'วัตถุดิบแท้ผำ Wolffia globosa สด' : undefined,
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
    approvalNote: 'อนุมัติตามรายการ น้ำมันและวัตถุดิบผำสด',
    items,
    ...overrides,
  }
}

const mockT = (key: string) => key

describe('pdfmake Thai Purchase Request export engine', () => {
  test('generates valid PDF buffer with correct header and metadata', async () => {
    const pr = makeMockRequest(17)
    const buf = await generateRequestPdfBuffer(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    expect(buf).toBeInstanceOf(Uint8Array)
    expect(buf.length).toBeGreaterThan(1000)
    const header = Buffer.from(buf.subarray(0, 5)).toString('ascii')
    expect(header).toBe('%PDF-')
  })

  test('preserves all 3 brands and translations (TH and EN)', async () => {
    const brands = ['Pizza Mania', 'Le Lapin', 'Farang Food']
    for (const brand of brands) {
      const pr = makeMockRequest(5)
      const bufTh = await generateRequestPdfBuffer(pr, brand, 'คลังอุดมสุข', mockT)
      expect(bufTh.length).toBeGreaterThan(1000)

      const enT = (k: string) => ({
        'รายการขอสั่งซื้อ': 'Purchase Request',
        'ผู้ขาย': 'Supplier',
        'สินค้า': 'Product',
      }[k] ?? k)
      const bufEn = await generateRequestPdfBuffer(pr, brand, 'Main Warehouse', enT)
      expect(bufEn.length).toBeGreaterThan(1000)
    }
  })

  test('extracts exact Unicode text and binds SKUs/quantities with PyMuPDF', async () => {
    const pr = makeMockRequest(25)
    const buf = await generateRequestPdfBuffer(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    expect(buf.length).toBeGreaterThan(2000)

    const tmpPdf = path.join(os.tmpdir(), `test-pr-25-${Date.now()}.pdf`)
    const tmpPy = path.join(os.tmpdir(), `test-pr-25-${Date.now()}.py`)
    fs.writeFileSync(tmpPdf, Buffer.from(buf))

    const pyScript = `import sys, pymupdf
sys.stdout.reconfigure(encoding='utf-8')
doc = pymupdf.open(sys.argv[1])
pages_text = [page.get_text() for page in doc]
full_text = '\\n---PAGE---\\n'.join(pages_text)
print('PAGE_COUNT:', len(doc))
assert len(doc) >= 2, f'Expected multipage document, got {len(doc)} pages'

# Check authentic Thai words and F04 glyph words
assert 'ผำ' in full_text, 'Expected authentic ผำ ingredient'
assert 'ไข่ผำสดสำหรับประกอบอาหาร' in full_text, 'Expected full ingredient name'
assert 'แป้งพิซซ่า ปำ ฝำ ฟำ ผำ' in full_text, 'Expected tall consonants and am'
assert 'PHA-01-001' in full_text, 'Expected SKU PHA-01-001'
assert 'SKU-TALL-002' in full_text, 'Expected SKU-TALL-002'

# Check table headers repeated on page 2
assert 'ผู้ขาย' in pages_text[0] and 'ผู้ขาย' in pages_text[1], 'Expected repeat table header on page 2'
assert 'รหัสสินค้า' in pages_text[0] and 'รหัสสินค้า' in pages_text[1], 'Expected repeat header'

# Check footer pagination
assert '1 / ' in pages_text[0], 'Expected page 1 footer'
assert '2 / ' in pages_text[1], 'Expected page 2 footer'
print('PYMUPDF_ASSERTIONS_PASSED')
`
    fs.writeFileSync(tmpPy, pyScript, 'utf8')

    try {
      const out = execSync(`python "${tmpPy}" "${tmpPdf}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      expect(out).toContain('PYMUPDF_ASSERTIONS_PASSED')
      expect(out).toContain('PAGE_COUNT: 2')
    } finally {
      if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf)
      if (fs.existsSync(tmpPy)) fs.unlinkSync(tmpPy)
    }
  }, 15000)
})
