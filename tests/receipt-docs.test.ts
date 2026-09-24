// A receipt's paperwork: the duplicate-bill check, and reading old and new receipts alike.
//
//   npm test
//
// Owner, 24 Sep 2026: supplier, bill number and note stop sharing one free-text field, the
// same bill from the same supplier is never taken in twice without a warning, and receipts
// filed before the change still read as they always did.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed } = await import('./helpers/memory-backend')
const { findDuplicateDocument } = await import('../src/services/receiptDocs')
const { movementNote } = await import('../src/lib/receiptLabel')
const { setActiveBrand } = await import('../src/brand/brand')

const row = (over: Record<string, unknown>) => ({
  id: String(Math.random()), docNo: 'RC-00010', type: 'receive', productId: 'p1', productName: 'P', unit: 'EA', qty: 1,
  toLocationId: 'loc', date: 100, byUserId: 'u', byUserName: 'U', createdAt: 100, ...over,
})

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
})

describe('findDuplicateDocument', () => {
  test('the same bill number from the same supplier is found, naming the receipt', async () => {
    seed('stockMovements', [row({ invoiceNo: 'IV-1001', supplierId: 'sup-1', supplierName: 'SIAMFOOD', poDocNo: 'PO-00005' })])
    expect(await findDuplicateDocument({ invoiceNo: 'IV-1001', supplierId: 'sup-1' })).toMatchObject({ docNo: 'RC-00010', poDocNo: 'PO-00005' })
  })

  test('the same number from another supplier is a different bill', async () => {
    seed('stockMovements', [row({ invoiceNo: 'IV-1001', supplierId: 'sup-1', supplierName: 'SIAMFOOD' })])
    expect(await findDuplicateDocument({ invoiceNo: 'IV-1001', supplierId: 'sup-2' })).toBeNull()
  })

  test('typed in small letters, the bill is still found', async () => {
    seed('stockMovements', [row({ invoiceNo: 'IV-1001', supplierId: 'sup-1' })])
    expect(await findDuplicateDocument({ invoiceNo: ' iv-1001 ', supplierId: 'sup-1' })).not.toBeNull()
  })

  test('a supplier with no id is matched by name', async () => {
    seed('stockMovements', [row({ invoiceNo: 'B-7', supplierName: 'Makro' })])
    expect(await findDuplicateDocument({ invoiceNo: 'B-7', supplierName: 'MAKRO' })).not.toBeNull()
  })

  test('a voided receipt does not count', async () => {
    seed('stockMovements', [row({ invoiceNo: 'IV-1', supplierId: 'sup-1', voided: true })])
    expect(await findDuplicateDocument({ invoiceNo: 'IV-1', supplierId: 'sup-1' })).toBeNull()
  })

  test('an order received before bills had their own field is still found through the order', async () => {
    seed('purchaseOrders', [{
      id: 'po-1', docNo: 'PO-00003', supplierId: 'sup-1', supplierName: 'SIAMFOOD', status: 'received', locationId: 'loc',
      orderedAt: 1, lines: [], invoiceNo: 'IV-900', movementDocNo: 'RC-00007', receivedAt: 50,
      createdBy: 'u', createdByName: 'U', createdAt: 1, updatedAt: 1,
    }])
    expect(await findDuplicateDocument({ invoiceNo: 'IV-900', supplierId: 'sup-1' })).toMatchObject({ docNo: 'RC-00007', poId: 'po-1' })
  })

  test('an empty number or an unknown supplier asks nothing', async () => {
    seed('stockMovements', [row({ invoiceNo: 'IV-1', supplierId: 'sup-1' })])
    expect(await findDuplicateDocument({ invoiceNo: '  ', supplierId: 'sup-1' })).toBeNull()
    expect(await findDuplicateDocument({ invoiceNo: 'IV-1' })).toBeNull()
  })
})

describe('movementNote', () => {
  test('a new receipt reads supplier · bill · order · note', () => {
    expect(movementNote({ supplierName: 'SIAMFOOD', invoiceNo: 'IV-1001', poDocNo: 'PO-00005', note: 'late' })).toBe('SIAMFOOD · IV-1001 · PO-00005 · late')
  })

  test('a receipt keyed before the change reads its note exactly as before', () => {
    expect(movementNote({ note: 'เดล ตาซาโร / เลขบิล IV2616876' })).toBe('เดล ตาซาโร / เลขบิล IV2616876')
  })

  test('a stored UI key in the note is translated; composed paperwork is not', () => {
    const tr = (s: string) => (s === 'ตั้งยอดคงเหลือ' ? 'Count set' : s)
    expect(movementNote({ note: 'ตั้งยอดคงเหลือ' }, tr)).toBe('Count set')
    expect(movementNote({}, tr)).toBe('')
  })
})
