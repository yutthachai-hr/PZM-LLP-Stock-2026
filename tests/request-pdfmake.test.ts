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

const mockT = (key: string, vars?: Record<string, string | number>) => {
  if (!vars) return key
  return key.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`))
}

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

  test('regression: prevents table rows from splitting across page breaks with orphan continuation row', async () => {
    const enT = (k: string) =>
      ({
        'รายการขอสั่งซื้อ': 'Purchase requests',
        'ผู้ขาย': 'Supplier',
        'สินค้า': 'Product',
        'รหัสสินค้า': 'Product code',
        'คงเหลือ': 'On hand',
        'จำนวนที่ขอ': 'Requested qty',
        'จำนวนที่อนุมัติ': 'Approved qty',
        'หน่วย': 'Unit',
        'หมายเหตุ': 'Note',
        'ผู้ขอ': 'Requested by',
        'ผู้อนุมัติ': 'Approved by',
        'วันที่ขอ': 'Request date',
        'วันที่อนุมัติ': 'Approved date',
        'สถานะ': 'Status',
        'คลัง': 'Location',
        'เลือกผู้ขายเอง': 'Supplier chosen by hand',
        'หัวหน้าเพิ่ม': 'Added by manager',
        'สถานะ: อนุมัติแล้ว': 'Status: Approved',
      }[k] ?? k)

    const sups = [
      { id: 'sup-1', name: 'เบทาโกร' },
      { id: 'sup-2', name: 'โครงการหลวง' },
      { id: 'sup-3', name: 'ซีพีเอฟ' },
      { id: 'sup-4', name: 'สยามฟูดส์' },
      { id: 'sup-5', name: 'วิสาหกิจชุมชนผำไทย' },
    ]
    const units = ['KG', 'EA', 'Pack', 'Carton']
    const items: PurchaseRequestItem[] = []
    for (let i = 1; i <= 50; i++) {
      const s = sups[(i - 1) % sups.length]
      const u = units[(i - 1) % units.length]
      items.push({
        idx: i,
        productId: `prod-bulk-${i}`,
        productName: i === 1 ? 'ไข่ผำสดสำหรับประกอบอาหาร' : i === 2 ? 'แป้งพิซซ่า ปำ ฝำ ฟำ ผำ' : `สินค้าทดสอบรายการที่ ${i}`,
        sku: `SKU-${String(i).padStart(5, '0')}`,
        unit: u,
        entryUnit: i % 2 === 0 ? 'Pack' : u,
        supplierId: s.id,
        supplierName: s.name,
        supplierChoice: i % 5 === 0 ? 'custom' : 'default',
        requestedQty: i * 2.5,
        approvedQty: i * 2.5,
        stockAtSubmit: i % 10,
        managerAdded: i % 7 === 0,
        note: i % 3 === 0 ? `หมายเหตุรายการที่ ${i}` : undefined,
      })
    }

    const pr: PurchaseRequest = {
      id: 'pr-50-regress',
      docNo: 'PR-00050',
      status: 'approved',
      revision: 1,
      locationId: 'wh-main',
      requestedBy: 'user-req-1',
      requestedByName: 'สมชาย ผู้ขอเบิก',
      approvedBy: 'user-admin',
      approvedByName: 'ยุทธชัย ผู้จัดการ',
      approvedAt: 1776240000000,
      createdAt: 1776230000000,
      updatedAt: 1776240000000,
      createdBy: 'user-req-1',
      createdByName: 'สมชาย ผู้ขอเบิก',
      history: [],
      approvalNote: 'อนุมัติตามรายการ น้ำมันและวัตถุดิบผำสด',
      items,
    }

    const buf = await generateRequestPdfBuffer(pr, 'Pizza Mania', 'Main Warehouse', enT)
    const tmpPdf = path.join(os.tmpdir(), `test-split-regression-${Date.now()}.pdf`)
    fs.writeFileSync(tmpPdf, Buffer.from(buf))

    try {
      const inspectRes = spawnSync(
        getPythonCommand(),
        [
          '-c',
          `import sys, json, pymupdf
from tests.verify_document_structure import extract_table_grid
doc = pymupdf.open(sys.argv[1])
headers, rows = extract_table_grid(doc)
split_rows = [r for r in rows if (not r[0] and not r[1] and r[7])]
page_start_splits = []
for p_idx, page in enumerate(doc):
    if p_idx == 0: continue
    drawings = page.get_drawings()
    strokes = [x for x in drawings if x['type'] == 's']
    y_divs = sorted(list(set(round(s['rect'].y0, 1) for s in strokes)))
    header_candidates = [
        x for x in drawings
        if x['type'] == 'f' and x.get('fill') and (abs(x['rect'].height - 23.125) < 4 or abs(x['rect'].height - 19.625) < 4)
    ]
    if not header_candidates: continue
    top_y = min(x['rect'].y0 for x in header_candidates)
    header_rects = sorted([x['rect'] for x in header_candidates if abs(x['rect'].y0 - top_y) < 2], key=lambda r: r.x0)
    col_bounds = [(r.x0 - 1.5, r.x1 + 1.5) for r in header_rects]
    header_bottom = max(r.y1 for r in header_rects)
    words = page.get_text('words')
    data_y_cuts = [header_bottom] + [y for y in y_divs if y > header_bottom + 1]
    if len(data_y_cuts) > 1:
        y0, y1 = data_y_cuts[0], data_y_cuts[1]
        first_row = []
        for cx0, cx1 in col_bounds:
            c_words = [w for w in words if y0 <= w[1] < y1 and cx0 <= w[0] < cx1]
            first_row.append(' '.join(w[4] for w in c_words).strip())
        if not first_row[0] and not first_row[1] and first_row[7]:
            page_start_splits.append({'page': p_idx + 1, 'row': first_row})
print(json.dumps({'split_rows': split_rows, 'page_start_splits': page_start_splits, 'total_rows': len(rows)}))
`,
          tmpPdf,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      expect(inspectRes.status).toBe(0)
      const data = JSON.parse(inspectRes.stdout.trim())
      expect(data.split_rows).toEqual([])
      expect(data.page_start_splits).toEqual([])
      expect(data.total_rows).toBe(50)
    } finally {
      if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf)
    }
  })

  test('pathological case: handles single note exceeding page height without hang or text loss', async () => {
    const tokens = Array.from({ length: 80 }, (_, i) => `หมายเหตุทดสอบขนาดยาวมากพิเศษ-${i + 1}`)
    const longNote = tokens.join(' · ')
    const pr = makeMockRequest(1, {
      items: [
        makeMockItem(1, {
          note: longNote,
        }),
      ],
    })

    const start = Date.now()
    const buf = await generateRequestPdfBuffer(pr, 'Pizza Mania', 'คลังหลัก', mockT)
    const duration = Date.now() - start

    expect(duration).toBeLessThan(10000)
    expect(buf.length).toBeGreaterThan(1000)

    const tmpPdf = path.join(os.tmpdir(), `test-pathological-${Date.now()}.pdf`)
    fs.writeFileSync(tmpPdf, Buffer.from(buf))

    try {
      const inspectRes = spawnSync(
        getPythonCommand(),
        [
          '-c',
          `import sys, json, pymupdf
from tests.verify_document_structure import extract_table_grid
doc = pymupdf.open(sys.argv[1])
full_text = '\\n'.join(p.get_text() for p in doc)
headers, rows = extract_table_grid(doc)
split_rows = [r for r in rows if (not r[0] and not r[1] and r[7])]
page_start_splits = []
for p_idx, page in enumerate(doc):
    if p_idx == 0: continue
    drawings = page.get_drawings()
    strokes = [x for x in drawings if x['type'] == 's']
    y_divs = sorted(list(set(round(s['rect'].y0, 1) for s in strokes)))
    header_candidates = [
        x for x in drawings
        if x['type'] == 'f' and x.get('fill') and (abs(x['rect'].height - 23.125) < 4 or abs(x['rect'].height - 19.625) < 4)
    ]
    if not header_candidates: continue
    top_y = min(x['rect'].y0 for x in header_candidates)
    header_rects = sorted([x['rect'] for x in header_candidates if abs(x['rect'].y0 - top_y) < 2], key=lambda r: r.x0)
    col_bounds = [(r.x0 - 1.5, r.x1 + 1.5) for r in header_rects]
    header_bottom = max(r.y1 for r in header_rects)
    words = page.get_text('words')
    data_y_cuts = [header_bottom] + [y for y in y_divs if y > header_bottom + 1]
    if len(data_y_cuts) > 1:
        y0, y1 = data_y_cuts[0], data_y_cuts[1]
        first_row = []
        for cx0, cx1 in col_bounds:
            c_words = [w for w in words if y0 <= w[1] < y1 and cx0 <= w[0] < cx1]
            first_row.append(' '.join(w[4] for w in c_words).strip())
        if not first_row[0] and not first_row[1] and first_row[7]:
            page_start_splits.append({'page': p_idx + 1, 'row': first_row})
print(json.dumps({
    'pageCount': len(doc),
    'full_text': full_text,
    'split_rows': split_rows,
    'page_start_splits': page_start_splits,
    'total_rows': len(rows),
    'table_rows': rows,
}))
`,
          tmpPdf,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      expect(inspectRes.status).toBe(0)
      const data = JSON.parse(inspectRes.stdout.trim())
      expect(data.pageCount).toBeGreaterThanOrEqual(1)
      expect(data.pageCount).toBeLessThan(10)

      // 1. Table row verification: unsplit, exact row count
      expect(data.split_rows).toEqual([])
      expect(data.page_start_splits).toEqual([])
      expect(data.total_rows).toBe(1)

      // 2. Visible reference marker is present in the table cell
      expect(data.table_rows[0][7]).toContain('… (ดูหมายเหตุ 1)')

      // 3. Appendix heading exists
      const cleanFullText = data.full_text.replace(/\s+/g, '')
      expect(cleanFullText).toContain('หมายเหตุฉบับเต็ม')

      // 4. Complete long note text (every token) is extractable from the PDF
      for (const token of tokens) {
        expect(cleanFullText).toContain(token.replace(/\s+/g, ''))
      }
    } finally {
      if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf)
    }
  })

  test('multiple long notes with EN translation: renders markers and Full notes appendix', async () => {
    const enT = (k: string, vars?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        'ผู้ขาย': 'Supplier',
        'สินค้า': 'Product',
        'รหัสสินค้า': 'Product code',
        'คงเหลือ': 'On hand',
        'จำนวนที่ขอ': 'Requested qty',
        'จำนวนที่อนุมัติ': 'Approved qty',
        'หน่วย': 'Unit',
        'หมายเหตุ': 'Note',
        '… (ดูหมายเหตุ {n})': '… (see note {n})',
        'หมายเหตุฉบับเต็ม': 'Full notes',
      }
      let res = dict[k] ?? k
      if (vars) {
        res = res.replace(/\{(\w+)\}/g, (_, varName) => (vars[varName] !== undefined ? String(vars[varName]) : `{${varName}}`))
      }
      return res
    }

    const note1 = 'Special long note 1: ' + 'detailed delivery instructions for supplier '.repeat(10)
    const note2 = 'Special long note 2: ' + 'strict temperature control needed '.repeat(12)
    const pr = makeMockRequest(2, {
      items: [
        makeMockItem(1, { note: note1 }),
        makeMockItem(2, { note: note2 }),
      ],
    })

    const buf = await generateRequestPdfBuffer(pr, 'Pizza Mania', 'Main Warehouse', enT)
    const tmpPdf = path.join(os.tmpdir(), `test-en-multi-${Date.now()}.pdf`)
    fs.writeFileSync(tmpPdf, Buffer.from(buf))

    try {
      const inspectRes = spawnSync(
        getPythonCommand(),
        [
          '-c',
          `import sys, json, pymupdf
from tests.verify_document_structure import extract_table_grid
doc = pymupdf.open(sys.argv[1])
full_text = '\\n'.join(p.get_text() for p in doc)
headers, rows = extract_table_grid(doc)
print(json.dumps({
    'pageCount': len(doc),
    'full_text': full_text,
    'table_rows': rows,
}))
`,
          tmpPdf,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
      expect(inspectRes.status).toBe(0)
      const data = JSON.parse(inspectRes.stdout.trim())
      expect(data.table_rows[0][7]).toContain('… (see note 1)')
      expect(data.table_rows[1][7]).toContain('… (see note 2)')
      const normFullText = data.full_text.replace(/\s+/g, ' ')
      expect(normFullText).toContain('Full notes')
      expect(normFullText).toContain(note1.replace(/\s+/g, ' '))
      expect(normFullText).toContain(note2.replace(/\s+/g, ' '))
    } finally {
      if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf)
    }
  })

  test('50-row TH PDF with two long notes: unsplit rows, markers, appendix, and raster to PNG evidence', async () => {
    const sups = [
      { id: 'sup-1', name: 'เบทาโกร' },
      { id: 'sup-2', name: 'โครงการหลวง' },
      { id: 'sup-3', name: 'ซีพีเอฟ' },
      { id: 'sup-4', name: 'สยามฟูดส์' },
      { id: 'sup-5', name: 'วิสาหกิจชุมชนผำไทย' },
    ]
    const units = ['KG', 'EA', 'Pack', 'Carton']
    const longNote1 = 'หมายเหตุพิเศษสำหรับรายการที่ 12: ตรวจสอบความสดของวัตถุดิบอย่างละเอียดก่อนรับมอบ บรรจุในถุงสูญญากาศและควบคุมอุณหภูมิระหว่างขนส่งไม่เกิน 4 องศาเซลเซียส พร้อมแนบเอกสารรับรองมาตรฐาน GAP และผลการตรวจวิเคราะห์สารตกค้างจากห้องปฏิบัติการที่ได้รับการรับรองจากกรมวิทยาศาสตร์การแพทย์ หากพบสินค้าชำรุดหรือไม่ได้มาตรฐานให้ตีกลับทันที'
    const longNote2 = 'หมายเหตุพิเศษสำหรับรายการที่ 37: สินค้าล็อตพิเศษเพื่อใช้ในเทศกาลอาหารเจ ต้องคัดแยกสายการผลิตและภาชนะบรรจุไม่ให้ปนเปื้อนผลิตภัณฑ์จากสัตว์ ติดฉลากระบุวันผลิตและวันหมดอายุชัดเจน พร้อมเอกสารรับรองมาตรฐานอาหารเจจากคณะกรรมการกลางอิสลามหรือสถาบันรับรองที่น่าเชื่อถือ จัดส่งภายในเวลา 08.00 น. เท่านั้น หากสินค้ามีอุณหภูมิเกินกำหนดหรือภาชนะบรรจุมีรอยฉีกขาดทางร้านขอปฏิเสธการรับมอบสินค้าทันที'

    const items: PurchaseRequestItem[] = []
    for (let i = 1; i <= 50; i++) {
      const s = sups[(i - 1) % sups.length]
      const u = units[(i - 1) % units.length]
      let itemNote: string | undefined = i % 3 === 0 ? `หมายเหตุรายการที่ ${i}` : undefined
      if (i === 12) itemNote = longNote1
      if (i === 37) itemNote = longNote2

      items.push({
        idx: i,
        productId: `prod-bulk-${i}`,
        productName: i === 1 ? 'ไข่ผำสดสำหรับประกอบอาหาร' : i === 2 ? 'แป้งพิซซ่า ปำ ฝำ ฟำ ผำ' : `สินค้าทดสอบรายการที่ ${i}`,
        sku: `SKU-${String(i).padStart(5, '0')}`,
        unit: u,
        entryUnit: i % 2 === 0 ? 'Pack' : u,
        supplierId: s.id,
        supplierName: s.name,
        supplierChoice: i % 5 === 0 ? 'custom' : 'default',
        requestedQty: i * 2.5,
        approvedQty: i * 2.5,
        stockAtSubmit: i % 10,
        managerAdded: i % 7 === 0,
        note: itemNote,
      })
    }

    const pr: PurchaseRequest = {
      id: 'pr-50-two-long-notes',
      docNo: 'PR-00052',
      status: 'approved',
      revision: 1,
      locationId: 'wh-main',
      requestedBy: 'user-req-1',
      requestedByName: 'สมชาย ผู้ขอเบิก',
      approvedBy: 'user-admin',
      approvedByName: 'ยุทธชัย ผู้จัดการ',
      approvedAt: 1776240000000,
      createdAt: 1776230000000,
      updatedAt: 1776240000000,
      createdBy: 'user-req-1',
      createdByName: 'สมชาย ผู้ขอเบิก',
      history: [],
      approvalNote: 'อนุมัติตามรายการ น้ำมันและวัตถุดิบผำสด',
      items,
    }

    const buf = await generateRequestPdfBuffer(pr, 'Pizza Mania', 'คลังหลัก (อุดมสุข)', mockT)
    const evidenceDir = 'C:/Users/Yutthachai/pzm-mission-control-20261014/docs/mission/successor-4c98c132/waves/agent-h2-pr31-notes'
    fs.mkdirSync(evidenceDir, { recursive: true })

    const evidencePdf = path.join(evidenceDir, 'pr-50-long-notes-th.pdf')
    fs.writeFileSync(evidencePdf, Buffer.from(buf))

    const inspectRes = spawnSync(
      getPythonCommand(),
      [
        '-c',
        `import sys, json, pymupdf, os
from tests.verify_document_structure import extract_table_grid

pdf_path = sys.argv[1]
evidence_dir = sys.argv[2]
os.makedirs(evidence_dir, exist_ok=True)

doc = pymupdf.open(pdf_path)
full_text = '\\n'.join(p.get_text() for p in doc)
headers, rows = extract_table_grid(doc)
split_rows = [r for r in rows if (not r[0] and not r[1] and r[7])]
page_start_splits = []
for p_idx, page in enumerate(doc):
    if p_idx == 0: continue
    drawings = page.get_drawings()
    strokes = [x for x in drawings if x['type'] == 's']
    y_divs = sorted(list(set(round(s['rect'].y0, 1) for s in strokes)))
    header_candidates = [
        x for x in drawings
        if x['type'] == 'f' and x.get('fill') and (abs(x['rect'].height - 23.125) < 4 or abs(x['rect'].height - 19.625) < 4)
    ]
    if not header_candidates: continue
    top_y = min(x['rect'].y0 for x in header_candidates)
    header_rects = sorted([x['rect'] for x in header_candidates if abs(x['rect'].y0 - top_y) < 2], key=lambda r: r.x0)
    col_bounds = [(r.x0 - 1.5, r.x1 + 1.5) for r in header_rects]
    header_bottom = max(r.y1 for r in header_rects)
    words = page.get_text('words')
    data_y_cuts = [header_bottom] + [y for y in y_divs if y > header_bottom + 1]
    if len(data_y_cuts) > 1:
        y0, y1 = data_y_cuts[0], data_y_cuts[1]
        first_row = []
        for cx0, cx1 in col_bounds:
            c_words = [w for w in words if y0 <= w[1] < y1 and cx0 <= w[0] < cx1]
            first_row.append(' '.join(w[4] for w in c_words).strip())
        if not first_row[0] and not first_row[1] and first_row[7]:
            page_start_splits.append({'page': p_idx + 1, 'row': first_row})

png_paths = []
for p_idx, page in enumerate(doc):
    pix = page.get_pixmap(dpi=150)
    png_name = f"pr-50-long-notes-th_page_{p_idx + 1}.png"
    out_path = os.path.join(evidence_dir, png_name)
    pix.save(out_path)
    png_paths.append(out_path)

print(json.dumps({
    'pageCount': len(doc),
    'full_text': full_text,
    'split_rows': split_rows,
    'page_start_splits': page_start_splits,
    'total_rows': len(rows),
    'png_paths': png_paths,
}))
`,
        evidencePdf,
        evidenceDir,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )

    expect(inspectRes.status).toBe(0)
    const data = JSON.parse(inspectRes.stdout.trim())
    expect(data.split_rows).toEqual([])
    expect(data.page_start_splits).toEqual([])
    expect(data.total_rows).toBe(50)
    expect(data.pageCount).toBeGreaterThanOrEqual(3)
    expect(data.png_paths.length).toBe(data.pageCount)

    const normFullText = data.full_text.replace(/\s+/g, ' ')
    expect(normFullText).toContain('หมายเหตุฉบับเต็ม')
    expect(normFullText).toContain('… (ดูหมายเหตุ 1)')
    expect(normFullText).toContain('… (ดูหมายเหตุ 2)')
    expect(normFullText).toContain(longNote1.replace(/\s+/g, ' '))
    expect(normFullText).toContain(longNote2.replace(/\s+/g, ' '))

    for (const p of data.png_paths) {
      expect(fs.existsSync(p)).toBe(true)
      expect(fs.statSync(p).size).toBeGreaterThan(10000)
    }
  })
})
