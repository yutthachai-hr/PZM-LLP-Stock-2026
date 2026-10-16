/**
 * Whether a search box entry is worth asking the database about, and in which exact spellings.
 *
 * The database can only answer equality, so the spellings are the whole search: as typed, in
 * capitals, and — when there are inner spaces — without them. Nothing else is guessed: a bill
 * stored as "INV-2026" is not found by typing "INV2026", and the screen says what was asked.
 * App document numbers are written the way the app writes them (RC-00012), so "rc12" works.
 */
export interface DocumentQuery {
  /** Spellings to try against `invoiceNo`. Empty for an app document number. */
  invoice: string[]
  /** Exact app document numbers to try against `docNo`. */
  docNos: string[]
}

const APP_DOC = /^(RC|IS|ADJ|CS|PO)[\s-]*0*(\d{1,7})$/i
const OTHER_SCRIPT = /[^\x20-\x7e]/

export function documentQuery(raw: string): DocumentQuery | null {
  const q = raw.trim()
  const app = APP_DOC.exec(q)
  if (app) return { invoice: [], docNos: [`${app[1].toUpperCase()}-${app[2].padStart(5, '0')}`] }
  if (!q || q.length > 40 || OTHER_SCRIPT.test(q) || !/^[\w\s\-/.#]+$/.test(q)) return null
  const alnum = q.replace(/[^A-Za-z0-9]/g, '')
  const digits = alnum.replace(/\D/g, '').length
  if (alnum.length < 2 || digits === 0 || digits / alnum.length < 0.3) return null
  if (digits === alnum.length && alnum.length < 4) return null
  const upper = q.toUpperCase()
  return { invoice: [...new Set([q, upper, upper.replace(/\s+/g, '')])], docNos: [] }
}
