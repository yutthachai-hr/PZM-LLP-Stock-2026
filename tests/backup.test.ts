// Regression tests for the backup/restore findings in AUDIT_FOR_CLAUDE.md
// (F29, F30, F31, F32) plus F54, which the audit did not catch.
//
//   npm test
//
// This file is the only recovery path the project has: the free Firestore plan has no
// point-in-time recovery and no scheduled backups. So the bar is not "usually works" —
// it is "either restores correctly or refuses before touching anything".

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw } = await import('./helpers/memory-backend')
const {
  buildBackup,
  backupSize,
  parseBackup,
  restoreBackup,
  BackupFormatError,
  RESTORE_MODES,
} = await import('../src/services/backup')
const { receiveStock, findLevelDrift } = await import('../src/services/stock')
const { setActiveBrand } = await import('../src/brand/brand')

const ACTOR = { id: 'uid-staff', name: 'Staff' }
const MAIN = 'loc-main'

function seedMasterData() {
  seed('products', [
    { id: 'p1', sku: 'A-1', name: 'Mozzarella', category: 'Cheese', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
  ])
  seed('locations', [
    { id: MAIN, name: 'Main Warehouse', type: 'warehouse', active: true, createdAt: 1 },
  ])
  seed('users', [
    { id: 'uid-staff', name: 'Staff', email: 's@x.com', role: 'staff', active: true, createdAt: 1, localPassword: 'hunter2' },
  ])
  seed('meta', [{ id: 'bootstrap', claimedBy: 'uid-admin', at: 1 }])
}

function receive(qty: number) {
  return receiveStock({
    lines: [{ productId: 'p1', productName: 'Mozzarella', unit: 'Kilogram', qty }],
    toLocationId: MAIN,
    date: Date.now(),
    actor: ACTOR,
  })
}

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
  seedMasterData()
})

describe('F54 — a backup you can actually sign in to afterwards', () => {
  test('the roster and the provisioning marker are included', async () => {
    const b = await buildBackup('Owner')
    expect(b.data.users).toHaveLength(1)
    expect(b.data.meta).toHaveLength(1)
  })

  test('meta is read document by document, never listed', async () => {
    // The rules allow `get` on meta/bootstrap and meta/entryUnits and no `list` at all, so
    // a backup that listed the collection died with "insufficient permissions" in
    // production. Reading the two known documents is what the rules permit; anything
    // else under meta is unreadable by design and stays out of the file.
    seed('meta', [
      { id: 'bootstrap', claimedBy: 'uid-admin', at: 1 },
      { id: 'entryUnits', units: ['Lot', 'Pack'] },
      { id: 'something-else', x: 1 },
    ])
    const b = await buildBackup('Owner')
    expect(b.data.meta.map((d) => d.id).sort()).toEqual(['bootstrap', 'entryUnits'])
  })

  test('local passwords are not written into a file people email around', async () => {
    const b = await buildBackup('Owner')
    expect(JSON.stringify(b)).not.toContain('hunter2')
    expect(b.data.users[0]).not.toHaveProperty('localPassword')
  })

  test('the roster is put back, but the provisioning marker is left to the console', async () => {
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    resetMemory()
    const r = await restoreBackup(file, RESTORE_MODES.repair)
    expect(raw('users')).toHaveLength(1)
    // No client may write meta/bootstrap — that is what stops whoever arrives first at an
    // unprovisioned database from claiming it. Restoring skips it and says so.
    expect(raw('meta')).toHaveLength(0)
    expect(r.skipped).toBe(1)
  })
})

