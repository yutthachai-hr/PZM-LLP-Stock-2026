import * as XLSX from 'xlsx'
import { AppError } from '../i18n/AppError'

/**
 * Reads the weekly order workbook the purchasing staff keep by hand.
 *
 * It is not a list. One sheet holds several order days side by side, each its own block:
 *
 *     รายการสั่งของ 13/7/2026                                   รายการสั่งของ 14/7/2026
 *     ชื่อวัตถุดิบ | รอบส่ง | หน่วย | SKV | SRS | ONNUT | รวม | จำนวนสั่ง | เรียกเข้า |   ชื่อวัตถุดิบ | …
 *     SWISS BROWN  | อังคาร | KG   | 24  | 4   | 2     | 30  | 8        | Zakana 15/07 |
 *
 * The blocks start on different rows and columns from sheet to sheet, the stock-on-hand
 * columns between the unit and the order quantity come and go, and the quantity cell holds a
 * number, a dash, nothing, or a word ("ตาม" — as per whatever was agreed). So every block is
 * found by its own header labels and read outward from them, the way `stockSheet.ts` reads
 * the closing-stock file: a column inserted by hand next week must not move the order
 * quantity onto the on-hand figure.
 *
 * Nothing here decides what to order. It reports what the sheet says, cell by cell, and the
 * validation and the person reviewing decide what that means.
 */

/** Labels that mark the product-name column. Lower-cased, spaces removed, compared whole. */
const NAME_HEADERS = ['ชื่อวัตถุดิบ', 'ชื่อสินค้า', 'รายการ', 'สินค้า', 'วัตถุดิบ', 'product', 'item', 'name', 'description']
/** The order quantity — listed most specific first, because "จำนวน" alone also names on-hand. */
const QTY_HEADERS = ['จำนวนสั่ง', 'จำนวนสั่งซื้อ', 'สั่งซื้อ', 'สั่ง', 'orderqty', 'order', 'qty', 'quantity', 'จำนวน']
const UNIT_HEADERS = ['หน่วย', 'unit', 'uom']
const NOTE_HEADERS = ['เรียกเข้า', 'หมายเหตุ', 'note', 'remark', 'delivery', 'วันส่ง', 'ส่ง']
const CYCLE_HEADERS = ['รอบส่ง', 'รอบ', 'cycle']
/** How far right of the name header a block's other columns may sit. */
const BLOCK_SPAN = 14

const BLOCK_MARKER = 'รายการสั่งของ'

export interface OrderRow {
  /** 1-based, as Excel shows it, so a problem can be pointed at. */
  excelRow: number
  name: string
  unit: string
  /** The quantity cell exactly as written, for the person reviewing. */
  rawQty: string
  /**
   * `order` — a positive number; `none` — blank, a dash or zero, meaning nothing to order;
   * `unclear` — a word where a number should be, which only a person can read.
   */
  qtyState: 'order' | 'none' | 'unclear'
  qty: number | null
  /** The delivery / call-in column, as written. Informational. */
  note: string
  cycle: string
}

export interface OrderBlock {
  sheet: string
  /** The block heading as written ("รายการสั่งของ 14/7/2026"), or the sheet name. */
  label: string
  /** Midnight local time of the date in the heading, or null when it has none. */
  date: number | null
  /** 0-based row of the header labels. */
  headerRow: number
  /** 0-based column indexes; -1 when the block has no such column. */
  cols: { name: number; unit: number; qty: number; note: number; cycle: number }
  rows: OrderRow[]
}

/** Column letters a person picks when the headers cannot be recognised. */
export interface ColumnMapping {
  name: string
  qty: string
  unit?: string
  note?: string
}

type Cell = string | number | null
type Grid = Cell[][]

