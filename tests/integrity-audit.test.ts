import { describe, expect, it } from 'vitest'
import { auditIntegrity, type AuditInput } from '../src/lib/integrityAudit'
import type { Product, PurchaseOrder, PurchaseRequest, StockLevel, StockLocation, StockMovement, Transfer } from '../src/types'

const product = (id: string, extra: Partial<Product> = {}) => ({ id, name: id.toUpperCase(), sku: id, unitType: 'kg', ...extra }) as Product
const loc = (id: string) => ({ id, name: id }) as StockLocation
const level = (id: string, qty: number) => ({ id, qty }) as StockLevel

let seq = 0
const mv = (m: Partial<StockMovement>) =>
  ({ id: `m${++seq}`, docNo: `RC-${seq}`, type: 'receive', productId: 'flour', productName: 'FLOUR', unit: 'kg', qty: 1, date: 0, byUserId: 'u', byUserName: 'U', createdAt: 0, ...m }) as StockMovement

const order = (o: Partial<PurchaseOrder>) =>
  ({ id: 'po1', docNo: 'PO-1', status: 'ordered', supplierId: 's', locationId: 'wh', lines: [], ...o }) as PurchaseOrder

function input(over: Partial<AuditInput> = {}): AuditInput {
  return {
    products: [product('flour'), product('cheese')],
    locations: [loc('wh'), loc('br1')],
    stockLevels: [],
    movements: [],
    purchaseOrders: [],
    purchaseRequests: [],
    transfers: [],
    ...over,
  }
}

const codes = (i: AuditInput) => auditIntegrity(i).findings.map((f) => f.code)

