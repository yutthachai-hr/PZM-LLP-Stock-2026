import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { SARABUN_BASE64 } from './sarabunFont'

// ---------------- Excel ----------------

export function exportExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, string | number>[],
): void {
  const ws = XLSX.utils.json_to_sheet(rows)
  // auto column widths
  if (rows.length > 0) {
    const keys = Object.keys(rows[0])
    ws['!cols'] = keys.map((k) => {
      const maxLen = Math.max(
        k.length,
        ...rows.map((r) => String(r[k] ?? '').length),
      )
      return { wch: Math.min(Math.max(maxLen + 2, 8), 40) }
    })
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

// ---------------- PDF (Thai font embedded) ----------------

let fontRegistered = false
function ensureFont(doc: jsPDF): boolean {
  if (!SARABUN_BASE64 || SARABUN_BASE64.length < 1000) return false
  if (!fontRegistered) {
    doc.addFileToVFS('Sarabun-Regular.ttf', SARABUN_BASE64)
    doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal')
    fontRegistered = true
  }
  return true
}

export interface PdfReportOptions {
  filename: string
  title: string
  subtitle?: string
  meta?: string[] // lines under the title (date range, branch, generated-by...)
  head: string[]
  body: (string | number)[][]
  foot?: (string | number)[]
}

export function exportReportPdf(opts: PdfReportOptions): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const hasThai = ensureFont(doc)
  const font = hasThai ? 'Sarabun' : 'helvetica'

  doc.setFont(font, 'normal')
  doc.setFontSize(16)
  doc.text(opts.title, 40, 40)

  let y = 58
  doc.setFontSize(10)
  if (opts.subtitle) {
    doc.text(opts.subtitle, 40, y)
    y += 14
  }
  for (const line of opts.meta ?? []) {
    doc.text(line, 40, y)
    y += 13
  }

  autoTable(doc, {
    startY: y + 6,
    head: [opts.head],
    body: opts.body.map((r) => r.map((c) => String(c))),
    foot: opts.foot ? [opts.foot.map((c) => String(c))] : undefined,
    styles: { font, fontSize: 9, cellPadding: 4 },
    headStyles: { font, fillColor: [185, 28, 28], textColor: 255 },
    footStyles: { font, fillColor: [241, 245, 249], textColor: 20, fontStyle: 'normal' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  })

  doc.save(opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`)
}
