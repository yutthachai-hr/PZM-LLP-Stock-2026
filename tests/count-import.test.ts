// Bringing a location's figures from the closing-stock workbook into a monthly count sheet
// (owner, 29 Sep 2026): every line not in the product's own unit is asked about.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { answeredQty, countIn, guessHeader, importColumns, importRows, rateOf } from '../src/lib/countImport'
import type { ParsedSheet } from '../src/lib/stockSheet'

// Columns: 3 = SKV qty, 4 = SKV unit, 5 = SRS qty, 6 = SRS unit
const row = (excelRow: number, code: string, cells: Record<number, string | number | null>, hasSku = true) => ({
  excelRow,
  code,
  hasSku,
  name: `item ${code}`,
  packSize: '',
  cells: Object.assign(Array(8).fill(null), cells) as (string | number | null)[],
})

const sheet: ParsedSheet = {
  name: 'PZM',
  snapshots: [
    {
      label: 'Closing Stock. Aug.26',
      date: 0,
      columns: [
        { header: 'SKV.23', qtyCol: 3, unitCol: 4 },
        { header: 'SRS.', qtyCol: 5, unitCol: 6 },
      ],
    },
  ],
  rows: [
    row(6, 'VGT-01-01-001', { 3: 8, 4: 'kg', 5: 2, 6: 'KG' }),
    row(7, 'CG-01-03-001', { 3: 4, 4: 'CAN' }),
    row(8, 'SEAS-01-03-001', { 3: 3, 4: 'BOX' }),
    row(9, 'MES-01-01-002', { 3: 5, 4: null }),
    row(10, 'XX-99-99-999', { 3: 1, 4: 'EA' }),
    row(11, '', { 3: 2, 4: 'KG' }, false),
    row(12, 'VGT-01-01-001', { 5: 1, 6: 'KG' }),
    row(13, 'FLO-01-01-001', { 3: 0, 4: 'กระสอบ' }),
    row(14, 'FLO-01-01-002', { 3: null, 4: 'กระสอบ' }),
  ],
}

const products = [
  { id: 'p-veg', sku: 'VGT-01-01-001', unitType: 'KG' },
  { id: 'p-can', sku: 'CG-01-03-001', unitType: 'EA' },
  { id: 'p-box', sku: 'SEAS-01-03-001', unitType: 'EA', unitConversions: [{ label: 'Box', size: 12 }] },
  { id: 'p-mes', sku: 'MES-01-01-002', unitType: 'KG' },
  { id: 'p-flo', sku: 'FLO-01-01-001', unitType: 'EA' },
  { id: 'p-flo2', sku: 'FLO-01-01-002', unitType: 'EA' },
]

describe('importRows', () => {
  const skv = importRows(sheet, { snapshot: 0, column: 0 }, products)
  const by = Object.fromEntries(skv.map((r) => [r.code || `row${r.excelRow}`, r]))

  test('its own unit goes in as it is, whatever the case of the letters', () => {
    expect(by['VGT-01-01-001']).toMatchObject({ status: 'ready', qty: 8, productId: 'p-veg' })
  })

  test('another unit is asked about; a rate the product knows is offered, not assumed', () => {
    expect(by['CG-01-03-001']).toMatchObject({ status: 'unit', fileUnit: 'CAN' })
    expect(by['CG-01-03-001'].knownRate).toBeUndefined()
    expect(by['SEAS-01-03-001']).toMatchObject({ status: 'unit', fileUnit: 'BOX', knownRate: 12 })
  })

  test('no unit written is asked about too', () => {
    expect(by['MES-01-01-002']).toMatchObject({ status: 'unit', fileUnit: '' })
  })

  test('an unknown code and a row with no code are kept out', () => {
    expect(by['XX-99-99-999'].status).toBe('unknown')
    expect(by.row11.status).toBe('nosku')
  })

  test('a zero is a count; a blank is not', () => {
    expect(by['FLO-01-01-001']).toMatchObject({ status: 'unit', qty: 0 })
    expect(by['FLO-01-01-002']).toBeUndefined()
  })

  test('the same product twice in one column is one line awaiting a decision', () => {
    const srs = importRows(sheet, { snapshot: 0, column: 1 }, products)
    expect(srs).toHaveLength(1)
    expect(srs[0]).toMatchObject({ status: 'duplicate', productId: 'p-veg' })
    expect(srs[0].alsoRows?.map((a) => a.qty)).toEqual([2, 1])
  })
})

describe('headers and rates', () => {
  test('columns listed per snapshot', () => {
    expect(importColumns(sheet).map((c) => c.header)).toEqual(['SKV.23', 'SRS.'])
  })

  test('a location is matched to its heading by name — a guess shown for confirmation', () => {
    const hs = ['SKV.23', 'SRS.', 'Onnut.']
    expect(guessHeader(hs, 'สาขาสารสิน')).toBe('SRS.')
    expect(guessHeader(hs, 'On Nut Branch')).toBe('Onnut.')
    expect(guessHeader(hs, 'คลังหลัก')).toBe('SKV.23')
    expect(guessHeader(hs, 'Somewhere else')).toBe('')
  })

  test('a rate said either way round', () => {
    expect(rateOf({ value: 12, mode: 'perFile' })).toBe(12)
    expect(rateOf({ value: 4, mode: 'filePerOne' })).toBe(0.25)
    expect(rateOf({ value: 0, mode: 'perFile' })).toBeNull()
    expect(countIn(3, 12)).toBe(36)
    expect(countIn(8, 1 / 3)).toBe(2.667)
  })
})

describe('answeredQty', () => {
  // The owner typed his count into the rate box: 2 KG became 4, 13 KG of Parma 169 EA.
  test('a count typed as a count is taken as it is, whatever the file says', () => {
    expect(answeredQty(2, { how: 'count', count: 2 })).toBe(2)
    expect(answeredQty(13, { how: 'count', count: 2 })).toBe(2)
    expect(answeredQty(13, { how: 'count', count: 0 })).toBe(0)
  })

  test('an empty or negative count is not an answer yet', () => {
    expect(answeredQty(2, { how: 'count', count: Number.NaN })).toBeNull()
    expect(answeredQty(2, { how: 'count', count: -1 })).toBeNull()
  })

  test('a rate multiplies the file figure', () => {
    expect(answeredQty(3, { how: 'rate', value: 12, mode: 'perFile' })).toBe(36)
    expect(answeredQty(8, { how: 'rate', value: 4, mode: 'filePerOne' })).toBe(2)
    expect(answeredQty(8, { how: 'rate', value: 0, mode: 'perFile' })).toBeNull()
  })
})
