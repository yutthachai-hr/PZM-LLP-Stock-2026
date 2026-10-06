// The trusted stock commands (ADR-001, plan A3): the receivePO handler against an in-memory
// server store, the transaction adapter's preconditions, the write allow-list, and a golden
// comparison with the app's own client path.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryServerStore } from '../../functions/_lib/memoryStore'
import { assertCommandWrite, COMMAND_WRITES } from '../../functions/_lib/serverStore'
import { receivePOCommand, type StockDeps } from '../../functions/_lib/stockCommands'
import type { PurchaseOrder, StockMovement } from '../../src/types'

vi.mock('../../src/backend', async () => {
  const m = await import('../helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const mem = await import('../helpers/memory-backend')
const { receivePurchaseOrder } = await import('../../src/services/purchaseOrders')
const { setActiveBrand } = await import('../../src/brand/brand')

const NOW = Date.UTC(2026, 9, 6, 3)
const product = (id: string, over: Record<string, unknown> = {}) => ({ sku: id, name: id.toUpperCase(), category: 'c', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...over })
const order = (): Omit<PurchaseOrder, 'id'> => ({
  docNo: 'PO-00001', supplierId: 'sup1', supplierName: 'SUP', status: 'ordered', locationId: 'wh', orderedAt: 1,
  lines: [
    { productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10 },
    { productId: 'cheese', productName: 'CHEESE', unit: 'KG', entryUnit: 'Pack', orderedQty: 4, baseQty: 10 },
  ],
  createdBy: 'mgr', createdByName: 'Manager', createdAt: 1, updatedAt: 1,
})
const world = () => ({
  users: {
    staff: { name: 'Staff A', role: 'staff', active: true },
    idle: { name: 'Pending', role: 'staff', active: false },
    gone: { name: 'Revoked', role: 'staff', active: true },
  },
  revokedUsers: { gone: { at: 1 } },
  products: { flour: product('flour'), cheese: product('cheese', { unitConversions: [{ label: 'Pack', size: 2.5 }] }) },
  locations: { wh: { name: 'Main', type: 'warehouse', active: true, createdAt: 1 } },
  purchaseOrders: { po1: order() },
  stockLevels: { wh__flour: { productId: 'flour', locationId: 'wh', qty: 3, updatedAt: 1, updatedBy: 'x' } },
  counters: { receive: { value: 7 } },
})

let ids = 0
function deps(store = memoryServerStore(world())): StockDeps & { store: ReturnType<typeof memoryServerStore> } {
  return { store, now: () => NOW, makeId: () => `id${++ids}`, verifyUser: async (h) => (h?.startsWith('Bearer ') ? h.slice(7) : null) }
}
const full = (over: Record<string, unknown> = {}) => ({
  brand: 'pizza', orderId: 'po1', invoiceNo: 'IV-1', operationId: 'op-golden-1', date: NOW,
  lines: [{ productId: 'flour', receivedQty: 0, checked: true }, { productId: 'cheese', receivedQty: 0, checked: true }],
  ...over,
})
const doc = (d: ReturnType<typeof deps>, c: string, id: string) => d.store.data.get(`${c}/${id}`)?.doc as Record<string, unknown> | undefined

beforeEach(() => {
  ids = 0
})

describe('who may call', () => {
  test('nobody without a token; not a pending or revoked account', async () => {
    const d = deps()
    expect((await receivePOCommand(d, null, full())).status).toBe(401)
    expect((await receivePOCommand(d, 'Bearer nobody', full())).status).toBe(401)
    expect((await receivePOCommand(d, 'Bearer idle', full())).status).toBe(401)
    expect((await receivePOCommand(d, 'Bearer gone', full())).status).toBe(401)
    expect(d.store.writes).toBe(0)
  })

  test('a malformed request is refused before anything is read', async () => {
    const d = deps()
    for (const bad of [{ brand: 'other' }, { orderId: '../x' }, { invoiceNo: ' ' }, { operationId: 'x' }, { lines: [] }, { lines: [{ productId: 'flour' }] }, { date: 'today' }, { photoDataUrl: 'http://x' }]) {
      expect((await receivePOCommand(d, 'Bearer staff', full(bad))).status).toBe(400)
    }
    expect(d.store.writes).toBe(0)
  })
})

describe('the server works the numbers out', () => {
  test('balances, rows, counter and order — filed under the caller, whatever the body says', async () => {
    const d = deps()
    const r = await receivePOCommand(d, 'Bearer staff', full({ actor: { id: 'mgr', name: 'Someone else' } }))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ docNo: 'RC-00008', status: 'received', outstandingLines: 0 })
    expect(doc(d, 'stockLevels', 'wh__flour')?.qty).toBe(13)
    expect(doc(d, 'stockLevels', 'wh__cheese')?.qty).toBe(10)
    expect(doc(d, 'counters', 'receive')?.value).toBe(8)
    const row = doc(d, 'stockMovements', 'rc_po1_op-golden-1_1') as unknown as StockMovement
    expect(row).toMatchObject({ type: 'receive', qty: 10, entryUnit: 'Pack', entryQty: 4, byUserId: 'staff', byUserName: 'Staff A', poId: 'po1', invoiceNo: 'IV-1' })
    const po = doc(d, 'purchaseOrders', 'po1') as unknown as PurchaseOrder
    expect(po.status).toBe('received')
    expect(po.receipts).toHaveLength(1)
    expect(po.receivedBy).toBe('staff')
  })

  test('the same operation again is the same receipt: replayed, nothing written twice', async () => {
    const d = deps()
    await receivePOCommand(d, 'Bearer staff', full())
    const writes = d.store.writes
    const again = await receivePOCommand(d, 'Bearer staff', full())
    expect(again.body).toMatchObject({ docNo: 'RC-00008', replayed: true })
    expect(d.store.writes).toBe(writes)
    expect(doc(d, 'stockLevels', 'wh__flour')?.qty).toBe(13)
  })

  test("the app's refusals come back as their words: a received order, a draft", async () => {
    const d = deps()
    await receivePOCommand(d, 'Bearer staff', full())
    const second = await receivePOCommand(d, 'Bearer staff', full({ operationId: 'op-second-1' }))
    expect(second).toMatchObject({ status: 422, body: { error: 'app', key: 'ใบสั่งซื้อนี้รับของแล้ว' } })
    d.store.touch('purchaseOrders', 'po1', { status: 'draft', receipts: [] })
    expect((await receivePOCommand(d, 'Bearer staff', full({ operationId: 'op-third-1' }))).body).toMatchObject({ key: 'ใบสั่งซื้อนี้ยังเป็นร่าง ต้องอนุมัติก่อนรับของ' })
  })
})

describe('preconditions: what was read must not have moved', () => {
  test('another device files a delivery between read and commit: retried, and refused against the order as it now is', async () => {
    const d = deps()
    let once = true
    const commit = d.store.commit.bind(d.store)
    d.store.commit = async (writes) => {
      if (once) {
        once = false
        // Someone else's receipt lands first.
        await receivePOCommand({ ...d, store: { ...d.store, commit } }, 'Bearer staff', full({ operationId: 'op-other-1' }))
      }
      return commit(writes)
    }
    const r = await receivePOCommand(d, 'Bearer staff', full())
    expect(r).toMatchObject({ status: 422, body: { key: 'ใบสั่งซื้อนี้รับของแล้ว' } })
    expect(doc(d, 'stockLevels', 'wh__flour')?.qty).toBe(13) // once
    expect([...d.store.data.keys()].filter((k) => k.startsWith('stockMovements/'))).toHaveLength(2)
  })

  test('a product changed under the receipt (a read, not written) also forces a fresh read', async () => {
    const d = deps()
    let once = true
    const commit = d.store.commit.bind(d.store)
    d.store.commit = async (writes) => {
      expect(writes.some((w) => w.op === 'verify' && w.collection === 'products')).toBe(true)
      if (once) {
        once = false
        d.store.touch('products', 'flour', { name: 'FLOUR (renamed)' })
      }
      return commit(writes)
    }
    expect((await receivePOCommand(d, 'Bearer staff', full())).status).toBe(200)
    expect(once).toBe(false)
  })
})

describe('what the commands may write (the service account is outside the rules)', () => {
  test('receivePO: rows, balances, counters, images, and an update of the order — nothing else', () => {
    expect(COMMAND_WRITES).toEqual({
      receivePO: { stockMovements: ['set'], stockLevels: ['set'], counters: ['set'], movementImages: ['set'], purchaseOrders: ['update'] },
    })
    const w = (collection: string, op: 'set' | 'update') => ({ op, collection, id: 'x', data: {} })
    expect(() => assertCommandWrite('receivePO', [w('lelapin__stockLevels', 'set'), w('purchaseOrders', 'update')])).not.toThrow()
    for (const [c, op] of [['users', 'update'], ['purchaseOrders', 'set'], ['products', 'update'], ['transfers', 'set'], ['meta', 'set']] as const) {
      expect(() => assertCommandWrite('receivePO', [w(c, op)])).toThrow()
    }
  })
})

describe('golden comparison: the command and the app file the same receipt', () => {
  test('every row, balance, counter and order field agree, Le Lapin brand included', async () => {
    for (const brand of ['pizza', 'lelapin'] as const) {
      // Server path
      const seed = world()
      const prefixed = Object.fromEntries(
        Object.entries(seed).map(([c, docs]) => [['users', 'revokedUsers'].includes(c) || brand === 'pizza' ? c : `lelapin__${c}`, docs]),
      )
      const d = deps(memoryServerStore(prefixed))
      const r = await receivePOCommand(d, 'Bearer staff', full({ brand }))
      expect(r.status).toBe(200)

      // Client path, same world
      mem.resetMemory()
      setActiveBrand(brand)
      for (const [c, docs] of Object.entries(prefixed)) mem.seed(c, Object.entries(docs).map(([id, v]) => ({ ...(v as object), id })))
      await receivePurchaseOrder({ orderId: 'po1', invoiceNo: 'IV-1', lines: full().lines, actor: { id: 'staff', name: 'Staff A' }, operationId: 'op-golden-1', date: NOW })

      const strip = (o: Record<string, unknown> | undefined) => {
        const { createdAt: _c, updatedAt: _u, closedShortAt: _s, ...rest } = (o ?? {}) as Record<string, unknown>
        void [_c, _u, _s]
        return rest
      }
      const col = (c: string) => (brand === 'pizza' ? c : `lelapin__${c}`)
      for (const c of ['stockMovements', 'stockLevels', 'counters', 'purchaseOrders']) {
        const client = Object.fromEntries(mem.raw(col(c)).map((x) => [x.id as string, strip(x)]))
        const server = Object.fromEntries([...d.store.data].filter(([k]) => k.startsWith(`${col(c)}/`)).map(([k, v]) => [k.split('/')[1], strip(v.doc)]))
        expect(server, `${brand} ${c}`).toEqual(client)
      }
    }
  })
})
