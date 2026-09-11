import * as XLSX from 'xlsx'
import { AppError } from '../i18n/AppError'

/**
 * Reads the monthly closing-stock workbook the company already keeps.
 *
 * The sheet is a matrix, not a list: one row per item, and a (quantity, unit) column pair
 * for every location × counting date on the sheet. A single file therefore carries several
 * counts at several places, and the header block above the data is the only thing that says
 * which column is which:
 *
 *     row n-2   |       | SKV.23        |       | SRS.          |      ← location, merged over the pair
 *     row n-1   |       | Closing July  |       | Closing July  |      ← counting date, merged
 *     row n     | Unit  | Quantity | Unit | Quantity | Unit     |      ← the label row
 *     rows      | code  | name | pack | qty | unit | qty | unit |
 *
 * Nothing here is hardcoded to column D or to row 4. The file is maintained by hand every
 * month; a column inserted in front of it would silently shift every quantity one location
 * to the left, and posting a branch's count against the wrong warehouse is worse than
 * refusing to read the file at all.
 */

/** Column A of an item row. Matches the format the item-code workbooks use. */
const SKU_RE = /^[A-Z]{2,8}(?:-[A-Z0-9]{2,})+$/

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const

export interface SheetColumn {
  /** Location label as written on the sheet, e.g. 'SKV.23'. */
  header: string
  /** Zero-based index of the quantity column. */
  qtyCol: number
  /** Zero-based index of its unit column, or -1 when the sheet has none. */
  unitCol: number
}

export interface SheetSnapshot {
  /** Counting-date label as written, e.g. 'Closing Stock. July.26'. */
  label: string
  /** Midnight local time on the date read out of the label, or null when unreadable. */
  date: number | null
  columns: SheetColumn[]
}

export interface SheetRow {
  /** 1-based row number as Excel shows it, so a problem can be pointed at. */
  excelRow: number
  /** Column A, trimmed. Empty when the row carries no code. */
  code: string
  /** True when the code matches the item-code format. */
  hasSku: boolean
  /** Column B, trimmed. */
  name: string
  /** Column C — pack size as written ('1/KG', '720gr/1BT'). Informational. */
  packSize: string
  /** Raw cell values, indexed by column, for the quantity and unit columns. */
  cells: (string | number | null)[]
}

export interface ParsedSheet {
  name: string
  snapshots: SheetSnapshot[]
  rows: SheetRow[]
}

type Grid = (string | number | null)[][]

function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function norm(v: unknown): string {
  return text(v).toLowerCase().replace(/\s+/g, '')
}

/**
 * Read a date out of a counting-date label: 'Closing Stock. July.26', 'Closing Stock.
 * 10.Aug.26'.
 *
 * A label with no day means a closing balance, so it lands on the last day of the month —
 * that is the day the count describes. The year is written with two digits; 26 is 2026.
 * Always shown back to whoever is importing, and always editable, because this is a guess
 * at what a hand-typed heading means.
 */
export function parseSnapshotDate(label: string): number | null {
  const lower = label.toLowerCase()
  let month = -1
  let monthAt = -1
  for (let i = 0; i < MONTHS.length; i++) {
    const at = lower.indexOf(MONTHS[i])
    if (at >= 0 && (monthAt === -1 || at < monthAt)) {
      month = i
      monthAt = at
    }
  }
  if (month < 0) return null

  // Year: the first 2- or 4-digit run after the month name.
  const after = lower.slice(monthAt)
  const yearMatch = after.match(/(\d{4}|\d{2})(?!\d)/)
  if (!yearMatch) return null
  const rawYear = Number(yearMatch[1])
  const year = rawYear >= 100 ? rawYear : 2000 + rawYear

  // Day: a 1- or 2-digit run immediately before the month name, as in '10.Aug.26'.
  const before = lower.slice(0, monthAt)
  const dayMatch = before.match(/(\d{1,2})\D*$/)
  const lastOfMonth = new Date(year, month + 1, 0).getDate()
  const day = dayMatch ? Math.min(Number(dayMatch[1]), lastOfMonth) : lastOfMonth
  if (day < 1) return null

  return new Date(year, month, day).getTime()
}

