// R40-C1: a cancellation is accepted only together with its balance reversal (R38 security hold).
// The shipped voidMovement runs through the real Firestore adapter, transaction and Rules as an
// authenticated admin; the adversarial cases write directly with the same identity.
//
//   npm run test:rules
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import type { Product, StockLocation, StockMovement } from '../src/types'

const connection = vi.hoisted(() => ({ db: undefined as Firestore | undefined }))
vi.mock('../src/firebase/app', () => ({ getDb: () => {
  if (!connection.db) throw new Error('emulator identity not selected')
  return connection.db
} }))
vi.mock('../src/backend', async () => ({
  backend: (await import('../src/backend/firestore')).createFirestoreBackend(), BACKEND_MODE: 'cloud',
}))
vi.mock('../src/services/notifications', () => ({ deliver: vi.fn(async () => {}) }))

const { createFirestoreBackend } = await import('../src/backend/firestore')
const { setActiveBrand, resolveCollection } = await import('../src/brand/brand')
const S = await import('../src/services/stock')

let env: RulesTestEnvironment
const actor = { id: 'r40-admin', name: 'Synthetic admin', role: 'admin' as const }
const product: Product = { id: 'p1', sku: 'R40', name: 'Synthetic flour', category: 'c', unit: 'KG', unitType: 'KG', minStock: 0, hasImage: false, active: true, cost: 1, createdAt: 1, updatedAt: 1 }
const locations: StockLocation[] = [
  { id: 'wh', name: 'Synthetic warehouse', type: 'warehouse', active: true, createdAt: 1 },
  { id: 'branch', name: 'Synthetic branch', type: 'branch', active: true, createdAt: 2 },
]
const line = (qty: number) => ({ productId: product.id, productName: product.name, unit: 'KG', qty })
const now = () => Date.now()
const voidPatch = () => ({
  voided: true, voidReason: 'keyed twice', voidedAt: now(), voidedBy: actor.id, voidedByName: actor.name,
  updatedBy: actor.id, updatedByName: actor.name, updatedAt: now(),
})
const levelDoc = (id: string, locationId: string, qty: number, unit?: string) => ({
  id, productId: product.id, locationId, qty, updatedAt: now(), updatedBy: actor.id, ...(unit ? { unit } : {}),
})

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^127\.0\.0\.1:8080$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('local emulator only')
  env = await initializeTestEnvironment({ projectId: 'pzm-rules-test', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } })
})
afterAll(async () => { connection.db = undefined; await env?.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore()
    await setDoc(doc(f, 'meta/bootstrap'), { claimedBy: actor.id, at: 1 })
    await setDoc(doc(f, 'users', actor.id), { name: actor.name, role: 'admin', active: true })
    for (const brand of ['pizza', 'lelapin'] as const) {
      await setDoc(doc(f, resolveCollection('products', brand), product.id), product)
      for (const loc of locations) await setDoc(doc(f, resolveCollection('locations', brand), loc.id), loc)
    }
  })
  connection.db = env.authenticatedContext(actor.id).firestore({ ignoreUndefinedProperties: true })
})

const db = () => createFirestoreBackend()
const movements = async () => db().getAll<StockMovement>('stockMovements')
const qty = async (id: string) => (await db().getOne<{ qty: number }>('stockLevels', id))?.qty
const decision = (p: Promise<unknown>) => p.then(() => 'ALLOW', (e) => { if (e?.code === 'permission-denied') return 'DENY'; throw e })

