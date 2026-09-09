import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { SARABUN_BASE64 } from './sarabunFont'

// ---------------- Excel ----------------

/**
 * Column widths sized to the longest value in each column.
 *
 * Written as a loop because `Math.max(...rows.map(...))` passes every row as a separate
 * argument: at 150,000 rows it threw RangeError before the file was built at all, which is
 * well short of what a ledger export can reach and nowhere near Excel's own row limit.
 */
export function columnWidths(rows: Record<string, string | number>[]): { wch: number }[] {
  if (rows.length === 0) return []
  const keys = Object.keys(rows[0])
  return keys.map((k) => {
    let longest = k.length
    for (const row of rows) {
      const len = String(row[k] ?? '').length
      if (len > longest) longest = len
    }
    return { wch: Math.min(Math.max(longest + 2, 8), 40) }
  })
}

export function exportExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, string | number>[],
): void {
  const ws = XLSX.utils.json_to_sheet(rows)
  if (rows.length > 0) {
    ws['!cols'] = columnWidths(rows)
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

// ---------------- PDF (Thai font embedded) ----------------

/**
 * Add the Thai font to ONE document. Returns false when the font is not bundled.
 *
 * The "already registered" flag used to be a module-level boolean, but jsPDF registers
 * fonts per document and a new one is created for every export. So the first PDF of a
 * session got the font and every later one was told it already had it — Thai text in the
 * second report of the day came out as blank boxes. Tracking documents instead of a single
 * flag is what makes the answer true for the document being asked about.
 */
const fontedDocs = new WeakSet<object>()

export function registerThaiFont(doc: jsPDF): boolean {
  if (!SARABUN_BASE64 || SARABUN_BASE64.length < 1000) return false
  if (fontedDocs.has(doc)) return true
  doc.addFileToVFS('Sarabun-Regular.ttf', SARABUN_BASE64)
  doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal')
  fontedDocs.add(doc)
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
  const hasThai = registerThaiFont(doc)
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