function text(v: Cell | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function norm(v: Cell | undefined): string {
  return text(v).toLowerCase().replace(/\s+/g, '').replace(/[:.]+$/, '')
}

function isHeader(v: Cell | undefined, labels: readonly string[]): boolean {
  const n = norm(v)
  return n !== '' && labels.includes(n)
}

/**
 * A quantity cell, read the way a person reads it.
 *
 * `-`, `—`, blank and 0 all mean "not this week". A number means that many. Anything else —
 * "ตาม", "รอยอดสรุป", "5 ลัง" — is a note somebody left in the number column, and the app
 * refuses to turn it into a quantity: that row goes to a person.
 */
export function readQty(v: Cell | undefined): Pick<OrderRow, 'rawQty' | 'qtyState' | 'qty'> {
  const rawQty = text(v)
  if (rawQty === '' || /^[-–—]+$/.test(rawQty)) return { rawQty, qtyState: 'none', qty: null }
  const n = typeof v === 'number' ? v : Number(rawQty.replace(/,/g, ''))
  if (Number.isFinite(n)) {
    if (n <= 0) return { rawQty, qtyState: 'none', qty: null }
    return { rawQty, qtyState: 'order', qty: n }
  }
  return { rawQty, qtyState: 'unclear', qty: null }
}

/**
 * The date in a block heading: "รายการสั่งของ 14/7/2026", "2/8/2569". A Buddhist year is
 * brought back to the Gregorian one the rest of the app stores.
 */
export function parseBlockDate(label: string): number | null {
  const m = label.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  let y = Number(m[3])
  if (y < 100) y += 2000
  if (y > 2400) y -= 543
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const date = new Date(y, mo - 1, d)
  if (date.getMonth() !== mo - 1) return null
  return date.getTime()
}

/** A note cell: a date serial is shown as a date, anything else as written. */
function readNote(v: Cell | undefined): string {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v)
    if (d) return `${d.d}/${d.m}/${d.y}`
  }
  return text(v)
}

/**
 * Where a block's columns are, read from its header row.
 *
 * The search runs rightwards from the name header and stops at the next name header, so
 * two blocks side by side cannot borrow each other's columns. The quantity header is
 * matched most-specific first: a sheet that has both "จำนวนสั่ง" and a bare "จำนวน" wants
 * the former.
 */
function blockEnd(row: Cell[], nameCol: number): number {
  let end = Math.min(row.length, nameCol + BLOCK_SPAN + 1)
  for (let c = nameCol + 1; c < end; c++) {
    if (isHeader(row[c], NAME_HEADERS)) {
      end = c
      break
    }
  }
  return end
}

function findColumns(row: Cell[], nameCol: number): OrderBlock['cols'] | null {
  const cols = { name: nameCol, unit: -1, qty: -1, note: -1, cycle: -1 }
  const end = blockEnd(row, nameCol)
  const pick = (labels: readonly string[]): number => {
    for (const label of labels) {
      for (let c = nameCol + 1; c < end; c++) if (norm(row[c]) === label) return c
    }
    return -1
  }
  cols.qty = pick(QTY_HEADERS)
  cols.unit = pick(UNIT_HEADERS)
  cols.note = pick(NOTE_HEADERS)
  cols.cycle = pick(CYCLE_HEADERS)
  if (cols.qty < 0) return null
  return cols
}

/**
 * The heading above a header row, within the block's columns, if the sheet has one.
 *
 * A heading with a date wins over a bare "รายการสั่งของ": the first sheet of the sample
 * file has the bare title in column A and the dated one three columns along, on the same
 * row, and the bare one says nothing about which week this is.
 */
function findLabel(grid: Grid, headerRow: number, nameCol: number, sheet: string): string {
  let bare: string | null = null
  // Only this block's own columns: the next block's heading is a few cells to the right,
  // and a block whose heading was left blank must not borrow its neighbour's date.
  const end = blockEnd(grid[headerRow] ?? [], nameCol)
  for (let r = headerRow - 1; r >= Math.max(0, headerRow - 3); r--) {
    const row = grid[r] ?? []
    for (let c = nameCol; c < Math.min(row.length, end); c++) {
      const v = text(row[c])
      if (parseBlockDate(v) !== null) return v
      if (bare === null && v.includes(BLOCK_MARKER)) bare = v
    }
  }
  return bare ?? sheet
}

function readRows(grid: Grid, headerRow: number, cols: OrderBlock['cols']): OrderRow[] {
  const rows: OrderRow[] = []
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? []
    const nameCell = row[cols.name]
    // The next block's heading or header, stacked below this one, ends the block.
    if (isHeader(nameCell, NAME_HEADERS) || text(nameCell).includes(BLOCK_MARKER)) break
    const name = text(nameCell)
    if (!name) continue
    rows.push({
      excelRow: r + 1,
      name,
      unit: cols.unit >= 0 ? text(row[cols.unit]) : '',
      ...readQty(row[cols.qty]),
      note: cols.note >= 0 ? readNote(row[cols.note]) : '',
      cycle: cols.cycle >= 0 ? text(row[cols.cycle]) : '',
    })
  }
  return rows
}

