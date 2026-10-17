import { describe, expect, test, vi } from 'vitest'
import { generateRequestPdfBuffer, generateAndDownloadRequestPdf } from '../src/lib/requestPdfmakeExport'
import * as pdfmakeExport from '../src/lib/requestPdfmakeExport'
import { exportRequestPdf, groupedBySupplier } from '../src/lib/requestExport'
import { fmtQty, formatThaiDate } from '../src/lib/format'
import { PR_STATUS_KEYS } from '../src/lib/purchaseRequestStatus'
import type { PurchaseRequest, PurchaseRequestItem } from '../src/types'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

function getPythonCommand(): string {
  if (process.env.PYTHON_VENV_PATH) {
    const venvPython =
      process.platform === 'win32'
        ? path.join(process.env.PYTHON_VENV_PATH, 'Scripts', 'python.exe')
        : path.join(process.env.PYTHON_VENV_PATH, 'bin', 'python')
    if (fs.existsSync(venvPython)) return venvPython
  }
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
}

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

function buildExpectedSpec(pr: PurchaseRequest, company: string, locationName: string, t: (k: string) => string) {
  const cols = [
    t('ผู้ขาย'),
    t('สินค้า'),
    t('รหัสสินค้า'),
    t('คงเหลือ'),
    t('จำนวนที่ขอ'),
    t('จำนวนที่อนุมัติ'),
    t('หน่วย'),
    t('หมายเหตุ'),
  ]

  const rows: (string | number)[][] = []
  for (const g of groupedBySupplier(pr)) {
    for (const i of g.items) {
      rows.push([
        g.supplierName,
        i.productName,
        i.sku,
        i.stockAtSubmit === undefined ? '-' : fmtQty(i.stockAtSubmit),
        i.requestedQty === null ? '-' : fmtQty(i.requestedQty),
        i.approvedQty === undefined ? '-' : fmtQty(i.approvedQty),
        i.entryUnit ?? i.unit,
        [i.note, i.managerAdded ? t('หัวหน้าเพิ่ม') : '', i.supplierChoice === 'custom' ? t('เลือกผู้ขายเอง') : '']
          .filter(Boolean)
          .join(' · '),
      ])
    }
  }

  const title = `${company} — ${t('รายการขอสั่งซื้อ')} ${pr.docNo}`
  const subtitle = `${t('วันที่ขอ')} ${formatThaiDate(pr.createdAt)} · ${t('คลัง')} ${locationName}`
  const metaLines = [
    `${t('ผู้ขอ')}: ${pr.requestedByName}`,
    pr.approvedByName
      ? `${t('ผู้อนุมัติ')}: ${pr.approvedByName} · ${t('วันที่อนุมัติ')} ${pr.approvedAt ? formatThaiDate(pr.approvedAt) : ''}`
      : `${t('สถานะ')}: ${t(PR_STATUS_KEYS[pr.status])}`,
    ...(pr.approvalNote ? [`${t('หมายเหตุการอนุมัติ')}: ${pr.approvalNote}`] : []),
  ]

  return {
    cols,
    rows,
    head: [title, subtitle, ...metaLines],
  }
}

