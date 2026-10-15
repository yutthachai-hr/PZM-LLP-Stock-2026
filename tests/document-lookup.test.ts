// Global search for document and bill numbers outside the loaded ledger window.
//
// Owner, 15 Oct 2026: INV2026080528 (an August bill) answered "ไม่พบในข้อมูลที่โหลดไว้",
// because the top bar only searched the last seven days of movements held in memory.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, memoryBackend } = await import('./helpers/memory-backend')
const { setActiveBrand } = await import('../src/brand/brand')
const { lookupDocuments, clearDocumentLookupCache } = await import('../src/services/documentLookup')
const { documentQuery } = await import('../src/lib/documentQuery')

const AUG = Date.parse('2026-08-05T03:00:00Z')
const row = (over: Record<string, unknown>) => ({
  id: String(Math.random()), docNo: 'RC-00010', type: 'receive', productId: 'p1', productName: 'P', unit: 'EA', qty: 1,
  toLocationId: 'loc', date: AUG, byUserId: 'u', byUserName: 'U', createdAt: AUG, ...over,
})
const order = (over: Record<string, unknown>) => ({
  id: 'po-1', docNo: 'PO-00003', supplierId: 'sup-1', supplierName: 'SIAMFOOD', status: 'received', locationId: 'loc',
  orderedAt: AUG - 86_400_000, lines: [], createdBy: 'u', createdByName: 'U', createdAt: AUG, updatedAt: AUG, ...over,
})

let calls: string[] = []
beforeEach(() => {
  vi.restoreAllMocks()
  setActiveBrand('pizza')
  resetMemory()
  clearDocumentLookupCache()
  calls = []
  // Brand-scoped instances are new objects, so count the reads they actually make.
  const forBrand = memoryBackend.forBrand.bind(memoryBackend)
  vi.spyOn(memoryBackend, 'forBrand').mockImplementation((b) => {
    const inner = forBrand(b)
    const getBy = inner.getBy.bind(inner)
    inner.getBy = async <T,>(c: string, f: string, v: string | number | boolean) => {
      calls.push(`${c}.${f}=${String(v)}`)
      return getBy<T>(c, f, v)
    }
    return inner
  })
})

describe('documentQuery: what goes to the database, and in which spelling', () => {
  test('ordinary words never trigger a database lookup', () => {
    expect(documentQuery('flour')).toBeNull()
    expect(documentQuery('ชีส 2 kg')).toBeNull()
    expect(documentQuery('flour 2kg')).toBeNull()
    expect(documentQuery('MOZZARELLA 2.72')).toBeNull()
    expect(documentQuery('12')).toBeNull()
  })
  test('app document numbers are looked up only as document numbers', () => {
    expect(documentQuery('RC-00012')!.invoice).toEqual([])
  })
  test('an invoice number is asked as typed and in capitals, trimmed', () => {
    expect(documentQuery('  inv2026080528 ')).toEqual({ invoice: ['inv2026080528', 'INV2026080528'], docNos: [] })
    expect(documentQuery('INV2026080528')).toEqual({ invoice: ['INV2026080528'], docNos: [] })
  })
  test('inner spaces are also tried without them, and nothing else is invented', () => {
    expect(documentQuery('iv 1001')).toEqual({ invoice: ['iv 1001', 'IV 1001', 'IV1001'], docNos: [] })
  })
  test('app document numbers are written the way the app writes them', () => {
    expect(documentQuery('rc12')!.docNos).toEqual(['RC-00012'])
    expect(documentQuery('RC-00012')!.docNos).toEqual(['RC-00012'])
    expect(documentQuery('po 3')!.docNos).toEqual(['PO-00003'])
    expect(documentQuery('adj-7')!.docNos).toEqual(['ADJ-00007'])
  })
})

