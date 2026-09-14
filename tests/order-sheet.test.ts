// Reading the weekly order workbook.
//
//   npm test
//
// The fixture is built in the test to the shape of the real file (ตัวอย่างสั่งของ 140926.xlsx),
// which is company data and stays out of the repo: several order days side by side on one
// sheet, each with its own header row, stock-on-hand columns between the unit and the order
// quantity, and a quantity column that mixes numbers, dashes and words.

import * as XLSX from 'xlsx'
import { describe, expect, test } from 'vitest'
import {
  columnIndex,
  columnLetter,
  defaultBlock,
  parseBlockDate,
  parseOrderWorkbook,
  readQty,
} from '../src/lib/orderSheet'

type Cell = string | number | null

function workbook(sheets: Record<string, Cell[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return out
}

const HEAD = ['ชื่อวัตถุดิบ', 'รอบส่ง ', 'หน่วย', 'SKV', 'SRS', 'ONNUT', 'รวม', 'จำนวนสั่ง', 'เรียกเข้า ']

/** Two blocks side by side, the way the sample's first sheet is laid out. */
function sampleSheet(): Cell[][] {
  const gap: Cell[] = [null]
  return [
    [],
    ['รายการสั่งของ', null, null, 'รายการสั่งของ 13/7/2026', null, null, null, null, null, ...gap, 'รายการสั่งของ 14/7/2026'],
    [...HEAD, ...gap, ...HEAD],
    ['SWISS BROWN MUSHROOMS', 'อังคาร-เสาร์', 'KG', 24, 4, 2, 30, 8, ' Zakana 15/07', ...gap, 'SWISS BROWN MUSHROOMS', null, 'KG', 20, 2, 0, 22, 12, '15-Jul'],
    ['CAPSICUM  GREEN ', null, 'KG', null, null, null, 0, null, null, ...gap, 'SAUSAGE MIX DOLCE ', null, 'กก.', null, 2, 3, 5, 20, null],
    ['ROCKET SALAD ', null, 'KG', 2, 0.5, '-', 2.5, 3, '15-Jul', ...gap, 'PEPPERONI', null, 'กก.', '-', '-', 2, 2, 'ตาม', null],
    ['SEAFOOD ', null, 'PCS', 25, 10, 5, 40, '-', null, ...gap, 'COKE ZERO CAN 325 ML 1X24            ', null, 'แพ็ค', '-', '-', 17, 17, 5, 46000],
    ['กุ้งขาว', null, 'KG', null, null, null, null, 10, '15-Jul'],
    ['PEPPERONI PORK AND BEEF 1 kg.', null, 'BA', 14, 1, 5, 20, 'ตาม', 'รอยอดสรุป '],
    ['OIL BOTTLE ขวดแก้ว ', null, 'ใบ', 1000, null, null, 1000, '1,200', null],
  ]
}

describe('finding the blocks', () => {
  test('two blocks side by side are two blocks, each with its own columns', () => {
    const { blocks, sheets } = parseOrderWorkbook(workbook({ 'รายการสั่งของ 0726': sampleSheet() }))
    expect(sheets).toEqual(['รายการสั่งของ 0726'])
    expect(blocks).toHaveLength(2)
    const [a, b] = blocks
    expect(a.cols).toEqual({ name: 0, cycle: 1, unit: 2, qty: 7, note: 8 })
    expect(b.cols).toEqual({ name: 10, cycle: 11, unit: 12, qty: 17, note: 18 })
  })

  test('a block takes the dated heading over the bare title beside it', () => {
    const [a, b] = parseOrderWorkbook(workbook({ s: sampleSheet() })).blocks
    expect(a.label).toBe('รายการสั่งของ 13/7/2026')
    expect(new Date(a.date!).getDate()).toBe(13)
    expect(b.label).toBe('รายการสั่งของ 14/7/2026')
  })

  test('the order quantity is จำนวนสั่ง, never the on-hand total beside it', () => {
    const [a] = parseOrderWorkbook(workbook({ s: sampleSheet() })).blocks
    const swiss = a.rows.find((r) => r.name === 'SWISS BROWN MUSHROOMS')!
    expect(swiss).toMatchObject({ qty: 8, qtyState: 'order', unit: 'KG', note: 'Zakana 15/07' })
  })

  test('a block stacked below another ends the one above it', () => {
    const rows: Cell[][] = [
      ['รายการสั่งของ 1/9/2026'],
      HEAD,
      ['A', null, 'KG', null, null, null, null, 1, null],
      [],
      ['รายการสั่งของ 8/9/2026'],
      HEAD,
      ['B', null, 'KG', null, null, null, null, 2, null],
    ]
    const { blocks } = parseOrderWorkbook(workbook({ s: rows }))
    expect(blocks.map((b) => b.rows.map((r) => r.name))).toEqual([['A'], ['B']])
    expect(blocks.map((b) => b.label)).toEqual(['รายการสั่งของ 1/9/2026', 'รายการสั่งของ 8/9/2026'])
  })

  test('a block with no heading does not borrow its neighbour\'s date', () => {
    const rows: Cell[][] = [
      [null, null, null, null, null, null, null, null, null, null, 'รายการสั่งของ 14/7/2026'],
      [...HEAD, null, ...HEAD],
      ['A', null, 'KG', null, null, null, null, 1, null, null, 'B', null, 'KG', null, null, null, null, 2, null],
    ]
    const [a, b] = parseOrderWorkbook(workbook({ Sheet1: rows })).blocks
    expect(a.date).toBeNull()
    expect(a.label).toBe('Sheet1')
    expect(b.date).not.toBeNull()
  })

  test('a sheet whose header row has no quantity column is not a block', () => {
    const rows: Cell[][] = [['ชื่อวัตถุดิบ', 'หน่วย', 'รวม'], ['A', 'KG', 5]]
    expect(parseOrderWorkbook(workbook({ s: rows })).blocks).toEqual([])
  })
})

describe('reading a quantity cell', () => {
  test('a number is an order; a dash, blank or zero is not; a word is a question', () => {
    expect(readQty(8)).toMatchObject({ qtyState: 'order', qty: 8 })
    expect(readQty('12')).toMatchObject({ qtyState: 'order', qty: 12 })
    expect(readQty('1,200')).toMatchObject({ qtyState: 'order', qty: 1200 })
    expect(readQty(0.5)).toMatchObject({ qtyState: 'order', qty: 0.5 })
    expect(readQty('-')).toMatchObject({ qtyState: 'none', qty: null })
    expect(readQty('—')).toMatchObject({ qtyState: 'none' })
    expect(readQty(null)).toMatchObject({ qtyState: 'none' })
    expect(readQty(0)).toMatchObject({ qtyState: 'none' })
    expect(readQty(-3)).toMatchObject({ qtyState: 'none' })
    expect(readQty('ตาม')).toMatchObject({ qtyState: 'unclear', qty: null, rawQty: 'ตาม' })
    expect(readQty('30/KG')).toMatchObject({ qtyState: 'unclear' })
  })

  test('the sample rows come out as a person would read them', () => {
    const [a, b] = parseOrderWorkbook(workbook({ s: sampleSheet() })).blocks
    const by = (rows: typeof a.rows, name: string) => rows.find((r) => r.name === name)!
    expect(by(a.rows, 'SEAFOOD').qtyState).toBe('none')
    expect(by(a.rows, 'กุ้งขาว')).toMatchObject({ qty: 10, unit: 'KG' })
    expect(by(a.rows, 'PEPPERONI PORK AND BEEF 1 kg.')).toMatchObject({
      qtyState: 'unclear',
      rawQty: 'ตาม',
      note: 'รอยอดสรุป',
    })
    expect(by(a.rows, 'OIL BOTTLE ขวดแก้ว').qty).toBe(1200)
    expect(by(b.rows, 'SAUSAGE MIX DOLCE')).toMatchObject({ qty: 20, unit: 'กก.' })
    expect(by(b.rows, 'PEPPERONI').qtyState).toBe('unclear')
    // A date serial in the note column reads as a date, not as 46000.
    expect(by(b.rows, 'COKE ZERO CAN 325 ML 1X24')).toMatchObject({ qty: 5, unit: 'แพ็ค' })
    expect(by(b.rows, 'COKE ZERO CAN 325 ML 1X24').note).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
  })

  test('names are trimmed and rows with no name are skipped', () => {
    const [a] = parseOrderWorkbook(workbook({ s: sampleSheet() })).blocks
    expect(a.rows.every((r) => r.name === r.name.trim() && r.name !== '')).toBe(true)
    expect(a.rows.map((r) => r.excelRow)).toEqual([4, 5, 6, 7, 8, 9, 10])
  })
})

describe('the block heading date', () => {
  test('reads d/m/yyyy, a two-digit year, and a Buddhist year', () => {
    const y = (ms: number | null) => new Date(ms!).getFullYear()
    expect(y(parseBlockDate('รายการสั่งของ 14/9/2026'))).toBe(2026)
    expect(y(parseBlockDate('2/8/26'))).toBe(2026)
    expect(y(parseBlockDate('รายการสั่งของ 14/9/2569'))).toBe(2026)
    expect(parseBlockDate('รายการสั่งของ')).toBeNull()
    expect(parseBlockDate('31/2/2026')).toBeNull()
  })

  test('the default block is the newest dated one', () => {
    const rows: Cell[][] = [
      ['รายการสั่งของ 1/9/2026', null, null, null, null, null, null, null, null, null, 'รายการสั่งของ 8/9/2026'],
      [...HEAD, null, ...HEAD],
      ['A', null, 'KG', null, null, null, null, 1, null, null, 'B', null, 'KG', null, null, null, null, 2, null],
    ]
    const { blocks } = parseOrderWorkbook(workbook({ s: rows }))
    expect(defaultBlock(blocks)!.label).toBe('รายการสั่งของ 8/9/2026')
    expect(defaultBlock([])).toBeNull()
  })
})

describe('a file the headers cannot explain', () => {
  test('is read from the columns a person picked, one block per sheet', () => {
    const rows: Cell[][] = [
      ['Item', 'x', 'Amount', 'UOM'],
      ['COKE CAN', 1, 5, 'Pack'],
      ['', 1, 5, 'Pack'],
      ['FRENCH FRIES', 2, 'ตาม', 'Pack'],
    ]
    const { blocks } = parseOrderWorkbook(workbook({ Orders: rows }), { name: 'a', qty: 'C', unit: 'd' })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].rows.map((r) => [r.name, r.qty, r.unit, r.qtyState])).toEqual([
      ['COKE CAN', 5, 'Pack', 'order'],
      ['FRENCH FRIES', null, 'Pack', 'unclear'],
    ])
  })

  test('column letters round-trip', () => {
    expect(columnIndex('A')).toBe(0)
    expect(columnIndex('ef')).toBe(135)
    expect(columnIndex('')).toBe(-1)
    expect(columnIndex('1')).toBe(-1)
    expect(columnLetter(135)).toBe('EF')
  })
})