/**
 * Find the row carrying the Unit/Quantity labels, and from it the quantity columns.
 *
 * A quantity column is one labelled 'Quantity'; the 'Unit' immediately after it belongs to
 * it. The leading 'Unit' with no quantity before it is the pack-size column, which is why
 * the labels are read rather than counted.
 */
function findLabelRow(grid: Grid): { labelRow: number; columns: SheetColumn[] } | null {
  const limit = Math.min(grid.length, 20)
  for (let r = 0; r < limit; r++) {
    const row = grid[r] ?? []
    const columns: SheetColumn[] = []
    for (let c = 0; c < row.length; c++) {
      if (norm(row[c]) !== 'quantity') continue
      const unitCol = norm(row[c + 1]) === 'unit' ? c + 1 : -1
      columns.push({ header: '', qtyCol: c, unitCol })
    }
    if (columns.length > 0) return { labelRow: r, columns }
  }
  return null
}

/** The nearest row above `from` that has a value in at least one quantity column. */
function findHeaderRow(grid: Grid, from: number, qtyCols: number[]): number {
  for (let r = from; r >= 0; r--) {
    const row = grid[r] ?? []
    if (qtyCols.some((c) => text(row[c]) !== '')) return r
  }
  return -1
}

function parseSheet(name: string, grid: Grid): ParsedSheet {
  const found = findLabelRow(grid)
  if (!found) {
    throw new AppError('ชีต "{sheet}" ไม่มีหัวตาราง Quantity/Unit — ไม่ใช่ใบสต๊อกคงเหลือ', { sheet: name })
  }
  const { labelRow, columns } = found
  const qtyCols = columns.map((c) => c.qtyCol)

  // Merged cells carry their value only in the top-left cell, which is the quantity column
  // of the pair — so the label sits exactly where it is needed.
  const dateRow = findHeaderRow(grid, labelRow - 1, qtyCols)
  const locationRow = dateRow > 0 ? findHeaderRow(grid, dateRow - 1, qtyCols) : -1
  if (dateRow < 0 || locationRow < 0) {
    throw new AppError('ชีต "{sheet}" ไม่มีแถวชื่อสาขาและงวดอยู่เหนือหัวตาราง', { sheet: name })
  }

  // Group the columns by counting date, keeping sheet order.
  const snapshots: SheetSnapshot[] = []
  for (const col of columns) {
    const label = text(grid[dateRow]?.[col.qtyCol])
    const header = text(grid[locationRow]?.[col.qtyCol])
    if (!label || !header) continue
    let snap = snapshots.find((s) => s.label === label)
    if (!snap) {
      snap = { label, date: parseSnapshotDate(label), columns: [] }
      snapshots.push(snap)
    }
    snap.columns.push({ ...col, header })
  }
  if (snapshots.length === 0) {
    throw new AppError('ชีต "{sheet}" มีหัวตารางแต่ไม่มีชื่อสาขาหรือชื่องวด', { sheet: name })
  }

  const rows: SheetRow[] = []
  for (let r = labelRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? []
    const name_ = text(row[1])
    if (!name_) continue
    const code = text(row[0])
    rows.push({
      excelRow: r + 1,
      code,
      hasSku: SKU_RE.test(code),
      name: name_,
      packSize: text(row[2]),
      cells: row.map((v) => (v === undefined ? null : (v as string | number | null))),
    })
  }

  return { name, snapshots, rows }
}

/**
 * Parse every sheet in the workbook.
 *
 * Sheets that do not look like a stock sheet are returned as errors rather than thrown, so
 * one stray tab does not block a file whose other tabs are fine.
 */
export function parseStockWorkbook(data: ArrayBuffer): {
  sheets: ParsedSheet[]
  errors: AppError[]
} {
  const wb = XLSX.read(data, { type: 'array' })
  const sheets: ParsedSheet[] = []
  const errors: AppError[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    // raw:true keeps numbers as numbers. With raw:false every quantity arrives as a
    // formatted string, and '1,234.5' then has to be un-formatted back into a number using
    // assumptions about the locale the file was saved in.
    const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    })
    try {
      sheets.push(parseSheet(name, grid))
    } catch (e) {
      if (e instanceof AppError) errors.push(e)
      else throw e
    }
  }
  return { sheets, errors }
}
