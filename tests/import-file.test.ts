// Which reader a dropped or picked file goes to (Owner, 15 Oct 2026: drag and drop in the
// import window). Decided before anything is read, so a wrong file costs nothing.

import { describe, expect, test, vi } from 'vitest'

vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })

const { MAX_IMAGE_BYTES, MAX_LOCAL_PDF_BYTES, MAX_SHEET_BYTES, routeImportFile } = await import('../src/lib/importFile')
const { readDocumentFile } = await import('../src/services/billOcr')

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

  test('images with empty MIME type fall back safely to supported extensions only when MIME is empty', () => {
    expect(routeImportFile(f('bill.jpg', ''), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.png', ''), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.jpeg', ''), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.webp', ''), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.jpg', '', MAX_IMAGE_BYTES + 1), open)).toEqual({ error: 'too-big' })
    expect(routeImportFile(f('bill.png', '', 0), open)).toEqual({ error: 'empty' })
    expect(routeImportFile(f('bill.png', ''), { documents: false, busy: false })).toEqual({ error: 'no-reader' })
    // Non-empty non-image MIME is not overridden by extension
    expect(routeImportFile(f('bill.jpg', 'text/plain'), open)).toEqual({ error: 'unsupported' })
    // Empty MIME with non-image extension is still unsupported
    expect(routeImportFile(f('notes.txt', ''), open)).toEqual({ error: 'unsupported' })
  })

  test('F4: images with application/octet-stream MIME fall back to supported extensions', () => {
    expect(routeImportFile(f('bill.jpg', 'application/octet-stream'), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.jpeg', 'application/octet-stream'), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.png', 'application/octet-stream'), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.webp', 'application/octet-stream'), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.jpg', 'application/octet-stream', MAX_IMAGE_BYTES + 1), open)).toEqual({ error: 'too-big' })
    expect(routeImportFile(f('bill.png', 'application/octet-stream', 0), open)).toEqual({ error: 'empty' })
    expect(routeImportFile(f('bill.png', 'application/octet-stream'), { documents: false, busy: false })).toEqual({ error: 'no-reader' })
    // Non-image extension with application/octet-stream is unsupported
    expect(routeImportFile(f('notes.txt', 'application/octet-stream'), open)).toEqual({ error: 'unsupported' })
    expect(routeImportFile(f('data.bin', 'application/octet-stream'), open)).toEqual({ error: 'unsupported' })
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
    expect(routeImportFile(f('bill.pdf', 'application/pdf', 3_000_000), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.pdf', 'application/pdf', 19_999_999), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.pdf', 'application/pdf', MAX_LOCAL_PDF_BYTES), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.pdf', 'application/pdf', 20_000_001), open)).toEqual({ error: 'too-big' })
    expect(routeImportFile(f('bill.pdf', 'application/pdf', MAX_LOCAL_PDF_BYTES + 1), open)).toEqual({ error: 'too-big' })
    expect(routeImportFile(f('bill.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1), open)).toEqual({ error: 'too-big' })
    expect(routeImportFile(f('bill.jpg', 'image/jpeg', MAX_IMAGE_BYTES), open)).toEqual({ kind: 'document' })
    expect(routeImportFile(f('bill.png', 'image/png', MAX_IMAGE_BYTES + 1), open)).toEqual({ error: 'too-big' })
  })

  test('a second file while one is being read is refused', () => {
    expect(routeImportFile(f('order.xlsx'), { documents: true, busy: true })).toEqual({ error: 'busy' })
  })

  test('downstream readDocumentFile validates format and accepts empty MIME with image extension without early type rejection', async () => {
    const nonImage = new File(['text'], 'notes.txt', { type: '' })
    await expect(readDocumentFile(nonImage)).rejects.toThrow('รองรับเฉพาะรูปภาพหรือ PDF')

    const wrongMime = new File(['text'], 'bill.jpg', { type: 'text/plain' })
    await expect(readDocumentFile(wrongMime)).rejects.toThrow('รองรับเฉพาะรูปภาพหรือ PDF')

    const emptyMimeImage = new File(['fake-image-bytes'], 'bill.jpg', { type: '' })
    // Must not be rejected with format error; proceeds to decode
    await expect(readDocumentFile(emptyMimeImage)).rejects.not.toThrow('รองรับเฉพาะรูปภาพหรือ PDF')

    const octetStreamImage = new File(['fake-image-bytes'], 'bill.png', { type: 'application/octet-stream' })
    await expect(readDocumentFile(octetStreamImage)).rejects.not.toThrow('รองรับเฉพาะรูปภาพหรือ PDF')

    const octetStreamNonImage = new File(['fake-bytes'], 'data.bin', { type: 'application/octet-stream' })
    await expect(readDocumentFile(octetStreamNonImage)).rejects.toThrow('รองรับเฉพาะรูปภาพหรือ PDF')
  })
})
