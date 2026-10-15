// Which reader a dropped or picked file goes to (Owner, 15 Oct 2026: drag and drop in the
// import window). Decided before anything is read, so a wrong file costs nothing.

import { describe, expect, test } from 'vitest'
import { MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_SHEET_BYTES, routeImportFile } from '../src/lib/importFile'
// The PDF limit is the bill reader's, defined once in lib/importFile.ts.

const f = (name: string, type = '', size = 1000) => ({ name, type, size })
const open = { documents: true, busy: false }

describe('routeImportFile', () => {
  test('spreadsheets by extension or type', () => {
    expect(routeImportFile(f('order.xlsx'), open)).toEqual({ kind: 'sheet' })
    expect(routeImportFile(f('ORDER.XLS'), open)).toEqual({ kind: 'sheet' })
    expect(routeImportFile(f('list.csv', 'text/csv'), open)).toEqual({ kind: 'sheet' })
    expect(routeImportFile(f('download', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), open)).toEqual({ kind: 'sheet' })
  })

  test('photos and PDFs go to the document reader', () => {
    expect(routeImportFile(f('bill.jpg', 'image/jpeg'), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.png', 'image/png'), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.pdf', 'application/pdf'), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('scan.PDF'), open)).toEqual({ kind: 'document' })
  })

  test('without the document reader, a photo or PDF is refused up front', () => {
    expect(routeImportFile(f('bill.jpg', 'image/jpeg'), { documents: false, busy: false })).toEqual({ error: 'no-reader' })
  })

  test('anything else is unsupported', () => {
    expect(routeImportFile(f('notes.txt', 'text/plain'), open)).toEqual({ error: 'unsupported' })
    expect(routeImportFile(f('archive.zip', 'application/zip'), open)).toEqual({ error: 'unsupported' })
    expect(routeImportFile(f('noextension'), open)).toEqual({ error: 'unsupported' })
  })

  test('an empty file and an oversized one are refused before reading', () => {
    expect(routeImportFile(f('order.xlsx', '', 0), open)).toEqual({ error: 'empty' })
    expect(routeImportFile(f('order.xlsx', '', MAX_SHEET_BYTES + 1), open)).toEqual({ error: 'too-big' })
    expect(routeImportFile(f('order.xlsx', '', MAX_SHEET_BYTES), open)).toEqual({ kind: 'sheet' })
    expect(routeImportFile(f('bill.pdf', 'application/pdf', MAX_PDF_BYTES + 1), open)).toEqual({ error: 'too-big' })
    expect(routeImportFile(f('bill.pdf', 'application/pdf', MAX_PDF_BYTES), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1), open)).toEqual({ error: 'too-big' })
    expect(routeImportFile(f('bill.jpg', 'image/jpeg', MAX_IMAGE_BYTES), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.png', 'image/png', MAX_IMAGE_BYTES + 1), open)).toEqual({ error: 'too-big' })
  })

  test('a second file while one is being read is refused', () => {
    expect(routeImportFile(f('order.xlsx'), { documents: true, busy: true })).toEqual({ error: 'busy' })
  })
})
