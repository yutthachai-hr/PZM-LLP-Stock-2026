import { backend } from '../backend'
import { getBrand, type BrandId } from '../brand/brand'
import { documentQuery } from '../lib/documentQuery'
import type { SearchHit } from '../lib/globalSearch'
import { COL, type PurchaseOrder, type StockMovement } from '../types'

/**
 * Document and bill numbers looked up in the database, for the top bar's search.
 *
 * Loaded only when someone types a document-like number, and only as equality queries on
 * single fields Firestore indexes by default — never a scan of the ledger and never a
 * listener. A bill keyed by hand before 24 Sep 2026 lives inside a free-text note, which no
 * equality query can reach unless the note IS the bill number; those whole-note matches are
 * asked for too (Owner, 16 Oct 2026: INV26080171 on RC-00008), capped, and marked as found
 * in a note. A bill number inside a longer note still cannot be found by equality, and
 * `notIndexed` says so instead of letting "none found" read as "there is none".
 */
export interface DocumentLookup {
  brand: BrandId
  hits: SearchHit[]
  /** The database was asked (false for words that are not document numbers). */
  searched: boolean
  notIndexed?: 'legacyNotes'
}

const MAX_CACHED = 50
/** Old receipts whose whole note is the number: enough to show, never the ledger. */
const MAX_NOTE_ROWS = 20
const cache = new Map<string, DocumentLookup>()

export function clearDocumentLookupCache(): void {
  cache.clear()
}

export async function lookupDocuments(raw: string): Promise<DocumentLookup> {
  const brand = getBrand()
  const q = documentQuery(raw)
  if (!q) return { brand, hits: [], searched: false }
  const key = `${brand}|${raw.trim().toUpperCase()}`
  const cached = cache.get(key)
  if (cached) return cached

  const db = backend.forBrand(brand)
  const isPo = q.docNos.some((d) => d.startsWith('PO-'))
  const [byDoc, byInvoice, poByDoc, poByInvoice, byNote] = await Promise.all([
    isPo ? [] : Promise.all(q.docNos.map((d) => db.getBy<StockMovement>(COL.movements, 'docNo', d))),
    Promise.all(q.invoice.map((n) => db.getBy<StockMovement>(COL.movements, 'invoiceNo', n))),
    isPo ? Promise.all(q.docNos.map((d) => db.getBy<PurchaseOrder>(COL.purchaseOrders, 'docNo', d))) : [],
    Promise.all(q.invoice.map((n) => db.getBy<PurchaseOrder>(COL.purchaseOrders, 'invoiceNo', n))),
    // Only for a bill-like entry (never an app document number), the same spellings, capped.
    Promise.all(q.invoice.map((n) => db.query<StockMovement>(COL.movements, { filters: [{ field: 'note', op: '==', value: n }], limit: MAX_NOTE_ROWS }))),
  ])

  const hits = new Map<string, SearchHit & { at: number }>()
  for (const m of [...byDoc.flat(), ...byInvoice.flat()]) {
    if (m.voided || !m.docNo) continue
    const was = hits.get(`doc:${m.docNo}`)
    if (was && was.at >= m.createdAt) continue
    hits.set(`doc:${m.docNo}`, {
      group: 'documents', key: `doc:${m.docNo}`, to: `/movements?doc=${encodeURIComponent(m.docNo)}`, label: m.docNo,
      sub: [m.supplierName, m.invoiceNo].filter(Boolean).join(' · ') || undefined, at: m.createdAt,
    })
  }
  for (const m of byNote.flat()) {
    if (m.voided || !m.docNo || hits.has(`doc:${m.docNo}`)) continue
    hits.set(`doc:${m.docNo}`, {
      group: 'documents', key: `doc:${m.docNo}`, to: `/movements?doc=${encodeURIComponent(m.docNo)}`, label: m.docNo,
      sub: [m.supplierName, m.note?.trim()].filter(Boolean).join(' · ') || undefined, foundIn: 'note', at: m.createdAt,
    })
  }
  for (const o of [...poByDoc.flat(), ...poByInvoice.flat()]) {
    hits.set(`po:${o.id}`, {
      group: 'documents', key: `po:${o.id}`, to: `/orders?po=${encodeURIComponent(o.id)}`, label: o.docNo,
      sub: [o.supplierName, o.invoiceNo, o.movementDocNo].filter(Boolean).join(' · ') || undefined, at: o.receivedAt ?? o.orderedAt,
    })
  }
  const result: DocumentLookup = {
    brand,
    hits: [...hits.values()].sort((a, b) => b.at - a.at).map(({ at: _at, ...hit }) => hit),
    searched: true,
    ...(q.invoice.length ? { notIndexed: 'legacyNotes' as const } : {}),
  }
  // Only answers are kept. "Not found" is asked again next time, because the bill may be
  // received in between: someone checks a number, files the receipt, then checks again.
  if (result.hits.length) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
    cache.set(key, result)
  }
  return result
}

/** One document's rows, wherever in time it was filed: the deep link from a search result. */
export async function movementsOfDocument(docNo: string): Promise<StockMovement[]> {
  return backend.forBrand(getBrand()).getBy<StockMovement>(COL.movements, 'docNo', docNo)
}
