// The dashboard's daily suggestions (Master Automation Plan, Phase 1 — owner, 25 Sep 2026):
// what the warehouse should buy as one request, and what each branch should be sent.
//
//   npm test
//
// Built from the same reorder insights the calendar shows one by one, so the numbers here
// are the calendar's numbers, grouped.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Product, PurchaseRequest, StockLocation, Supplier, Transfer } from '../src/types'
import type { ReorderInsight } from '../src/lib/inventoryRules/insights'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const { dailySuggestions, tickedByDefault, TRANSFER_LEAD_DAYS } = await import('../src/lib/inventoryRules/suggestions')
const S = await import('../src/services/purchaseRequests')
const { setActiveBrand } = await import('../src/brand/brand')

const loc = (id: string, type: StockLocation['type']): StockLocation => ({ id, name: id, type, active: true, createdAt: 0 })
const WH = loc('wh', 'warehouse')
const SARASIN = loc('sarasin', 'branch')
const ONNUT = loc('onnut', 'branch')
const TRANSIT = loc('transit', 'transit')
const locations = [WH, SARASIN, ONNUT, TRANSIT]

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, sku: id.toUpperCase(), name: id, category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0,
  hasImage: false, active: true, createdAt: 0, updatedAt: 0, supplierId: 's1', ...over,
})
const S1: Supplier = { id: 's1', name: 'ACK', contactNumber: '', email: '', type: 'takingReturn', active: true, createdAt: 0, updatedAt: 0 }
const S2: Supplier = { ...S1, id: 's2', name: 'BETAGRO' }

const reorder = (p: Product, at: StockLocation, over: Partial<ReorderInsight> = {}): ReorderInsight => ({
  product: p, location: at, onHand: 1, incoming: 0, avgDaily: 2, daysLeft: 0.5, recommendedQty: 10,
  basis: 'usage', leadTimeDays: 2, supplier: S1, inProgress: null, ...over,
})

const stock: Record<string, number> = {}
const qtyAt = (l: string, p: string) => stock[`${l}:${p}`] ?? 0
const minFor = () => 2

beforeEach(() => {
  for (const k of Object.keys(stock)) delete stock[k]
})

describe('the warehouse: one request, the calendar numbers', () => {
  test('warehouse reorders become lines, grouped by supplier; branch rows never do', () => {
    const cheese = product('cheese')
    const flour = product('flour', { supplierId: 's2' })
    const out = dailySuggestions({
      reorders: [reorder(flour, WH, { supplier: S2, recommendedQty: 7 }), reorder(cheese, WH), reorder(cheese, SARASIN)],
      locations, qtyAt, minFor, coverDays: 7, openTransfers: [],
    })
    expect(out.purchase).toHaveLength(1)
    expect(out.purchase[0].lines.map((l) => [l.product.id, l.qty, l.supplierName])).toEqual([
      ['cheese', 10, 'ACK'],
      ['flour', 7, 'BETAGRO'],
    ])
  })

  test('a line already on an open request or order is shown, not ticked', () => {
    const cheese = product('cheese')
    const out = dailySuggestions({
      reorders: [reorder(cheese, WH, { inProgress: { kind: 'pr', id: 'pr1', docNo: 'PR-00004', status: 'draft', qty: 5 } })],
      locations, qtyAt, minFor, coverDays: 7, openTransfers: [],
    })
    const line = out.purchase[0].lines[0]
    expect(line.inProgress).toEqual({ kind: 'pr', id: 'pr1', docNo: 'PR-00004' })
    expect(tickedByDefault(line)).toBe(false)
  })
})