describe('F32 — a file is checked before anything is written', () => {
  const base = () => ({
    format: 'pzm-stock-backup',
    version: 2,
    brand: 'pizza',
    brandName: 'Pizza Mania',
    createdAt: Date.now(),
    createdBy: 'Owner',
    counts: { products: 1 },
    data: { products: [{ id: 'p1', name: 'x' }] },
  })

  test('something that is not a backup is refused', () => {
    expect(() => parseBackup('not json at all')).toThrow(BackupFormatError)
    expect(() => parseBackup('{"hello":true}')).toThrow(BackupFormatError)
  })

  test('a version from the future is refused', () => {
    expect(() => parseBackup(JSON.stringify({ ...base(), version: 99 }))).toThrow(BackupFormatError)
  })

  test('a collection that is not a list is refused', () => {
    const f = base()
    ;(f.data as Record<string, unknown>).products = { p1: { id: 'p1' } }
    expect(() => parseBackup(JSON.stringify(f))).toThrow(BackupFormatError)
  })

  test('a collection the app does not have is refused', () => {
    const f = base()
    ;(f.data as Record<string, unknown>).somethingElse = [{ id: 'x' }]
    expect(() => parseBackup(JSON.stringify(f))).toThrow(BackupFormatError)
  })

  test('a document with no usable id is refused', () => {
    for (const id of [undefined, '', 42, '../escape', 'a/b', '__proto__']) {
      const f = base()
      f.data.products = [{ id } as never]
      expect(() => parseBackup(JSON.stringify(f))).toThrow(BackupFormatError)
    }
  })

  test('two documents sharing an id are refused', () => {
    const f = base()
    f.data.products = [{ id: 'p1', name: 'a' }, { id: 'p1', name: 'b' }]
    expect(() => parseBackup(JSON.stringify(f))).toThrow(BackupFormatError)
  })

  test('a number JSON turns into Infinity is refused', () => {
    // 1e999 parses to Infinity, which reaches the database and makes every total NaN.
    const text = '{"format":"pzm-stock-backup","version":2,"brand":"pizza","brandName":"P","createdAt":1,"createdBy":"o","counts":{},"data":{"stockLevels":[{"id":"a","qty":1e999}]}}'
    expect(() => parseBackup(text)).toThrow(BackupFormatError)
  })

  test('counts that disagree with the contents are refused', () => {
    const f = base()
    f.counts = { products: 9 }
    expect(() => parseBackup(JSON.stringify(f))).toThrow(BackupFormatError)
  })

  test('a file with no counts at all can still be sized without blowing up', () => {
    const f = base() as Record<string, unknown>
    delete f.counts
    const parsed = parseBackup(JSON.stringify(f))
    expect(() => backupSize(parsed)).not.toThrow()
    expect(backupSize(parsed)).toBe(1)
  })
})

describe('F29 — what restoring actually means', () => {
  test('a movement recorded after the backup survives, and the balance counts it', async () => {
    await receive(5)
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))

    await receive(7) // recorded after the backup was taken
    expect(await findLevelDrift()).toEqual([])

    const r = await restoreBackup(file, RESTORE_MODES.repair)

    // The ledger only grows: 5 + 7 = 12, not the 5 the file remembers.
    expect(raw('stockMovements')).toHaveLength(2)
    const level = raw('stockLevels')[0] as Record<string, unknown>
    expect(level.qty).toBe(12)
    // Nothing was missing, so nothing was written — but the balances were still rebuilt,
    // which is what keeps the newer receipt counted.
    expect(r.written).toBe(0)
    expect(r.kept).toBeGreaterThan(0)
    expect(r.rebuilt).toBeGreaterThan(0)
    expect(await findLevelDrift()).toEqual([])
  })

  test('the document counter is never sent backwards', async () => {
    await receive(5)
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    await receive(7)
    await receive(9)

    await restoreBackup(file, RESTORE_MODES.repair)

    const counter = raw('counters').find((c) => c.id === 'receive') as Record<string, unknown>
    // Three receipts exist, so the next document number must be RC-00004.
    expect(counter.value).toBe(3)
  })

  test('deleted master data comes back', async () => {
    await receive(5)
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))

    resetMemory() // the disaster this whole feature exists for
    await restoreBackup(file, RESTORE_MODES.repair)

    expect(raw('products')).toHaveLength(1)
    expect(raw('locations')).toHaveLength(1)
    expect(raw('stockMovements')).toHaveLength(1)
    expect((raw('stockLevels')[0] as Record<string, unknown>).qty).toBe(5)
    expect(await findLevelDrift()).toEqual([])
  })

  test('repair mode leaves a product edited since the backup alone', async () => {
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    seed('products', [
      { id: 'p1', sku: 'A-1', name: 'Mozzarella RENAMED', category: 'Cheese', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 2 },
    ])
    await restoreBackup(file, RESTORE_MODES.repair)
    expect((raw('products')[0] as Record<string, unknown>).name).toBe('Mozzarella RENAMED')
  })

  test('overwrite mode puts the backed-up master data back', async () => {
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    seed('products', [
      { id: 'p1', sku: 'A-1', name: 'Mozzarella RENAMED', category: 'Cheese', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 2 },
    ])
    await restoreBackup(file, RESTORE_MODES.overwrite)
    expect((raw('products')[0] as Record<string, unknown>).name).toBe('Mozzarella')
  })
})

