import type { PurchaseRequest } from '../types'
import { fmtQty, formatThaiDate } from './format'
import { PR_STATUS_KEYS } from './purchaseRequestStatus'
import { groupedBySupplier } from './requestExport'
import { SARABUN_PDF3_BASE64 } from './sarabunPdf3Base64'

type T = (key: string, vars?: Record<string, string | number>) => string

let fontsRegistered = false

async function getPdfMake() {
  const mod = await import('pdfmake/build/pdfmake.js')
  const pdfMake = mod.default || mod
  if (!fontsRegistered) {
    if (typeof pdfMake.addVirtualFileSystem === 'function') {
      pdfMake.addVirtualFileSystem({ 'SarabunPDF3-Regular.ttf': SARABUN_PDF3_BASE64 })
    } else if (pdfMake.virtualfs && typeof pdfMake.virtualfs.writeFileSync === 'function') {
      pdfMake.virtualfs.writeFileSync('SarabunPDF3-Regular.ttf', SARABUN_PDF3_BASE64, 'base64')
    }
    if (typeof pdfMake.addFonts === 'function') {
      pdfMake.addFonts({
        SarabunPDF: {
          normal: 'SarabunPDF3-Regular.ttf',
          bold: 'SarabunPDF3-Regular.ttf',
          italics: 'SarabunPDF3-Regular.ttf',
          bolditalics: 'SarabunPDF3-Regular.ttf',
        },
      })
    }
    fontsRegistered = true
  }
  return pdfMake
}

export function buildRequestPdfDocDefinition(
  pr: PurchaseRequest,
  company: string,
  locationName: string,
  t: T,
): Record<string, unknown> {
  const bodyRows: (string | number)[][] = []
  for (const g of groupedBySupplier(pr)) {
    for (const i of g.items) {
      bodyRows.push([
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

  const headCols = [
    t('ผู้ขาย'),
    t('สินค้า'),
    t('รหัสสินค้า'),
    t('คงเหลือ'),
    t('จำนวนที่ขอ'),
    t('จำนวนที่อนุมัติ'),
    t('หน่วย'),
    t('หมายเหตุ'),
  ]

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
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'SarabunPDF', fontSize: 9, lineHeight: 1.25 },
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: 'right',
      margin: [0, 0, 40, 15],
      fontSize: 8,
      color: '#64748B',
    }),
    content: [
      { text: title, fontSize: 16, margin: [0, 0, 0, 4] },
      { text: subtitle, fontSize: 10, margin: [0, 0, 0, 2] },
      ...metaLines.map((m) => ({ text: m, fontSize: 10, margin: [0, 0, 0, 2] })),
      {
        margin: [0, 8, 0, 0],
        table: {
          headerRows: 1,
          widths: [100, '*', 95, 48, 60, 65, 36, 68],
          body: [
            headCols.map((col, idx) => ({
              text: col,
              fillColor: '#B91C1C',
              color: '#FFFFFF',
              alignment: [3, 4, 5].includes(idx) ? 'right' : 'left',
            })),
            ...bodyRows.map((row, rIdx) =>
              row.map((val, cIdx) => ({
                text: String(val),
                fillColor: rIdx % 2 === 1 ? '#FAFAFA' : '#FFFFFF',
                color: '#000000',
                alignment: [3, 4, 5].includes(cIdx) ? 'right' : 'left',
              })),
            ),
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => '#E2E8F0',
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
    ],
  }
}

export async function generateRequestPdfBuffer(
  pr: PurchaseRequest,
  company: string,
  locationName: string,
  t: T,
): Promise<Uint8Array> {
  const pdfMake = await getPdfMake()
  const docDef = buildRequestPdfDocDefinition(pr, company, locationName, t)
  const doc = pdfMake.createPdf(docDef)
  const buf = await doc.getBuffer()
  return new Uint8Array(buf)
}

export async function generateAndDownloadRequestPdf(
  pr: PurchaseRequest,
  company: string,
  locationName: string,
  t: T,
): Promise<void> {
  const pdfMake = await getPdfMake()
  const docDef = buildRequestPdfDocDefinition(pr, company, locationName, t)
  const doc = pdfMake.createPdf(docDef)
  if (typeof doc.download === 'function') {
    await doc.download(`${pr.docNo}.pdf`)
  } else {
    const buf = await doc.getBuffer()
    const blob = new Blob([buf], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${pr.docNo}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }
}