describe('pdfmake Thai Purchase Request export engine', () => {
  test('exportRequestPdf propagates errors without silent fallback to legacy jsPDF', async () => {
    const pr = makeMockRequest(1)
    const err = new Error('Forced pdfmake renderer failure')
    const spy = vi.spyOn(pdfmakeExport, 'generateAndDownloadRequestPdf').mockRejectedValueOnce(err)
    await expect(exportRequestPdf(pr, 'Pizza Mania', 'คลังหลัก', mockT)).rejects.toThrow('Forced pdfmake renderer failure')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  test('exportRequestPdf calls generateAndDownloadRequestPdf once on success', async () => {
    const pr = makeMockRequest(1)
    const spy = vi.spyOn(pdfmakeExport, 'generateAndDownloadRequestPdf').mockResolvedValueOnce(undefined)
    await exportRequestPdf(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(pr, 'Pizza Mania', 'คลังหลัก', mockT)
  })

  test('generateAndDownloadRequestPdf calls doc.download with expected document filename', async () => {
    const pr = makeMockRequest(2)
    const pdfMakeMod = await import('pdfmake/build/pdfmake.js')
    const pdfMake = pdfMakeMod.default || pdfMakeMod
    let downloadArg: string | undefined
    const originalCreatePdf = pdfMake.createPdf
    pdfMake.createPdf = ((docDef: Record<string, unknown>, opts?: Record<string, unknown>) => {
      const doc = originalCreatePdf.call(pdfMake, docDef, opts)
      doc.download = async (filename?: string) => {
        downloadArg = filename
      }
      return doc
    }) as typeof pdfMake.createPdf

    try {
      await generateAndDownloadRequestPdf(pr, 'Pizza Mania', 'คลังหลัก', mockT)
      expect(downloadArg).toBe(`${pr.docNo}.pdf`)
    } finally {
      pdfMake.createPdf = originalCreatePdf
    }
  })

  test('generates valid PDF buffer with correct header and metadata', async () => {
    const pr = makeMockRequest(17)
    const buf = await generateRequestPdfBuffer(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    expect(buf).toBeInstanceOf(Uint8Array)
    expect(buf.length).toBeGreaterThan(1000)
    const header = Buffer.from(buf.subarray(0, 5)).toString('ascii')
    expect(header).toBe('%PDF-')
  })

  test('preserves all 3 actual brands (Pizza, Le Lapin, R&D) and metadata', async () => {
    const brands = ['Pizza Mania', 'Le Lapin Sandwich Delivery', 'R&D (Research & Development)']
    const enT = (k: string) =>
      ({
        'รายการขอสั่งซื้อ': 'Purchase Request',
        'ผู้ขาย': 'Supplier',
        'สินค้า': 'Product',
        'ผู้ขอ': 'Requester',
        'ผู้อนุมัติ': 'Approver',
      }[k] ?? k)
    const scenarios = [
      {
        language: 'th',
        translate: mockT,
        location: 'คลังอุดมสุข',
        expectedHead: ['รายการขอสั่งซื้อ PR-00005', 'ผู้ขอ: สมชาย ผู้ขอเบิก', 'ผู้อนุมัติ: ยุทธชัย ผู้จัดการ'],
      },
      {
        language: 'en',
        translate: enT,
        location: 'Main Warehouse',
        expectedHead: ['Purchase Request PR-00005', 'Requester: สมชาย ผู้ขอเบิก', 'Approver: ยุทธชัย ผู้จัดการ', 'Supplier', 'Product'],
      },
    ]
    for (const brand of brands) {
      for (const { language, translate, location, expectedHead } of scenarios) {
        const pr = makeMockRequest(5)
        const buf = await generateRequestPdfBuffer(pr, brand, location, translate)
        expect(buf.length).toBeGreaterThan(1000)
        const tmpBase = path.join(os.tmpdir(), `test-brand-${language}-${Date.now()}`)
        const tmpPdf = `${tmpBase}.pdf`
        const tmpSpec = `${tmpBase}.json`
        fs.writeFileSync(tmpPdf, Buffer.from(buf))
        fs.writeFileSync(tmpSpec, JSON.stringify({
          ...buildExpectedSpec(pr, brand, location, translate),
          // Hand-checked literals: wrong company, location, names or locale must fail.
          head: [brand, location, ...expectedHead],
        }), 'utf8')
        try {
          const inspectRes = spawnSync(
            getPythonCommand(),
            ['tests/verify_document_structure.py', 'inspect', tmpPdf],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          )
          expect(inspectRes.status).toBe(0)
          const parsed = JSON.parse(inspectRes.stdout.trim())
          expect(parsed.pageCount).toBeGreaterThanOrEqual(1)
          expect(parsed.puaCount).toBe(0)
          expect(parsed.actualTextCount).toBe(0)
          const verified = spawnSync(
            getPythonCommand(),
            ['tests/verify_document_structure.py', 'verify', tmpPdf, tmpSpec],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          )
          expect(verified.status).toBe(0)
          expect(JSON.parse(verified.stdout.trim())).toEqual({ ok: true, errors: [] })
        } finally {
          if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf)
          if (fs.existsSync(tmpSpec)) fs.unlinkSync(tmpSpec)
        }
      }
    }
  }, 15000)

  test('cell-by-cell 2D table grid verification on actual NEW app PDF buffer (17 rows)', async () => {
    const pr = makeMockRequest(17)
    const buf = await generateRequestPdfBuffer(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    expect(buf.length).toBeGreaterThan(2000)

    const spec = buildExpectedSpec(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    const tmpPdf = path.join(os.tmpdir(), `test-app-17-${Date.now()}.pdf`)
    const tmpSpec = path.join(os.tmpdir(), `test-app-17-spec-${Date.now()}.json`)

    fs.writeFileSync(tmpPdf, Buffer.from(buf))
    fs.writeFileSync(tmpSpec, JSON.stringify(spec, null, 2), 'utf8')

    try {
      const run = spawnSync(
        getPythonCommand(),
        ['tests/verify_document_structure.py', 'verify', tmpPdf, tmpSpec],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      expect(run.status).toBe(0)
      const result = JSON.parse(run.stdout.trim())
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])

      const inspectRun = spawnSync(
        getPythonCommand(),
        ['tests/verify_document_structure.py', 'inspect', tmpPdf],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      expect(inspectRun.status).toBe(0)
      const inspectRes = JSON.parse(inspectRun.stdout.trim())
      expect(inspectRes.pageCount).toBe(2)
      expect(inspectRes.puaCount).toBe(0)
      expect(inspectRes.actualTextCount).toBe(0)
      expect(inspectRes.invisible3TrCount).toBe(0)
      expect(inspectRes.hasPha).toBe(true)
      expect(inspectRes.hasTallAm).toBe(true)
    } finally {
      if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf)
      if (fs.existsSync(tmpSpec)) fs.unlinkSync(tmpSpec)
    }
  })

  test('multipage 2D table grid verification on actual NEW app PDF buffer (151 rows across pages)', async () => {
    const pr = makeMockRequest(151)
    const buf = await generateRequestPdfBuffer(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    expect(buf.length).toBeGreaterThan(10000)

    const spec = buildExpectedSpec(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    const tmpPdf = path.join(os.tmpdir(), `test-app-151-${Date.now()}.pdf`)
    const tmpSpec = path.join(os.tmpdir(), `test-app-151-spec-${Date.now()}.json`)

    fs.writeFileSync(tmpPdf, Buffer.from(buf))
    fs.writeFileSync(tmpSpec, JSON.stringify(spec, null, 2), 'utf8')

    try {
      const run = spawnSync(
        getPythonCommand(),
        ['tests/verify_document_structure.py', 'verify', tmpPdf, tmpSpec],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      expect(run.status).toBe(0)
      const result = JSON.parse(run.stdout.trim())
      expect(result.ok).toBe(true)
      expect(result.errors).toEqual([])

      const inspectRun = spawnSync(
        getPythonCommand(),
        ['tests/verify_document_structure.py', 'inspect', tmpPdf],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      expect(inspectRun.status).toBe(0)
      const inspectRes = JSON.parse(inspectRun.stdout.trim())
      expect(inspectRes.pageCount).toBeGreaterThanOrEqual(7)
      expect(inspectRes.puaCount).toBe(0)
      expect(inspectRes.actualTextCount).toBe(0)
      expect(inspectRes.invisible3TrCount).toBe(0)
    } finally {
      if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf)
      if (fs.existsSync(tmpSpec)) fs.unlinkSync(tmpSpec)
    }
  })

  test('negative controls MUST detect permutations, swapped SKU/qty, missing or duplicate rows', async () => {
    const pr = makeMockRequest(17)
    const buf = await generateRequestPdfBuffer(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    const baseSpec = buildExpectedSpec(pr, 'Pizza Mania', 'คลังหลัก', mockT)

    const tmpPdf = path.join(os.tmpdir(), `test-neg-${Date.now()}.pdf`)
    const tmpSpec = path.join(os.tmpdir(), `test-neg-spec-${Date.now()}.json`)
    fs.writeFileSync(tmpPdf, Buffer.from(buf))

    const runCheck = (mutatedSpec: typeof baseSpec) => {
      fs.writeFileSync(tmpSpec, JSON.stringify(mutatedSpec, null, 2), 'utf8')
      const run = spawnSync(
        getPythonCommand(),
        ['tests/verify_document_structure.py', 'verify', tmpPdf, tmpSpec],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      expect(run.status).toBe(2)
      const parsed = JSON.parse(run.stdout.trim())
      expect(parsed.ok).toBe(false)
      expect(parsed.errors.length).toBeGreaterThan(0)
      return parsed.errors as string[]
    }

    try {
      // 1. Permuted rows
      const permuted = JSON.parse(JSON.stringify(baseSpec))
      const row0 = permuted.rows[0]
      permuted.rows[0] = permuted.rows[1]
      permuted.rows[1] = row0
      const permErrs = runCheck(permuted)
      expect(permErrs.some((e) => e.includes('Row 1') || e.includes('Row 2'))).toBe(true)

      // 2. Swapped SKU
      const swappedSku = JSON.parse(JSON.stringify(baseSpec))
      const sku0 = swappedSku.rows[0][2]
      swappedSku.rows[0][2] = swappedSku.rows[1][2]
      swappedSku.rows[1][2] = sku0
      const skuErrs = runCheck(swappedSku)
      expect(skuErrs.some((e) => e.includes('รหัสสินค้า'))).toBe(true)

      // 3. Swapped quantity
      const swappedQty = JSON.parse(JSON.stringify(baseSpec))
      const qty0 = swappedQty.rows[0][4]
      swappedQty.rows[0][4] = swappedQty.rows[1][4]
      swappedQty.rows[1][4] = qty0
      const qtyErrs = runCheck(swappedQty)
      expect(qtyErrs.some((e) => e.includes('จำนวนที่ขอ'))).toBe(true)

      // 4. Missing row
      const missingRow = JSON.parse(JSON.stringify(baseSpec))
      missingRow.rows.splice(3, 1)
      const missErrs = runCheck(missingRow)
      expect(missErrs.some((e) => e.includes('Row count mismatch'))).toBe(true)

      // 5. Duplicate row
      const dupRow = JSON.parse(JSON.stringify(baseSpec))
      dupRow.rows.splice(1, 0, dupRow.rows[0])
      const dupErrs = runCheck(dupRow)
      expect(dupErrs.some((e) => e.includes('Row count mismatch'))).toBe(true)
    } finally {
      if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf)
      if (fs.existsSync(tmpSpec)) fs.unlinkSync(tmpSpec)
    }
  })
})
