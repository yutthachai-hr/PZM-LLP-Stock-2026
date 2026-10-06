// Product lines from any plain spreadsheet (6 Oct 2026): header detection in Thai or
// English, code before name, junk rows skipped, and a sheet with no header at all.
//
//   npm test

import * as XLSX from 'xlsx'
import { describe, expect, test } from 'vitest'
import { linesFromRows, parseSheetLines } from '../src/lib/sheetLines'

describe('reading product lines from a sheet', () => {
  test('Thai headers a few rows down, with code, unit and note', () => {
    const rows = [
      ['ใบโอนสินค้า สาขาอ่อนนุช'],
      [],
      ['ลำดับ', 'รหัสสินค้า', 'สินค้า', 'จำนวน', 'หน่วย', 'หมายเหตุ'],
      [1, 'FF-38', 'French Fries 3/8', 8, 'ctn', 'ด่วน'],
      [2, '', 'Mozzarella 2.72 KG', '12', 'ถุง', null],
      [3, 'X', 'ไม่มีจำนวน', '', '', ''],
      [null, null, 'รวม', 'abc'],
    ]
    expect(linesFromRows(rows)).toEqual([
      { row: 4, name: 'French Fries 3/8', qty: 8, code: 'FF-38', unit: 'ctn', note: 'ด่วน' },
      { row: 5, name: 'Mozzarella 2.72 KG', qty: 12, unit: 'ถุง' },
    ])
  })

  test('English headers; thousands separators and decimals', () => {
    expect(linesFromRows([['Item', 'Qty'], ['Bacon', '1,250.5'], ['Ham', 0]])).toEqual([{ row: 2, name: 'Bacon', qty: 1250.5 }])
  })

  test('a code column alone is enough', () => {
    expect(linesFromRows([['SKU', 'Quantity'], ['P-001', 3]])).toEqual([{ row: 2, name: 'P-001', code: 'P-001', qty: 3 }])
  })

  test('no header: first text column, first number column after it', () => {
    expect(linesFromRows([['Pepperoni', 'pack', 6], ['Flour', 'bag', 2]])).toEqual([
      { row: 1, name: 'Pepperoni', qty: 6 },
      { row: 2, name: 'Flour', qty: 2 },
    ])
  })

  test('a Thai CSV (UTF-8, with or without BOM) keeps its headers and every row', () => {
    const text = 'รหัสสินค้า,สินค้า,จำนวน,หน่วย\nVGT-1,เห็ด,3,KG\n,MUSHROOMS,2,KG\n'
    for (const prefix of ['', '﻿']) {
      const csv = new TextEncoder().encode(prefix + text).buffer as ArrayBuffer
      expect(parseSheetLines(csv).lines).toEqual([
        { row: 2, name: 'เห็ด', code: 'VGT-1', qty: 3, unit: 'KG' },
        { row: 3, name: 'MUSHROOMS', qty: 2, unit: 'KG' },
      ])
    }
  })

  test('nothing usable: no lines', () => {
    expect(linesFromRows([['hello'], ['world']])).toEqual([])
  })

  test('a real workbook, and CSV, through the parser', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['note only']]), 'Cover')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['สินค้า', 'จำนวน'], ['Cheese', 4]]), 'Lines')
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    expect(parseSheetLines(data)).toEqual({ sheet: 'Lines', lines: [{ row: 2, name: 'Cheese', qty: 4 }] })
    const csv = new TextEncoder().encode('name,qty\nOlive,7\n').buffer as ArrayBuffer
    expect(parseSheetLines(csv).lines).toEqual([{ row: 2, name: 'Olive', qty: 7 }])
  })
})