describe.each(['pizza', 'lelapin'] as const)('%s', (brand) => {
  beforeEach(() => setActiveBrand(brand))
  const mvCol = () => resolveCollection('stockMovements', brand)
  const lvCol = () => resolveCollection('stockLevels', brand)

  test('the shipped voidMovement cancels a receipt and its balance together', async () => {
    await S.receiveStock({ lines: [line(5)], toLocationId: 'wh', date: now(), actor })
    const [mv] = await movements()
    await S.voidMovement(mv.id, actor, 'keyed twice')
    expect((await movements())[0]).toMatchObject({ voided: true, voidReason: 'keyed twice' })
    expect(await qty('wh__p1')).toBe(0)
  })

  test('the shipped voidMovement reverses both legs of a direct move', async () => {
    await S.receiveStock({ lines: [line(5)], toLocationId: 'wh', date: now(), actor })
    await S.issueStock({ lines: [line(2)], fromLocationId: 'wh', toLocationId: 'branch', date: now(), actor })
    const move = (await movements()).find((m) => m.type === 'issue')!
    await S.voidMovement(move.id, actor, 'wrong branch')
    expect([await qty('wh__p1'), await qty('branch__p1')]).toEqual([5, 0])
  })

  test('the shipped voidMovement finds a legacy row on its own unit balance', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const f = ctx.firestore()
      await setDoc(doc(f, mvCol(), 'old'), { id: 'old', docNo: 'RC-00009', type: 'receive', productId: 'p1', productName: 'Synthetic flour', unit: 'KG', entryUnit: 'Pack', qty: 3, toLocationId: 'wh', date: 1, byUserId: actor.id, byUserName: actor.name, createdAt: 1 })
      await setDoc(doc(f, lvCol(), 'wh__p1#Pack'), levelDoc('wh__p1#Pack', 'wh', 3, 'Pack'))
    })
    await S.voidMovement('old', actor, 'legacy duplicate')
    expect(await qty('wh__p1#Pack')).toBe(0)
  })

  describe('direct writes as the same admin', () => {
    beforeEach(async () => { await S.receiveStock({ lines: [line(5)], toLocationId: 'wh', date: now(), actor }) })
    const write = async (levels: Array<[string, Record<string, unknown>]>) => {
      const [mv] = await movements()
      const b = writeBatch(connection.db!)
      b.update(doc(connection.db!, mvCol(), mv.id), voidPatch())
      for (const [id, data] of levels) b.set(doc(connection.db!, lvCol(), id), data)
      return decision(b.commit())
    }

    test('SECURITY: cancelling with no balance change is denied', async () => {
      expect(await write([])).toBe('DENY')
      expect(await qty('wh__p1')).toBe(5)
    })

    test('SECURITY: cancelling with a reversal of the wrong size is denied', async () => {
      expect(await write([['wh__p1', levelDoc('wh__p1', 'wh', 1)]])).toBe('DENY')
    })

    test('SECURITY: cancelling while reversing a different balance is denied', async () => {
      expect(await write([['branch__p1', levelDoc('branch__p1', 'branch', 0)]])).toBe('DENY')
      const ledger = await getDoc(doc(connection.db!, mvCol(), (await movements())[0].id))
      expect(ledger.data()?.voided ?? false).toBe(false)
    })

    test('the exact reversal is what the database accepts', async () => {
      expect(await write([['wh__p1', levelDoc('wh__p1', 'wh', 0)]])).toBe('ALLOW')
    })

    // R57 security review: with the exact reversal present, each of these is denied for its own reason only.
    const writeWith = async (patch: Record<string, unknown>) => {
      const [mv] = await movements()
      const b = writeBatch(connection.db!)
      b.update(doc(connection.db!, mvCol(), mv.id), { ...voidPatch(), ...patch })
      b.set(doc(connection.db!, lvCol(), 'wh__p1'), levelDoc('wh__p1', 'wh', 0))
      return decision(b.commit())
    }

    test('SECURITY: a blank reason is denied even with the reversal', async () => {
      expect(await writeWith({ voidReason: '   ' })).toBe('DENY')
    })

    test('SECURITY: a cancellation filed under another admin is denied even with the reversal', async () => {
      expect(await writeWith({ voidedBy: 'someone-else' })).toBe('DENY')
    })

    test('SECURITY: a backdated cancellation is denied', async () => {
      expect(await writeWith({ voidedAt: now() - 24 * 3600_000 })).toBe('DENY')
    })

    test('SECURITY: a cancellation naming a colleague is denied', async () => {
      expect(await writeWith({ voidedByName: 'A colleague' })).toBe('DENY')
    })

    test('a phone clock a few minutes off is still accepted', async () => {
      expect(await writeWith({ voidedAt: now() - 3 * 60_000 })).toBe('ALLOW')
    })
  })

  test('SECURITY: a manager cannot cancel, even with the exact reversal', async () => {
    await S.receiveStock({ lines: [line(5)], toLocationId: 'wh', date: now(), actor })
    const [mv] = await movements()
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'r57-manager'), { name: 'Synthetic manager', role: 'manager', active: true })
    })
    const mgr = env.authenticatedContext('r57-manager').firestore({ ignoreUndefinedProperties: true })
    const b = writeBatch(mgr)
    b.update(doc(mgr, mvCol(), mv.id), { ...voidPatch(), voidedBy: 'r57-manager', voidedByName: 'Synthetic manager', updatedBy: 'r57-manager', updatedByName: 'Synthetic manager' })
    b.set(doc(mgr, lvCol(), 'wh__p1'), levelDoc('wh__p1', 'wh', 0))
    expect(await decision(b.commit())).toBe('DENY')
  })

  test('a movement whose unit was stored with a stray space can still be cancelled honestly', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const f = ctx.firestore()
      await setDoc(doc(f, mvCol(), 'spaced'), { id: 'spaced', docNo: 'RC-00010', type: 'receive', productId: 'p1', productName: 'Synthetic flour', unit: 'KG ', qty: 3, toLocationId: 'wh', date: 1, byUserId: actor.id, byUserName: actor.name, createdAt: 1 })
      await setDoc(doc(f, lvCol(), 'wh__p1'), levelDoc('wh__p1', 'wh', 3))
    })
    await S.voidMovement('spaced', actor, 'keyed twice')
    expect(await qty('wh__p1')).toBe(0)
  })

  test('SECURITY: a direct move cancelled with only one leg reversed is denied', async () => {
    await S.receiveStock({ lines: [line(5)], toLocationId: 'wh', date: now(), actor })
    await S.issueStock({ lines: [line(2)], fromLocationId: 'wh', toLocationId: 'branch', date: now(), actor })
    const move = (await movements()).find((m) => m.type === 'issue')!
    const b = writeBatch(connection.db!)
    b.update(doc(connection.db!, mvCol(), move.id), voidPatch())
    b.set(doc(connection.db!, lvCol(), 'branch__p1'), levelDoc('branch__p1', 'branch', 0))
    expect(await decision(b.commit())).toBe('DENY')
  })
})