describe('F30 — a restore that stops halfway', () => {
  test('running it again finishes the job rather than doubling it', async () => {
    await receive(5)
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    resetMemory()

    await restoreBackup(file, RESTORE_MODES.repair)
    await restoreBackup(file, RESTORE_MODES.repair)

    expect(raw('stockMovements')).toHaveLength(1)
    expect(raw('products')).toHaveLength(1)
    expect((raw('stockLevels')[0] as Record<string, unknown>).qty).toBe(5)
    expect(await findLevelDrift()).toEqual([])
  })
})

describe('F31 — the file says whether its parts agree', () => {
  test('a backup taken while nothing is happening reports itself consistent', async () => {
    await receive(5)
    const b = await buildBackup('Owner')
    expect(b.integrity.consistent).toBe(true)
    expect(b.integrity.drift).toBe(0)
  })

  test('a backup taken over drifted balances says so', async () => {
    await receive(5)
    seed('stockLevels', [
      { id: `${MAIN}__p1`, productId: 'p1', locationId: MAIN, qty: 999, updatedAt: 1, updatedBy: 'someone' },
    ])
    const b = await buildBackup('Owner')
    expect(b.integrity.drift).toBe(1)
  })

  test('restoring rebuilds the balances from the ledger, so a stale one does not carry over', async () => {
    await receive(5)
    seed('stockLevels', [
      { id: `${MAIN}__p1`, productId: 'p1', locationId: MAIN, qty: 999, updatedAt: 1, updatedBy: 'someone' },
    ])
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    resetMemory()
    await restoreBackup(file, RESTORE_MODES.repair)
    expect((raw('stockLevels')[0] as Record<string, unknown>).qty).toBe(5)
  })
})

describe('policy — a backup belongs to the brand it came from', () => {
  test('restoring another brand’s file is refused outright', async () => {
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    setActiveBrand('lelapin')
    // Two companies, two sets of books. Merging them is not a thing anyone can undo:
    // movements cannot be deleted, so the mixed ledger would be permanent.
    await expect(restoreBackup(file, RESTORE_MODES.repair)).rejects.toThrow()
    expect(raw('lelapin__products')).toHaveLength(0)
    expect(raw('lelapin__stockMovements')).toHaveLength(0)
  })

  test('restoring into the brand it came from still works', async () => {
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    await expect(restoreBackup(file, RESTORE_MODES.repair)).resolves.toBeTruthy()
  })
})

