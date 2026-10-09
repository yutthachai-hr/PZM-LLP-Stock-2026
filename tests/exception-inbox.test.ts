// Plan C3: the Exception Inbox — what waits on a manager, worst first.
import { describe, expect, test } from 'vitest'
import { inboxItems, type InboxInput } from '../src/lib/exceptionInbox'
import { DAY_MS } from '../src/lib/inventoryRules/time'
import type { MonthlyCount, PurchaseOrder, PurchaseRequest, Transfer } from '../src/types'

const NOW = Date.UTC(2026, 9, 6, 3)
const order = (over: Partial<PurchaseOrder>): PurchaseOrder =>
  ({
    id: 'po', docNo: 'PO-1', supplierId: 's', supplierName: 'SUP', status: 'ordered', locationId: 'wh', orderedAt: NOW - DAY_MS,
    expectedAt: NOW + 2 * DAY_MS, lines: [{ productId: 'p', productName: 'P', unit: 'KG', orderedQty: 10 }],
    createdBy: 'u', createdByName: 'Staff', createdAt: NOW - DAY_MS, updatedAt: 1, ...over,
  }) as PurchaseOrder
const transfer = (over: Partial<Transfer>): Transfer =>
  ({
    id: 't', docNo: 'TR-1', status: 'pendingApproval', revision: 1, fromLocationId: 'wh', toLocationId: 'br', dispatchDate: NOW,
    requestedBy: 'u', requestedByName: 'Staff', items: [], history: [], createdAt: NOW - DAY_MS, updatedAt: NOW - DAY_MS, ...over,
  }) as Transfer
const input = (over: Partial<InboxInput>): InboxInput => ({ now: NOW, orders: [], requests: [], transfers: [], counts: [], locationName: (id) => id ?? '', ...over })
const kinds = (over: Partial<InboxInput>) => inboxItems(input(over)).map((i) => i.kind)

describe('the exception inbox', () => {
  test('lists every kind of open decision, and nothing that is settled', () => {
    expect(
      kinds({
        orders: [order({ id: 'd', status: 'draft' }), order({ id: 'ok' }), order({ id: 'r', status: 'received' })],
        requests: [{ id: 'pr', docNo: 'PR-1', status: 'pendingApproval', requestedByName: 'S', locationId: 'wh', items: [], createdAt: NOW } as unknown as PurchaseRequest],
        transfers: [transfer({}), transfer({ id: 'x', status: 'discrepancy' }), transfer({ id: 'c', status: 'completed' })],
        counts: [{ id: 'wh__2026-09', locationId: 'wh', month: '2026-09', status: 'recorded', lines: { p: { qty: 1 } }, updatedAt: NOW } as unknown as MonthlyCount],
      }).sort(),
    ).toEqual(['countToPost', 'poDraft', 'prApproval', 'transferApproval', 'transferDiscrepancy'])
  })

  test('worst first: critical, then high, then medium; older first within a level', () => {
    const items = inboxItems(
      input({
        orders: [order({ id: 'd1', status: 'draft', createdAt: NOW - 2 * DAY_MS }), order({ id: 'd2', status: 'draft', createdAt: NOW - 5 * DAY_MS })],
        transfers: [transfer({ id: 'stuck', status: 'inTransit', approvedAt: NOW - 6 * DAY_MS }), transfer({ id: 'x', status: 'discrepancy', receivedAt: NOW - DAY_MS })],
      }),
    )
    expect(items.map((i) => [i.id, i.severity])).toEqual([
      ['transferStuck__stuck', 'critical'],
      ['transferDiscrepancy__x', 'high'],
      ['poDraft__d2', 'medium'],
      ['poDraft__d1', 'medium'],
    ])
  })

  test('late and part-received orders, and a date waiting for approval', () => {
    const late = order({ id: 'late', expectedAt: NOW - 4 * DAY_MS })
    const partial = order({ id: 'part', lines: [{ productId: 'p', productName: 'P', unit: 'KG', orderedQty: 10, receivedQty: 3 }], receipts: [{ docNo: 'RC', date: NOW - 9 * DAY_MS, invoiceNo: 'I', byId: 'u', byName: 'U', lines: [] }] })
    const date = order({ id: 'date', pendingDeliveryDate: { date: NOW + 9 * DAY_MS, at: NOW - DAY_MS, changeId: 'c' } })
    const items = inboxItems(input({ orders: [late, partial, date] }))
    expect(items.find((i) => i.id === 'poDelayed__late')?.severity).toBe('critical')
    expect(items.find((i) => i.id === 'poPartial__part')?.params.n).toBe(1)
    expect(items.find((i) => i.id === 'poDatePending__date')?.group).toBe('approve')
  })
})
