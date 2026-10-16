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

// xlsx and jspdf load on first export, not with the app: together they are most of what code
// splitting took out of the first download.
export async function exportExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, string | number>[],
): Promise<void> {
  const XLSX = await import('xlsx')
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

export function createReportPdf(opts: PdfReportOptions): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const hasThai = registerThaiFont(doc)
  const font = hasThai ? 'Sarabun' : 'helvetica'

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginLeft = 40
  const marginRight = 40
  const marginTop = 40
  const marginBottom = 40
  const contentWidth = pageWidth - marginLeft - marginRight
  const maxContentY = pageHeight - marginBottom

  const titleLineHeight = 22
  const metaLineHeight = 16

  doc.setFont(font, 'normal')
  doc.setFontSize(16)

  let y = marginTop
  const titleLines = doc.splitTextToSize(opts.title, contentWidth)
  for (const line of titleLines) {
    if (y > maxContentY) {
      doc.addPage()
      doc.setFont(font, 'normal')
      doc.setFontSize(16)
      y = marginTop
    }
    doc.text(line, marginLeft, y)
    y += titleLineHeight
  }

  doc.setFontSize(10)
  y += 2

  const printMetaLine = (line: string): void => {
    if (y > maxContentY) {
      doc.addPage()
      doc.setFont(font, 'normal')
      doc.setFontSize(10)
      y = marginTop
    }
    doc.text(line, marginLeft, y)
    y += metaLineHeight
  }

  if (opts.subtitle) {
    const subLines = doc.splitTextToSize(opts.subtitle, contentWidth)
    for (const line of subLines) {
      printMetaLine(line)
    }
  }

  for (const entry of opts.meta ?? []) {
    if (!entry) continue
    const metaLines = doc.splitTextToSize(entry, contentWidth)
    for (const line of metaLines) {
      printMetaLine(line)
    }
  }

  const tableFontSize = 9
  const tableCellPadding = 4
  const tableLineHeight = 1.35
  // The header and at least one body row must fit, or autoTable draws the header here and the
  // first row on the next page (R2 review, 15 Oct 2026: starts of 518..524pt did exactly that).
  const tableRowHeight = tableFontSize * tableLineHeight + 2 * tableCellPadding
  let tableStartY = y
  if (tableStartY + 2 * tableRowHeight > maxContentY) {
    doc.addPage()
    tableStartY = marginTop
  }

  if (typeof doc.setLineHeightFactor === 'function') {
    doc.setLineHeightFactor(tableLineHeight)
  }

  autoTable(doc, {
    startY: tableStartY,
    margin: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
    head: [opts.head],
    body: opts.body.map((r) => r.map((c) => String(c))),
    foot: opts.foot ? [opts.foot.map((c) => String(c))] : undefined,
    styles: { font, fontSize: tableFontSize, cellPadding: tableCellPadding, ...({ lineHeightFactor: tableLineHeight } as any) },
    // Sarabun is registered as 'normal' only; autoTable bolds the head by default, and a
    // bold request falls back to a font with no Thai glyphs — the header came out as
    // "'1 5H*1 @%" on the order sheet PDF while every body row read fine.
    headStyles: { font, fillColor: [185, 28, 28], textColor: 255, fontStyle: 'normal' },
    footStyles: { font, fillColor: [241, 245, 249], textColor: 20, fontStyle: 'normal' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  })

  return doc
}

export async function exportReportPdf(opts: PdfReportOptions): Promise<void> {
  const doc = createReportPdf(opts)
  doc.save(opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`)
}