// Four collections arrived after this file was written — suppliers, what they sell us, the
// calendar, and purchase orders — and none of them was in the backup. A restore after a
// mistaken delete would have brought the stock back and lost every order ever placed and
// every supplier it was placed with. Per-unit balances arrived in the same period, and the
// rebuild only knew the product's own unit: a 10 Pack balance was zeroed by the restore
// that was meant to save it.
describe('what arrived after the backup was written', () => {
  const supplier = { id: 's1', name: 'OLIVA', contactNumber: '', email: '', type: 'takingReturn', active: true, createdAt: 1, updatedAt: 1 }
  const item = { id: 'si1', supplierId: 's1', productId: 'p1', buyingPrice: 120, active: true, createdAt: 1, updatedAt: 1 }
  const event = { id: 'e1', title: 'นับสต๊อก', type: 'stockCount', startAt: 1, status: 'upcoming', priority: 'normal', createdBy: 'uid-admin', createdAt: 1, updatedAt: 1 }
  const order = (id: string, docNo: string) => ({
    id, docNo, supplierId: 's1', supplierName: 'OLIVA', status: 'ordered', locationId: MAIN,
    orderedAt: 1, lines: [{ productId: 'p1', productName: 'Mozzarella', unit: 'KG', orderedQty: 3 }],
    createdBy: 'uid-staff', createdByName: 'Staff', createdAt: 1, updatedAt: 1,
  })

  test('suppliers, their items, the calendar and purchase orders are in the file', async () => {
    seed('suppliers', [supplier])
    seed('supplierItems', [item])
    seed('stockEvents', [event])
    seed('purchaseOrders', [order('o1', 'PO-00001')])
    const b = await buildBackup('Owner')
    expect(b.data.suppliers).toHaveLength(1)
    expect(b.data.supplierItems).toHaveLength(1)
    expect(b.data.stockEvents).toHaveLength(1)
    expect(b.data.purchaseOrders).toHaveLength(1)
  })

  test('they come back on restore, and an order already there is never overwritten', async () => {
    seed('suppliers', [supplier])
    seed('supplierItems', [item])
    seed('stockEvents', [event])
    seed('purchaseOrders', [order('o1', 'PO-00001')])
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    resetMemory()
    seedMasterData()
    // An order received since the backup: the file's copy says "ordered", the database says
    // "received". Orders are evidence of receipts the same way movements are, so the newer
    // one stays even in overwrite mode.
    seed('purchaseOrders', [{ ...order('o1', 'PO-00001'), status: 'received', invoiceNo: 'IV-1' }])
    await restoreBackup(file, RESTORE_MODES.overwrite)
    expect(raw('suppliers')).toHaveLength(1)
    expect(raw('supplierItems')).toHaveLength(1)
    expect(raw('stockEvents')).toHaveLength(1)
    expect((raw('purchaseOrders')[0] as { status: string }).status).toBe('received')
  })

  test('imported order lists and confirmed spellings travel with the file, and a batch is never overwritten', async () => {
    seed('productAliases', [{ id: 'alias-1', key: 'X', productId: 'p1', sourceName: 'X ', createdBy: 'u', createdByName: 'U', createdAt: 1 }])
    seed('purchaseBatches', [{ id: 'pb1', batchNo: 'PB-20260914-001', locationId: MAIN, sourceFileName: 'f', fileHash: 'h', sheetName: 's', blockLabel: 'x', status: 'ready', rows: [], groups: [], history: [], createdBy: 'u', createdByName: 'U', createdAt: 1, updatedAt: 1 }])
    const b = await buildBackup('Owner')
    expect(b.version).toBe(5)
    expect(b.data.productAliases).toHaveLength(1)
    expect(b.data.purchaseBatches).toHaveLength(1)

    resetMemory()
    seed('purchaseBatches', [{ ...(b.data.purchaseBatches[0] as object), status: 'completed' }])
    await restoreBackup(parseBackup(JSON.stringify(b)), RESTORE_MODES.overwrite)
    expect(raw('productAliases')).toHaveLength(1)
    expect((raw('purchaseBatches')[0] as { status: string }).status).toBe('completed')
  })

  test('a file from before these collections existed still restores', async () => {
    const b = await buildBackup('Owner')
    const old = { ...b, version: 2, data: Object.fromEntries(Object.entries(b.data).filter(([k]) => !['suppliers', 'supplierItems', 'stockEvents', 'purchaseOrders'].includes(k))), counts: {} }
    const file = parseBackup(JSON.stringify(old))
    await expect(restoreBackup(file, RESTORE_MODES.repair)).resolves.toBeTruthy()
  })

  test('a balance kept in a unit other than the product\'s own survives a restore', async () => {
    await receiveStock({
      lines: [{ productId: 'p1', productName: 'Mozzarella', unit: 'KG', entryUnit: 'Pack', qty: 10 }],
      toLocationId: MAIN,
      date: Date.now(),
      actor: ACTOR,
    })
    await receive(2)
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    expect(file.integrity.drift).toBe(0)
    resetMemory()
    seedMasterData()
    await restoreBackup(file, RESTORE_MODES.repair)
    const levels = raw('stockLevels') as { id: string; qty: number; unit?: string }[]
    expect(levels.find((l) => l.id === `${MAIN}__p1#Pack`)).toMatchObject({ qty: 10, unit: 'Pack' })
    expect(levels.find((l) => l.id === `${MAIN}__p1`)?.qty).toBe(2)
  })

  test('each supplier\'s order counter is rebuilt, so the next order is not numbered twice', async () => {
    seed('suppliers', [supplier])
    seed('purchaseOrders', [order('o1', 'PO-00001'), order('o2', 'PO-00002')])
    const file = parseBackup(JSON.stringify(await buildBackup('Owner')))
    resetMemory()
    seedMasterData()
    await restoreBackup(file, RESTORE_MODES.repair)
    const counter = raw('counters').find((c) => c.id === 'purchaseOrder__s1') as { value: number } | undefined
    expect(counter?.value).toBe(2)
  })
})
