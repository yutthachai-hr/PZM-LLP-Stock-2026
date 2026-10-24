/**
 * Which reader a file goes to, decided from its name, type and size before a byte is read
 * (Owner, 15 Oct 2026: drop a file onto the import window). The readers are the existing
 * ones: lib/sheetLines for spreadsheets, services/billOcr for photos and PDFs.
 */

/** The bill endpoint takes about 4 MB of base64: a PDF up to this size goes as it is. */
export const MAX_PDF_BYTES = 2_900_000
/** A spreadsheet is read in the browser; past this it is almost certainly not an order list. */
export const MAX_SHEET_BYTES = 10_000_000
/** Browser source-file cap before decoding/compression, separate from the OCR endpoint limit.
 * Decoded memory also depends on pixel dimensions; this byte cap does not bound it. */
export const MAX_IMAGE_BYTES = 10_000_000

export type ImportRoute = { kind: 'sheet' | 'document' } | { error: 'busy' | 'unsupported' | 'no-reader' | 'too-big' | 'empty' }

const SHEET_NAME = /\.(xlsx|xls|csv)$/i
const SHEET_TYPE = /^(text\/csv|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/
const PDF = (f: { name: string; type: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const IMAGE = (f: { name: string; type: string }) => f.type.startsWith('image/') || ((!f.type || f.type === 'application/octet-stream') && /\.(jpe?g|png|webp)$/i.test(f.name))

export function routeImportFile(
  f: { name: string; type: string; size: number },
  o: { documents: boolean; busy: boolean },
): ImportRoute {
  if (o.busy) return { error: 'busy' }
  const sheet = SHEET_NAME.test(f.name) || SHEET_TYPE.test(f.type)
  const document = !sheet && (IMAGE(f) || PDF(f))
  if (!sheet && !document) return { error: 'unsupported' }
  if (f.size === 0) return { error: 'empty' }
  if (document && !o.documents) return { error: 'no-reader' }
  if (sheet) {
    if (f.size > MAX_SHEET_BYTES) return { error: 'too-big' }
  } else if (PDF(f)) {
    if (f.size > MAX_PDF_BYTES) return { error: 'too-big' }
  } else if (f.size > MAX_IMAGE_BYTES) {
    return { error: 'too-big' }
  }
  return { kind: sheet ? 'sheet' : 'document' }
}