describe('lookupDocuments', () => {
  test('INV2026080528 on an August receipt is found by its bill field, outside any window', async () => {
    seed('stockMovements', [
      row({ id: 'm1', invoiceNo: 'INV2026080528', supplierName: 'SIAMFOOD', docNo: 'RC-00041' }),
      row({ id: 'm2', invoiceNo: 'INV2026080528', supplierName: 'SIAMFOOD', docNo: 'RC-00041', productId: 'p2' }),
    ])
    const r = await lookupDocuments('INV2026080528')
    expect(r.hits).toEqual([expect.objectContaining({ key: 'doc:RC-00041', to: '/movements?doc=RC-00041', label: 'RC-00041', sub: 'SIAMFOOD · INV2026080528' })])
    expect(r.searched).toBe(true)
  })

  test('a bill recorded only on a purchase order received before 24 Sep is found through the order', async () => {
    seed('purchaseOrders', [order({ invoiceNo: 'IV-900', movementDocNo: 'RC-00007', receivedAt: AUG })])
    const r = await lookupDocuments('iv-900')
    expect(r.hits).toEqual([expect.objectContaining({ key: 'po:po-1', to: '/orders?po=po-1', label: 'PO-00003', sub: 'SIAMFOOD · IV-900 · RC-00007' })])
  })

  test('an old receipt number opens that receipt', async () => {
    seed('stockMovements', [row({ docNo: 'RC-00012' })])
    const r = await lookupDocuments('rc 12')
    expect(r.hits.map((h) => h.key)).toEqual(['doc:RC-00012'])
  })

  test('the same bill number from two suppliers gives two documents, never one merged', async () => {
    seed('stockMovements', [
      row({ id: 'a', docNo: 'RC-00001', invoiceNo: 'B-77', supplierName: 'MAKRO' }),
      row({ id: 'b', docNo: 'RC-00002', invoiceNo: 'B-77', supplierName: 'SIAMFOOD' }),
    ])
    const r = await lookupDocuments('B-77')
    expect(r.hits.map((h) => h.sub).sort()).toEqual(['MAKRO · B-77', 'SIAMFOOD · B-77'])
  })

  test('PO numbers run per supplier, so one number can be several orders', async () => {
    seed('purchaseOrders', [order({ id: 'a', docNo: 'PO-00001', supplierName: 'A' }), order({ id: 'b', docNo: 'PO-00001', supplierName: 'B' })])
    const r = await lookupDocuments('PO-00001')
    expect(r.hits.map((h) => h.key).sort()).toEqual(['po:a', 'po:b'])
  })

  test('voided rows are not offered as the document', async () => {
    seed('stockMovements', [row({ invoiceNo: 'X-11', voided: true })])
    expect((await lookupDocuments('X-11')).hits).toEqual([])
  })

  test('a missing number reports what was searched and the known gap, without inventing a match', async () => {
    const r = await lookupDocuments('INV-404404')
    expect(r.hits).toEqual([])
    expect(r.searched).toBe(true)
    expect(r.notIndexed).toBe('legacyNotes')
  })

  test('another brand\'s documents are never returned', async () => {
    seed('lelapin__stockMovements', [row({ invoiceNo: 'INV2026080528', docNo: 'RC-00099' })])
    expect((await lookupDocuments('INV2026080528')).hits).toEqual([])
    setActiveBrand('lelapin')
    clearDocumentLookupCache()
    expect((await lookupDocuments('INV2026080528')).hits.map((h) => h.label)).toEqual(['RC-00099'])
  })

  test('the read is bounded: a few equality queries, and none at all for ordinary words', async () => {
    await lookupDocuments('flour')
    expect(calls).toEqual([])
    await lookupDocuments('INV2026080528')
    expect(calls).toEqual([
      'stockMovements.invoiceNo=INV2026080528',
      'purchaseOrders.invoiceNo=INV2026080528',
    ])
  })

  test('a repeated search in the same brand is served from the session cache', async () => {
    seed('stockMovements', [row({ invoiceNo: 'INV1' })])
    await lookupDocuments('INV1')
    const first = calls.length
    await lookupDocuments(' INV1 ')
    expect(calls.length).toBe(first)
  })

  test('a number not found is asked again, so a bill received since then is found', async () => {
    expect((await lookupDocuments('INV2026101501')).hits).toEqual([])
    seed('stockMovements', [row({ invoiceNo: 'INV2026101501', docNo: 'RC-00120' })])
    expect((await lookupDocuments('INV2026101501')).hits.map((h) => h.label)).toEqual(['RC-00120'])
  })
})