describe('the branches: sent from the warehouse', () => {
  test('sized on a one-day wait for the warehouse, not the supplier lead time', () => {
    const cheese = product('cheese')
    stock['wh:cheese'] = 100
    // 2 a day, 1 on hand, min 2, cover 7: (1 + 7) × 2 + 2 − 1 = 17
    const out = dailySuggestions({
      reorders: [reorder(cheese, SARASIN, { leadTimeDays: 5, recommendedQty: 99 })],
      locations, qtyAt, minFor, coverDays: 7, openTransfers: [],
    })
    expect(TRANSFER_LEAD_DAYS).toBe(1)
    expect(out.transfers).toHaveLength(1)
    expect(out.transfers[0]).toMatchObject({ from: WH, to: SARASIN })
    expect(out.transfers[0].lines[0]).toMatchObject({ qty: 17 })
    expect(tickedByDefault(out.transfers[0].lines[0])).toBe(true)
  })

  test('never more than the warehouse holds, shared out branch by branch', () => {
    const cheese = product('cheese')
    stock['wh:cheese'] = 20
    const out = dailySuggestions({
      reorders: [reorder(cheese, SARASIN), reorder(cheese, ONNUT)],
      locations, qtyAt, minFor, coverDays: 7, openTransfers: [],
    })
    const [first, second] = out.transfers.map((t) => t.lines[0])
    expect(first).toMatchObject({ qty: 17 })
    expect(second).toMatchObject({ qty: 3, limitedTo: 3 })
  })

  test('none at the warehouse: shown as 0, not ticked', () => {
    const cheese = product('cheese')
    const out = dailySuggestions({ reorders: [reorder(cheese, SARASIN)], locations, qtyAt, minFor, coverDays: 7, openTransfers: [] })
    const line = out.transfers[0].lines[0]
    expect(line).toMatchObject({ qty: 0, limitedTo: 0 })
    expect(tickedByDefault(line)).toBe(false)
  })

  test('a product already on an open transfer to that branch is shown as in progress; a finished one is not', () => {
    const cheese = product('cheese')
    stock['wh:cheese'] = 100
    const tr = (status: Transfer['status']) => ({
      id: 't1', docNo: 'TR-00009', status, toLocationId: 'sarasin', fromLocationId: 'wh',
      items: [{ idx: 0, productId: 'cheese', productName: 'cheese', sku: 'C', unit: 'KG', requestedQty: 5, dispatchQty: 5 }],
    }) as unknown as Transfer
    const open = dailySuggestions({ reorders: [reorder(cheese, SARASIN)], locations, qtyAt, minFor, coverDays: 7, openTransfers: [tr('draft')] })
    expect(open.transfers[0].lines[0].inProgress).toEqual({ kind: 'transfer', id: 't1', docNo: 'TR-00009' })
    const done = dailySuggestions({ reorders: [reorder(cheese, SARASIN)], locations, qtyAt, minFor, coverDays: 7, openTransfers: [tr('completed')] })
    expect(done.transfers[0].lines[0].inProgress).toBeNull()
  })

  test('stock a draft transfer already claims is not offered to another branch', () => {
    const cheese = product('cheese')
    stock['wh:cheese'] = 20
    const draft = {
      id: 't1', docNo: 'TR-00001', status: 'draft', toLocationId: 'sarasin', fromLocationId: 'wh',
      items: [{ idx: 0, productId: 'cheese', productName: 'cheese', sku: 'C', unit: 'KG', requestedQty: 17, dispatchQty: 17 }],
    } as unknown as Transfer
    const out = dailySuggestions({ reorders: [reorder(cheese, SARASIN), reorder(cheese, ONNUT)], locations, qtyAt, minFor, coverDays: 7, openTransfers: [draft] })
    const [sarasin, onnut] = out.transfers.map((t) => t.lines[0])
    expect(sarasin.inProgress?.docNo).toBe('TR-00001')
    expect(sarasin.limitedTo).toBeUndefined()
    expect(onnut).toMatchObject({ qty: 3, limitedTo: 3 })
  })

  test('a branch that no longer needs it at a one-day wait gets no line', () => {
    const cheese = product('cheese')
    stock['wh:cheese'] = 100
    // 20 on hand at 2 a day covers far more than one day plus the minimum.
    const out = dailySuggestions({ reorders: [reorder(cheese, SARASIN, { onHand: 20 })], locations, qtyAt, minFor, coverDays: 7, openTransfers: [] })
    expect(out.transfers).toHaveLength(0)
  })
})

describe('drafting the request in one write', () => {
  const MAIN = 'wh'
  const ACTOR = { id: 'u-mgr', name: 'Manager', role: 'manager' as const }
  const products = [product('cheese'), product('flour', { supplierId: 's2' })]

  beforeEach(() => {
    resetMemory()
    setActiveBrand('pizza')
    seed('products', products as unknown as Record<string, unknown>[])
    seed('locations', [WH] as unknown as Record<string, unknown>[])
  })

  test('every ticked line lands on the draft, with the history of keying them one by one', async () => {
    const pr = await S.createRequest({ locationId: MAIN, actor: ACTOR })
    const next = await S.addItems({
      id: pr.id,
      lines: [
        { productId: 'cheese', supplierId: 's1', qty: 10 },
        { productId: 'flour', supplierId: 's2', qty: 7 },
      ],
      products, suppliers: [S1, S2], actor: ACTOR,
    })
    expect(next.items.map((i) => [i.productId, i.requestedQty, i.supplierName])).toEqual([
      ['cheese', 10, 'ACK'],
      ['flour', 7, 'BETAGRO'],
    ])
    expect(next.history.filter((h) => h.action === 'itemAdded')).toHaveLength(2)
    expect((raw('purchaseRequests') as unknown as PurchaseRequest[])[0].items).toHaveLength(2)
    await expect(S.addItems({ id: pr.id, lines: [], products, suppliers: [S1, S2], actor: ACTOR })).rejects.toThrow()
  })
})