function parseSheet(sheet: string, grid: Grid): OrderBlock[] {
  const blocks: OrderBlock[] = []
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? []
    for (let c = 0; c < row.length; c++) {
      if (!isHeader(row[c], NAME_HEADERS)) continue
      const cols = findColumns(row, c)
      if (!cols) continue
      blocks.push({
        sheet,
        label: findLabel(grid, r, c, sheet),
        date: null,
        headerRow: r,
        cols,
        rows: readRows(grid, r, cols),
      })
    }
  }
  for (const b of blocks) b.date = parseBlockDate(b.label)
  return blocks
}

/** "A" → 0, "EF" → 135. Case-insensitive; blank → -1. */
export function columnIndex(letters: string | undefined): number {
  const s = (letters ?? '').trim().toUpperCase()
  if (!/^[A-Z]{1,3}$/.test(s)) return -1
  return XLSX.utils.decode_col(s)
}

export function columnLetter(index: number): string {
  return index < 0 ? '' : XLSX.utils.encode_col(index)
}

/**
 * A sheet read with columns a person chose, for a file whose headers say nothing this
 * parser recognises. One block per sheet; every row with a name is a row.
 */
function parseMapped(sheet: string, grid: Grid, mapping: ColumnMapping): OrderBlock | null {
  const cols = {
    name: columnIndex(mapping.name),
    qty: columnIndex(mapping.qty),
    unit: columnIndex(mapping.unit),
    note: columnIndex(mapping.note),
    cycle: -1,
  }
  if (cols.name < 0 || cols.qty < 0) return null
  const rows: OrderRow[] = []
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? []
    const name = text(row[cols.name])
    if (!name || isHeader(row[cols.name], NAME_HEADERS)) continue
    rows.push({
      excelRow: r + 1,
      name,
      unit: cols.unit >= 0 ? text(row[cols.unit]) : '',
      ...readQty(row[cols.qty]),
      note: cols.note >= 0 ? readNote(row[cols.note]) : '',
      cycle: '',
    })
  }
  return { sheet, label: sheet, date: null, headerRow: -1, cols, rows }
}

function toGrid(ws: XLSX.WorkSheet): Grid {
  // raw:true keeps numbers as numbers — see stockSheet.ts for why a formatted string is
  // the wrong thing to read a quantity from. The range is pinned to start at A1: a sheet
  // whose first row or column is empty otherwise comes back shifted, and every Excel row
  // number this reports would point one row off.
  const ref = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  return XLSX.utils.sheet_to_json<Cell[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: ref.e }),
  })
}

export interface ParsedOrderWorkbook {
  sheets: string[]
  blocks: OrderBlock[]
}

/**
 * Every order block in the workbook, in sheet order then reading order.
 *
 * With `mapping`, the headers are ignored and each sheet is read as one block from the
 * columns given. Throws only when the file is not a workbook at all.
 */
export function parseOrderWorkbook(data: ArrayBuffer, mapping?: ColumnMapping): ParsedOrderWorkbook {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(data, { type: 'array' })
  } catch {
    throw new AppError('อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ Excel (.xlsx หรือ .xls)')
  }
  const blocks: OrderBlock[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const grid = toGrid(ws)
    if (mapping) {
      const b = parseMapped(name, grid, mapping)
      if (b) blocks.push(b)
    } else {
      blocks.push(...parseSheet(name, grid))
    }
  }
  return { sheets: wb.SheetNames, blocks }
}

/** The block a person most likely wants: the newest dated one, else the last one found. */
export function defaultBlock(blocks: readonly OrderBlock[]): OrderBlock | null {
  if (blocks.length === 0) return null
  let best: OrderBlock | null = null
  for (const b of blocks) {
    if (b.date === null) continue
    if (!best || b.date > (best.date ?? 0)) best = b
  }
  return best ?? blocks[blocks.length - 1]
}
