// The trusted stock commands (ADR-001, plan A3): the receivePO handler against an in-memory
// server store, the transaction adapter's preconditions, the write allow-list, and a golden
// comparison with the app's own client path.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryServerStore } from '../../functions/_lib/memoryStore'
import { assertCommandWrite } from '../../functions/_lib/serverStore'
import { runStockCommand, type StockDeps } from '../../functions/_lib/stockCommands'
import { STOCK_COMMANDS } from '../../src/commands/stockCommands'
import type { PurchaseOrder, StockMovement } from '../../src/types'

vi.mock('../../src/backend', async () => {
  const m = await import('../helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const mem = await import('../helpers/memory-backend')
const { receivePurchaseOrder } = await import('../../src/services/purchaseOrders')
const stock = await import('../../src/services/stock')
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
    mgr: { name: 'Manager M', role: 'manager', active: true },
    adm: { name: 'Admin A', role: 'admin', active: true },
    idle: { name: 'Pending', role: 'staff', active: false },
    gone: { name: 'Revoked', role: 'staff', active: true },
  },
  revokedUsers: { gone: { at: 1 } },
  products: { flour: product('flour'), cheese: product('cheese', { unitConversions: [{ label: 'Pack', size: 2.5 }] }) },
  locations: { wh: { name: 'Main', type: 'warehouse', active: true, createdAt: 1 }, br: { name: 'Branch', type: 'branch', active: true, createdAt: 1 } },
  purchaseOrders: { po1: order() },
  stockLevels: { wh__flour: { productId: 'flour', locationId: 'wh', qty: 3, updatedAt: 1, updatedBy: 'x' } },
  counters: { receive: { value: 7 } },
})

let ids = 0
function deps(store = memoryServerStore(world())): StockDeps & { store: ReturnType<typeof memoryServerStore> } {
  return { store, now: () => NOW, makeId: () => `id${++ids}`, verifyUser: async (h) => (h?.startsWith('Bearer ') ? h.slice(7) : null) }
}
const receiptLines = [{ productId: 'flour', receivedQty: 0, checked: true }, { productId: 'cheese', receivedQty: 0, checked: true }]
const full = (over: Record<string, unknown> = {}) => {
  const { brand = 'pizza', ...rest } = over
  return { brand, params: { orderId: 'po1', invoiceNo: 'IV-1', operationId: 'op-golden-1', date: NOW, lines: receiptLines, ...rest } }
}
const receivePOCommand = (d: StockDeps, auth: string | null, body: unknown) => runStockCommand(d, 'receivePO', auth, body)
const result = (r: { body: Record<string, unknown> }) => r.body.result as Record<string, unknown>
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
    for (const bad of [{ brand: 'other' }, { orderId: '../x' }, { invoiceNo: ' ' }, { operationId: 'x' }, { lines: [] }, { lines: [{ productId: 'flour' }] }, { date: 'today' }, { photoDataUrl: 'http://x' }, { byUserId: 'mgr' }]) {
      expect((await receivePOCommand(d, 'Bearer staff', full(bad))).status).toBe(400)
    }
    expect(d.store.writes).toBe(0)
  })
})

