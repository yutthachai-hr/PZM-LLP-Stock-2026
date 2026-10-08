// Smart "Other" item (R&D, 8 Oct 2026): proposing a new product from a request, on the server.
// One product per item key, codes never duplicated (also under concurrency), R&D only, and
// nothing but the product, its claim and the counter is written — never stock.
//
//   npm test
import { describe, expect, test } from 'vitest'
import { memoryServerStore } from '../../functions/_lib/memoryStore'
import { runStockCommand, type StockDeps } from '../../functions/_lib/stockCommands'

const NOW = Date.UTC(2026, 9, 8, 9)
const world = () => ({
  users: {
    staff: { name: 'Staff A', role: 'staff', active: true },
    mgr: { name: 'Manager M', role: 'manager', active: true },
    gone: { name: 'Revoked', role: 'staff', active: true },
  },
  revokedUsers: { gone: { at: 1 } },
  rnd__products: {
    'vgt-other': { sku: 'VGT-02-20-001', name: 'VEGETABLE-(OTHER)', category: 'Vegetable', unit: '', unitType: '', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
  },
  products: {
    'pz-other': { sku: 'X', name: 'OTHER', category: 'Dry', unit: '', unitType: '', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 },
  },
})
let ids = 0
const deps = (store = memoryServerStore(world())): StockDeps & { store: ReturnType<typeof memoryServerStore> } => ({ store, now: () => NOW, makeId: () => `id${++ids}`, verifyUser: async (h) => (h?.startsWith('Bearer ') ? h.slice(7) : null) })
const propose = (d: StockDeps, who: string, params: Record<string, unknown>, brand = 'rnd') => runStockCommand(d, 'proposeItem', `Bearer ${who}`, { brand, params: { placeholderId: 'vgt-other', unit: 'KG', ...params } })
const doc = (d: ReturnType<typeof deps>, c: string, id: string) => d.store.data.get(`${c}/${id}`)?.doc as Record<string, unknown> | undefined
const keysOf = (d: ReturnType<typeof deps>) => [...d.store.data.keys()]

describe('proposeItem', () => {
  test('staff create a new R&D item: RND-000001, pending review, in the placeholder\'s category, filed under the caller', async () => {
    const d = deps()
    const r = await propose(d, 'staff', { name: '  Sumac   Powder ', spec: '500 g bag' })
    expect(r.status).toBe(200)
    expect(r.body.result).toEqual({ productId: 'rnd_other_000001', sku: 'RND-000001', created: true })
    expect(doc(d, 'rnd__products', 'rnd_other_000001')).toMatchObject({
      sku: 'RND-000001', name: 'Sumac Powder', spec: '500 g bag', category: 'Vegetable', unit: 'KG', unitType: 'KG',
      review: 'pending', proposedBy: 'staff', proposedByName: 'Staff A', active: true, version: 1,
    })
    expect(doc(d, 'rnd__counters', 'otherSku')).toMatchObject({ value: 1 })
    // Never stock, never another brand.
    expect(keysOf(d).filter((k) => /stock(Movements|Levels)|^products\//.test(k) && !k.startsWith('products/pz-other'))).toEqual([])
  })

  test('the same item again (case, spacing) is the same product; no new code is taken', async () => {
    const d = deps()
    await propose(d, 'staff', { name: 'Sumac Powder', spec: '500 G BAG' })
    const again = await propose(d, 'mgr', { name: 'sumac  powder', spec: '500 g bag', unit: 'kg' })
    expect(again.body.result).toEqual({ productId: 'rnd_other_000001', sku: 'RND-000001', created: false })
    expect(doc(d, 'rnd__counters', 'otherSku')).toMatchObject({ value: 1 })
  })

  test('the same name with another spec is a different item with the next code (never auto-linked)', async () => {
    const d = deps()
    await propose(d, 'staff', { name: 'Sumac Powder', spec: '500 g bag' })
    const other = await propose(d, 'staff', { name: 'Sumac Powder', spec: '1 kg bag' })
    expect(other.body.result).toEqual({ productId: 'rnd_other_000002', sku: 'RND-000002', created: true })
  })

  test('concurrent sessions: the same item at once → one product; different items at once → distinct codes', async () => {
    const d = deps()
    const same = await Promise.all([1, 2, 3, 4].map(() => propose(d, 'staff', { name: 'Black Garlic', spec: 'whole' })))
    const ids = new Set(same.map((r) => (r.body.result as { productId: string }).productId))
    expect(same.every((r) => r.status === 200)).toBe(true)
    expect(ids.size).toBe(1)
    const diff = await Promise.all(['Yuzu juice', 'Bonito flakes', 'Kombu', 'Mirin'].map((name) => propose(d, 'staff', { name })))
    const skus = diff.map((r) => (r.body.result as { sku: string }).sku)
    expect(new Set(skus).size).toBe(4)
    expect(skus.every((s) => /^RND-00000[2-5]$/.test(s))).toBe(true)
    expect(doc(d, 'rnd__counters', 'otherSku')).toMatchObject({ value: 5 })
  })

  test('R&D only: Pizza Mania and Le Lapin are refused before anything is read', async () => {
    const d = deps()
    for (const brand of ['pizza', 'lelapin']) expect((await propose(d, 'staff', { name: 'Sumac', placeholderId: 'pz-other' }, brand)).status).toBe(403)
    expect(d.store.writes).toBe(0)
  })

  test('refused: a revoked account, no token, a missing placeholder, an empty name or unit', async () => {
    const d = deps()
    expect((await propose(d, 'gone', { name: 'Sumac' })).status).toBe(401) // revoked: no valid caller
    expect((await propose(d, 'staff', { name: 'Sumac', proposedBy: 'someone-else' })).status).toBe(400) // who proposed is never the caller's to say
    expect((await runStockCommand(d, 'proposeItem', null, { brand: 'rnd', params: { name: 'x', unit: 'KG', placeholderId: 'vgt-other' } })).status).toBe(401)
    expect((await propose(d, 'staff', { name: 'Sumac', placeholderId: 'nope' })).status).toBe(422)
    expect((await propose(d, 'staff', { name: ' ' })).status).toBe(400)
    expect((await propose(d, 'staff', { name: 'Sumac', unit: '' })).status).toBe(400)
    expect((await propose(d, 'staff', { name: 'Sumac', sku: 'MY-OWN-CODE' })).status).toBe(400) // the code is never the caller's
    expect(d.store.writes).toBe(0)
  })
})
