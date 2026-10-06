import * as XLSX from 'xlsx'
import type { OcrLine } from './billOcr'

/**
 * Product lines from any spreadsheet (6 Oct 2026) — the plain kind people keep: a header
 * row somewhere near the top naming a product / code column and a quantity column, then
 * one product per row. The company's order workbook (several day-blocks side by side)
 * keeps its own reader (lib/orderSheet); this is for everything else.
 *
 * Pure apart from the xlsx parser: an ArrayBuffer in, lines out, no guessing past what the
 * header says. A sheet with no recognisable header falls back to "the first text column is
 * the product, the first number column after it is the quantity".
 */

export interface SheetLine extends OcrLine {
  /** A SKU / barcode column, when the sheet has one — matched before the name. */
  code?: string
  note?: string
  /** 1-based row in the sheet, for the review table. */
  row: number
}

const HEADERS = {
  name: /^(สินค้า|ชื่อสินค้า|รายการ|รายการสินค้า|ชื่อ|product|product name|item|item name|description|name)$/i,
  code: /^(รหัส|รหัสสินค้า|sku|code|item code|barcode|บาร์โค้ด)$/i,
  qty: /^(จำนวน|จำนวนสั่ง|จำนวนนับ|นับได้|qty|quantity|amount|count|order qty)$/i,
  unit: /^(หน่วย|unit|uom)$/i,
  note: /^(หมายเหตุ|note|notes|remark|remarks)$/i,
}

type Cell = string | number | boolean | null | undefined

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c).trim())
const num = (c: Cell): number | null => {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null
  const s = text(c).replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}

/** Every sheet's rows; the first with lines wins. */
export function parseSheetLines(data: ArrayBuffer): { sheet: string; lines: SheetLine[] } {
  // A CSV is text, and the parser would take its bytes as a Windows code page — every Thai
  // header turns to noise and no column is recognised. Anything that is not an .xlsx (a zip,
  // "PK") or an old .xls (an OLE file) is read as UTF-8 text first (a BOM is dropped).
  const head = new Uint8Array(data.slice(0, 4))
  const zip = head[0] === 0x50 && head[1] === 0x4b
  const ole = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0
  const wb = zip || ole ? XLSX.read(data, { type: 'array' }) : XLSX.read(new TextDecoder('utf-8').decode(data), { type: 'string' })
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: null })
    const lines = linesFromRows(rows)
    if (lines.length) return { sheet: name, lines }
  }
  return { sheet: wb.SheetNames[0] ?? '', lines: [] }
}

export function linesFromRows(rows: readonly Cell[][]): SheetLine[] {
  // A header in the first ten rows naming a product or code column and a quantity column.
  let header = -1
  let col: Partial<Record<keyof typeof HEADERS, number>> = {}
  for (let r = 0; r < Math.min(10, rows.length) && header < 0; r++) {
    const found: typeof col = {}
    rows[r].forEach((c, i) => {
      const v = text(c)
      for (const [k, re] of Object.entries(HEADERS) as [keyof typeof HEADERS, RegExp][]) {
        if (found[k] === undefined && re.test(v)) found[k] = i
      }
    })
    if ((found.name !== undefined || found.code !== undefined) && found.qty !== undefined) {
      header = r
      col = found
    }
  }

  if (header < 0) {
    // No header: first text column, first number column to its right.
    const sample = rows.find((r) => r.some((c) => num(c) !== null && num(c)! > 0) && r.some((c) => text(c) && num(c) === null))
    if (!sample) return []
    const nameCol = sample.findIndex((c) => text(c) && num(c) === null)
    const qtyCol = sample.findIndex((c, i) => i > nameCol && num(c) !== null)
    if (nameCol < 0 || qtyCol < 0) return []
    col = { name: nameCol, qty: qtyCol }
  }

  const out: SheetLine[] = []
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r]
    const qty = num(row[col.qty!])
    const name = col.name !== undefined ? text(row[col.name]) : ''
    const code = col.code !== undefined ? text(row[col.code]) : ''
    if (qty === null || qty <= 0 || (!name && !code)) continue
    out.push({
      row: r + 1,
      name: name || code,
      qty: Math.round(qty * 1000) / 1000,
      ...(code ? { code } : {}),
      ...(col.unit !== undefined && text(row[col.unit]) ? { unit: text(row[col.unit]) } : {}),
      ...(col.note !== undefined && text(row[col.note]) ? { note: text(row[col.note]) } : {}),
    })
  }
  return out.slice(0, 300)
}