describe('the server works the numbers out', () => {
  test('balances, rows, counter and order — filed under the caller, whatever the body says', async () => {
    const d = deps()
    // A body naming someone else is refused outright (only known keys are taken).
    expect((await receivePOCommand(d, 'Bearer staff', full({ actor: { id: 'mgr', name: 'Someone else' } }))).status).toBe(400)
    const r = await receivePOCommand(d, 'Bearer staff', full())
    expect(r.status).toBe(200)
    expect(result(r)).toMatchObject({ docNo: 'RC-00008', status: 'received', outstandingLines: 0 })
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
    expect(result(again)).toMatchObject({ docNo: 'RC-00008', replayed: true })
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
  test('each command\'s allow-list, pinned', () => {
    const L = { stockMovements: ['set'], stockLevels: ['set'], counters: ['set'] }
    expect(Object.fromEntries(Object.entries(STOCK_COMMANDS).map(([k, v]) => [k, [v.writes, v.roles]]))).toEqual({
      receivePO: [{ ...L, movementImages: ['set'], purchaseOrders: ['update'] }, ['staff', 'manager', 'admin']],
      receiveStock: [{ ...L, movementImages: ['set'] }, ['staff', 'manager', 'admin']],
      issueStock: [L, ['staff', 'manager', 'admin']],
      consumeStock: [{ ...L, movementImages: ['set'] }, ['staff', 'manager', 'admin']],
      adjustStock: [L, ['staff', 'manager', 'admin']],
      fileCount: [L, ['admin']],
    })
  })

  test('a write outside the list is refused before anything is committed', () => {
    const w = (collection: string, op: 'set' | 'update') => ({ op, collection, id: 'x', data: {} })
    const receive = STOCK_COMMANDS.receivePO
    expect(() => assertCommandWrite('receivePO', receive.writes, [w('lelapin__stockLevels', 'set'), w('purchaseOrders', 'update')])).not.toThrow()
    for (const [c, op] of [['users', 'update'], ['purchaseOrders', 'set'], ['products', 'update'], ['transfers', 'set'], ['meta', 'set']] as const) {
      expect(() => assertCommandWrite('receivePO', receive.writes, [w(c, op)])).toThrow()
    }
  })

  test('an unknown command, or one the caller\'s role may not run, is refused', async () => {
    const d = deps()
    expect((await runStockCommand(d, 'deleteEverything', 'Bearer staff', full())).status).toBe(404)
    expect((await runStockCommand(d, 'toString', 'Bearer staff', full())).status).toBe(404)
    const count = { brand: 'pizza', params: { productId: 'flour', productName: 'FLOUR', unit: 'KG', locationId: 'wh', targetQty: 1 } }
    expect((await runStockCommand(d, 'fileCount', 'Bearer staff', count)).status).toBe(403)
    // Staff move stock between sites only through a transfer.
    const issue = { brand: 'pizza', params: { lines: [{ productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 1 }], fromLocationId: 'wh', toLocationId: 'br', date: NOW } }
    expect((await runStockCommand(d, 'issueStock', 'Bearer staff', issue)).status).toBe(403)
    expect(d.store.writes).toBe(0)
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
      await receivePurchaseOrder({ orderId: 'po1', invoiceNo: 'IV-1', lines: receiptLines, actor: { id: 'staff', name: 'Staff A' }, operationId: 'op-golden-1', date: NOW })

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

describe('golden comparison: every other command files what the app files', () => {
  const flourLine = { productId: 'flour', productName: 'FLOUR', unit: 'KG', qty: 2 }
  const packLine = { productId: 'cheese', productName: 'CHEESE', unit: 'KG', entryUnit: 'Pack', entryQty: 2, qty: 5 }
  const cases: { name: string; who: string; actor: { id: string; name: string }; params: Record<string, unknown>; client: () => Promise<unknown> }[] = [
    {
      name: 'receiveStock', who: 'staff', actor: { id: 'staff', name: 'Staff A' },
      params: { lines: [flourLine, packLine], toLocationId: 'wh', date: NOW, note: 'walk-in', doc: { supplierName: 'MARKET', invoiceNo: 'B-9' } },
      client: () => stock.receiveStock({ lines: [flourLine, packLine], toLocationId: 'wh', date: NOW, note: 'walk-in', doc: { supplierName: 'MARKET', invoiceNo: 'B-9' }, actor: { id: 'staff', name: 'Staff A' } }),
    },
    {
      name: 'consumeStock', who: 'staff', actor: { id: 'staff', name: 'Staff A' },
      params: { lines: [flourLine], fromLocationId: 'wh', date: NOW, note: 'front store' },
      client: () => stock.consumeStock({ lines: [flourLine], fromLocationId: 'wh', date: NOW, note: 'front store', actor: { id: 'staff', name: 'Staff A' } }),
    },
    {
      name: 'adjustStock', who: 'staff', actor: { id: 'staff', name: 'Staff A' },
      params: { lines: [{ ...flourLine, direction: 'out', reason: 'broken' }], locationId: 'wh', date: NOW, note: 'dropped' },
      client: () => stock.adjustStockLines({ lines: [{ ...flourLine, direction: 'out', reason: 'broken' }], locationId: 'wh', date: NOW, note: 'dropped', actor: { id: 'staff', name: 'Staff A' } }),
    },
    {
      name: 'issueStock', who: 'mgr', actor: { id: 'mgr', name: 'Manager M' },
      params: { lines: [flourLine], fromLocationId: 'wh', toLocationId: 'br', date: NOW },
      client: () => stock.issueStock({ lines: [flourLine], fromLocationId: 'wh', toLocationId: 'br', date: NOW, actor: { id: 'mgr', name: 'Manager M' } }),
    },
    {
      name: 'fileCount', who: 'adm', actor: { id: 'adm', name: 'Admin A' },
      params: { productId: 'flour', productName: 'FLOUR', unit: 'KG', locationId: 'wh', targetQty: 1, date: NOW },
      client: () => stock.setStockCount({ productId: 'flour', productName: 'FLOUR', unit: 'KG', locationId: 'wh', targetQty: 1, date: NOW, actor: { id: 'adm', name: 'Admin A' } }),
    },
  ]
  for (const c of cases) {
    test(`${c.name}: rows, balances and counters agree, both brands`, async () => {
      for (const brand of ['pizza', 'lelapin'] as const) {
        const seed = world()
        const prefixed = Object.fromEntries(Object.entries(seed).map(([k, docs]) => [['users', 'revokedUsers'].includes(k) || brand === 'pizza' ? k : `lelapin__${k}`, docs]))
        const d = deps(memoryServerStore(prefixed))
        const r = await runStockCommand(d, c.name, `Bearer ${c.who}`, { brand, params: c.params })
        expect(r.status, JSON.stringify(r.body)).toBe(200)

        mem.resetMemory()
        setActiveBrand(brand)
        for (const [k, docs] of Object.entries(prefixed)) mem.seed(k, Object.entries(docs).map(([id, v]) => ({ ...(v as object), id })))
        const clientResult = await c.client()
        expect((r.body as { result: unknown }).result).toEqual(clientResult)

        // Row ids are random on both sides; compare the rows by content, the rest by id.
        const strip = (o: Record<string, unknown>) => {
          const { createdAt: _c, updatedAt: _u, id: _i, ...rest } = o
          void [_c, _u, _i]
          return rest
        }
        const col = (k: string) => (brand === 'pizza' ? k : `lelapin__${k}`)
        const serverDocs = (k: string) => [...d.store.data].filter(([key]) => key.startsWith(`${col(k)}/`)).map(([key, v]) => [key.split('/')[1], strip(v.doc)] as const)
        const clientDocs = (k: string) => mem.raw(col(k)).map((x) => [x.id as string, strip(x)] as const)
        const sortRows = (rows: (readonly [string, Record<string, unknown>])[]) => rows.map(([, v]) => JSON.stringify(v)).sort()
        expect(sortRows(serverDocs('stockMovements')), `${brand} rows`).toEqual(sortRows(clientDocs('stockMovements')))
        for (const k of ['stockLevels', 'counters']) {
          expect(Object.fromEntries(serverDocs(k)), `${brand} ${k}`).toEqual(Object.fromEntries(clientDocs(k)))
        }
      }
    })
  }
})
