// Plan E1: on hand, reserved, available, incoming and planned inbound — each counted once.
import { describe, expect, test } from 'vitest'
import { supplyPosition } from '../src/lib/inventoryRules/supply'
import type { PurchaseOrder, PurchaseRequest, Transfer } from '../src/types'

const product = { unitType: 'KG', unitConversions: [{ label: 'Bag', size: 25 }] } as never
const po = (status: PurchaseOrder['status'], lines: Partial<PurchaseOrder['lines'][number]>[], locationId = 'wh') =>
  ({ id: status, status, locationId, lines: lines.map((l) => ({ productId: 'flour', productName: 'F', unit: 'KG', orderedQty: 0, ...l })) }) as PurchaseOrder
const pr = (status: PurchaseRequest['status'], items: Partial<PurchaseRequest['items'][number]>[]) =>
  ({ id: 'pr', status, locationId: 'wh', items: items.map((i, idx) => ({ idx, productId: 'flour', unit: 'KG', requestedQty: 0, ...i })) }) as unknown as PurchaseRequest
const tr = (status: Transfer['status'], qty: number) => ({ id: 't', status, fromLocationId: 'wh', toLocationId: 'br', items: [{ productId: 'flour', requestedQty: qty, dispatchQty: qty }] }) as unknown as Transfer
const base = { productId: 'flour', locationId: 'wh', onHand: 40, product, orders: [], requests: [], transfers: [] }

describe('supply position', () => {
  test('placed orders are incoming; drafts and approved requests are planned, never incoming', () => {
    const p = supplyPosition({
      ...base,
      orders: [po('ordered', [{ orderedQty: 10, receivedQty: 4 }]), po('draft', [{ orderedQty: 2, entryUnit: 'Bag', baseQty: 50 }]), po('received', [{ orderedQty: 99 }]), po('ordered', [{ orderedQty: 7 }], 'br')],
      requests: [pr('approved', [{ approvedQty: 3 }, { approvedQty: 1, entryUnit: 'Bag' }, { approvedQty: 9, removed: { by: 'm', byName: 'M', at: 1, reason: 'x' } } as never]), pr('pendingApproval', [{ approvedQty: 100 }])],
    })
    expect(p).toMatchObject({ onHand: 40, incoming: 6, plannedInbound: 50 + 3 + 25, available: 40, reserved: 0 })
  })

  test('a transfer request waiting for approval is shown, not deducted; nothing approved is still on the shelf', () => {
    const p = supplyPosition({ ...base, transfers: [tr('pendingApproval', 12), tr('inTransit', 5), tr('completed', 5)] })
    expect(p).toMatchObject({ reserved: 0, available: 40, requestedOut: 12 })
  })

  test('a line in a unit with no rate is left out and flagged', () => {
    const p = supplyPosition({ ...base, requests: [pr('approved', [{ approvedQty: 2, entryUnit: 'Crate' }])] })
    expect(p).toMatchObject({ plannedInbound: 0, unknownUnits: true })
  })
})
