// The numbers the logistics screens show — every one answerable from the documents.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { arrivalsFor, sourceFigures } from '../src/lib/transferFigures'
import type { Transfer, TransferItem, TransferStatus } from '../src/types'

const item = (over: Partial<TransferItem> = {}): TransferItem => ({ idx: 0, productId: 'coke', productName: 'COKE', sku: 'C', unit: 'EA', requestedQty: 24, dispatchQty: 24, ...over })
const tr = (id: string, status: TransferStatus, over: Partial<Transfer> = {}): Transfer => ({
  id, docNo: id, status, revision: 1, fromLocationId: 'main', toLocationId: 'sarasin', dispatchDate: 0,
  requestedBy: 'u', requestedByName: 'U', items: [item()], history: [], createdAt: 0, updatedAt: 0, ...over,
})

describe('what a source has promised and has on the road', () => {
  test('pending requests are counted as waiting, open documents by what is still in transit', () => {
    const rows = [
      tr('a', 'pendingApproval'),
      tr('b', 'pendingApproval', { items: [item({ dispatchQty: 6 }), item({ idx: 1, productId: 'other' })] }),
      tr('c', 'inTransit', { items: [item({ inTransitQty: 24 })] }),
      tr('d', 'discrepancy', { items: [item({ inTransitQty: 1.3 })] }),
      tr('e', 'completed', { items: [item({ inTransitQty: 0 })] }),
      tr('f', 'pendingApproval', { fromLocationId: 'onnut' }),
      tr('g', 'pendingApproval', { items: [item({ removed: { by: 'm', byName: 'M', at: 0, reason: 'x' } })] }),
    ]
    expect(sourceFigures(rows, 'main', 'coke', 76)).toEqual({ onHand: 76, waitingApproval: 30, onTheRoad: 25.3 })
    // The request being edited does not count against itself.
    expect(sourceFigures(rows, 'main', 'coke', 76, 'a').waitingApproval).toBe(6)
  })
})

describe('today’s deliveries', () => {
  const now = Date.UTC(2026, 8, 24, 5)
  const rows = [
    tr('coming', 'inTransit'),
    tr('opened', 'receiving'),
    tr('short', 'discrepancy'),
    tr('done', 'completed', { receivedAt: now - 3_600_000 }),
    tr('old', 'completed', { receivedAt: now - 3 * 86_400_000 }),
    tr('onnut', 'inTransit', { toLocationId: 'onnut' }),
    tr('found', 'inTransit', {
      toLocationId: 'onnut',
      items: [item({ misroutes: [{ id: 'm', qty: 2, actualCustodyLocationId: 'sarasin', originalDestinationId: 'onnut', reportedBy: 'u', reportedByName: 'U', reportedAt: 0 }] })],
    }),
  ]

  test('a branch sees what is coming to it, what it is checking, its problems, and what it received today', () => {
    const cards = arrivalsFor(rows, ['sarasin'], now)
    expect(Object.fromEntries(Object.entries(cards).map(([k, v]) => [k, v.map((t) => t.id)]))).toEqual({
      coming: ['coming'],
      receiving: ['opened'],
      problem: ['short', 'found'], // including goods of another branch's delivery found here
      received: ['done'],
    })
  })

  test('someone with no sites assigned sees every site', () => {
    expect(arrivalsFor(rows, [], now).coming.map((t) => t.id)).toEqual(['coming', 'onnut', 'found'])
  })
})
