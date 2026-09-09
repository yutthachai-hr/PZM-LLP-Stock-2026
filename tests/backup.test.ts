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