describe('integrity auditor', () => {
  it('reports nothing for data that agrees, and says how much it looked at', () => {
    const receipt = mv({ docNo: 'RC-1', toLocationId: 'wh', qty: 5, poId: 'po1', invoiceNo: 'INV1' })
    const r = auditIntegrity(
      input({
        movements: [receipt],
        stockLevels: [level('wh__flour', 5)],
        purchaseOrders: [
          order({
            status: 'received',
            lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'kg', orderedQty: 5, receivedQty: 5 }],
            receipts: [{ docNo: 'RC-1', date: 0, invoiceNo: 'INV1', byId: 'u', byName: 'U', lines: [{ productId: 'flour', qty: 5 }] }],
          }),
        ],
      }),
    )
    expect(r.findings).toEqual([])
    expect(r.scanned.movements).toBe(1)
  })

  it('finds a cached balance that disagrees with the ledger, and names who wrote it', () => {
    const r = auditIntegrity(
      input({ movements: [mv({ toLocationId: 'wh', qty: 5 })], stockLevels: [{ ...level('wh__flour', 9), updatedBy: 'staff1' } as StockLevel] }),
    )
    expect(r.findings[0]).toMatchObject({ code: 'levelDrift', severity: 'critical', detail: { stored: 9, fromLedger: 5, diff: 4, lastWrittenBy: 'staff1' } })
  })

  it('ignores voided rows when adding up the ledger', () => {
    const i = input({ movements: [mv({ toLocationId: 'wh', qty: 5 }), mv({ toLocationId: 'wh', qty: 3, voided: true })], stockLevels: [level('wh__flour', 5)] })
    expect(codes(i)).toEqual([])
  })

  it('finds stock booked against an order that the order never recorded — a half-finished receipt', () => {
    const i = input({
      movements: [mv({ docNo: 'RC-7', toLocationId: 'wh', qty: 5, poId: 'po1' })],
      stockLevels: [level('wh__flour', 5)],
      purchaseOrders: [order({ lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'kg', orderedQty: 5 }] })],
    })
    expect(codes(i)).toContain('stockNotOnPo')
  })

  it('finds a receipt on the order whose stock rows were voided', () => {
    const i = input({
      movements: [mv({ docNo: 'RC-1', toLocationId: 'wh', qty: 5, poId: 'po1', voided: true })],
      purchaseOrders: [
        order({
          status: 'received',
          lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'kg', orderedQty: 5, receivedQty: 5 }],
          receipts: [{ docNo: 'RC-1', date: 0, invoiceNo: 'X', byId: 'u', byName: 'U', lines: [{ productId: 'flour', qty: 5 }] }],
        }),
      ],
    })
    expect(codes(i)).toContain('receiptVoidedButOnPo')
  })

  it('compares a receipt in the order unit with the stock row by what was keyed', () => {
    // 2 Bag keyed and filed as 50 kg, but the receipt on the order says 3 Bag.
    const i = input({
      movements: [mv({ docNo: 'RC-1', toLocationId: 'wh', qty: 50, entryUnit: 'Bag', entryQty: 2, poId: 'po1' })],
      stockLevels: [level('wh__flour', 50)],
      purchaseOrders: [
        order({
          lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'kg', entryUnit: 'Bag', orderedQty: 4, baseQty: 100, receivedQty: 3 }],
          receipts: [{ docNo: 'RC-1', date: 0, invoiceNo: 'X', byId: 'u', byName: 'U', lines: [{ productId: 'flour', qty: 3 }] }],
        }),
      ],
    })
    const f = auditIntegrity(i).findings.find((x) => x.code === 'receiptQtyVsStock')
    expect(f?.detail).toMatchObject({ onReceipt: 3, onStock: 2 })
  })

  it('finds a line total that is not the sum of its deliveries', () => {
    const i = input({
      movements: [mv({ docNo: 'RC-1', toLocationId: 'wh', qty: 2, poId: 'po1' })],
      stockLevels: [level('wh__flour', 2)],
      purchaseOrders: [
        order({
          lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'kg', orderedQty: 5, receivedQty: 4 }],
          receipts: [{ docNo: 'RC-1', date: 0, invoiceNo: 'X', byId: 'u', byName: 'U', lines: [{ productId: 'flour', qty: 2 }] }],
        }),
      ],
    })
    expect(codes(i)).toContain('lineTotalVsReceipts')
  })

  it('accepts an order received before receipt lists existed when its one stock document is there', () => {
    const i = input({
      movements: [mv({ docNo: 'RC-OLD', toLocationId: 'wh', qty: 5, poId: 'po1' })],
      stockLevels: [level('wh__flour', 5)],
      purchaseOrders: [order({ status: 'received', movementDocNo: 'RC-OLD', lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'kg', orderedQty: 5, receivedQty: 5 }] })],
    })
    expect(codes(i)).toEqual([])
  })

  it('holds the transit balance to what open transfers say is on the road', () => {
    const t = { id: 't1', docNo: 'TR-1', status: 'inTransit', fromLocationId: 'wh', toLocationId: 'br1', items: [{ productId: 'flour', inTransitQty: 3 }] } as unknown as Transfer
    const moved = mv({ type: 'issue', fromLocationId: 'wh', toLocationId: 'transit', qty: 5, transferId: 't1' })
    const r = auditIntegrity(
      input({ transfers: [t], movements: [mv({ toLocationId: 'wh', qty: 5 }), moved], stockLevels: [level('transit__flour', 5)] }),
    )
    expect(r.findings.find((f) => f.code === 'transitVsTransfers')?.detail).toMatchObject({ transitBalance: 5, openTransfers: 3 })
  })

  it('flags a closed transfer that still holds stock in transit', () => {
    const t = { id: 't1', docNo: 'TR-1', status: 'completed', items: [{ productId: 'flour', inTransitQty: 2 }] } as unknown as Transfer
    expect(codes(input({ transfers: [t] }))).toContain('closedTransferStillInTransit')
  })

  it('treats a transfer id that names no transfer as critical, once per missing transfer', () => {
    const i = input({
      movements: [
        mv({ type: 'issue', fromLocationId: 'wh', toLocationId: 'br1', transferId: 'fake' }),
        mv({ type: 'issue', fromLocationId: 'wh', toLocationId: 'br1', transferId: 'fake' }),
      ],
      stockLevels: [level('wh__flour', -2), level('br1__flour', 2)],
    })
    const f = auditIntegrity(i).findings.filter((x) => x.code === 'movementMissingTransfer')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'critical', detail: { rows: 2 } })
  })

  it('finds rows for a deleted product and a request left "approved" with its orders made', () => {
    const i = input({
      movements: [mv({ productId: 'gone', toLocationId: 'wh' })],
      stockLevels: [level('wh__gone', 1)],
      purchaseRequests: [{ id: 'pr1', status: 'approved' } as PurchaseRequest],
      purchaseOrders: [order({ requestId: 'pr1', lines: [] })],
    })
    expect(codes(i)).toEqual(expect.arrayContaining(['movementMissingProduct', 'balanceForMissingMaster', 'requestStuckWithOrders']))
  })

  it('reports conversions that cannot work and old order lines with no base quantity', () => {
    const i = input({
      products: [product('flour', { unitConversions: [{ label: 'Bag', size: 0 }] }), product('cheese', { unitConversions: [{ label: 'Box', size: 12 }] })],
      purchaseOrders: [
        order({
          lines: [
            { productId: 'cheese', productName: 'CHEESE', unit: 'kg', entryUnit: 'Box', orderedQty: 2 },
            { productId: 'cheese', productName: 'CHEESE', unit: 'kg', entryUnit: 'Crate', orderedQty: 1 },
          ],
        }),
      ],
    })
    const r = auditIntegrity(i)
    expect(r.findings.map((f) => [f.code, f.severity])).toEqual(
      expect.arrayContaining([
        ['badConversion', 'critical'],
        ['legacyLineEstimated', 'info'],
        ['legacyLineNoRate', 'warning'],
      ]),
    )
  })

  it('finds the same delivery booked twice under different document numbers', () => {
    const a = mv({ docNo: 'RC-1', toLocationId: 'wh', qty: 5, poId: 'po1', invoiceNo: 'INV9' })
    const b = mv({ docNo: 'RC-2', toLocationId: 'wh', qty: 5, poId: 'po1', invoiceNo: 'inv9 ' })
    const f = auditIntegrity(input({ movements: [a, b], stockLevels: [level('wh__flour', 10)] })).findings.find((x) => x.code === 'possibleDuplicateReceipt')
    expect(f).toMatchObject({ severity: 'critical', detail: { documents: 'RC-1, RC-2' } })
  })

  it('puts critical findings first and counts them per category', () => {
    const r = auditIntegrity(
      input({
        movements: [mv({ toLocationId: 'wh', qty: 5 })],
        stockLevels: [level('wh__flour', 6), level('wh__flour#Bag', 2)],
      }),
    )
    expect(r.findings[0].severity).toBe('critical')
    expect(r.summary.levels.critical).toBeGreaterThan(0)
    expect(r.summary.units.info).toBe(1)
  })
})

describe('integrity auditor on a backup file', () => {
  it('skips the balance comparison when the source has no cached balances, and says so', () => {
    const r = auditIntegrity({ ...input({ movements: [mv({ type: 'issue', fromLocationId: 'wh', qty: 2 })] }), stockLevels: undefined })
    expect(r.skipped).toContain('levelDrift')
    expect(r.findings.map((f) => f.code)).toEqual(['negativeLedgerBalance'])
  })
})
