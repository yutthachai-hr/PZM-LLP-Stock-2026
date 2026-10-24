import { expect, test, vi } from 'vitest'
import { experimentalRestStore } from '../../functions/_lib/experimentalStore'
import { receiveExperimental, type ExperimentalReceiptInput } from '../../src/services/experimentalReceipt'
import { decodeFields, encodeFields, type FsValue } from '../../worker/src/codec'
import { otherHash, otherIdentity } from '../../src/lib/otherItem'

const root = 'projects/demo-r31/databases/(default)/documents/'
function server(conflicts = 0) {
  const docs = new Map<string, { data: Record<string, unknown>; version: string }>()
  const put = (name: string, data: Record<string, unknown>) => docs.set(root + name, { data, version: 'v' + ++version })
  let version = 0
  put('users/admin', { name: 'Synthetic admin', role: 'admin', active: true })
  put('rnd__suppliers/other', { id: 'other', name: 'OTHER', active: true })
  put('rnd__products/parent', { id: 'parent', name: 'CHEESE-(OTHER)', category: 'Test', active: true })
  put('rnd__locations/wh', { id: 'wh', active: true })
  const requests: { suffix: string; body: Record<string, unknown> }[] = []
  let loseResponse = false
  const fetcher: typeof fetch = async (url, init) => {
    const suffix = String(url).split('/documents')[1]
    const body = JSON.parse(String(init?.body))
    requests.push({ suffix, body })
    if (suffix === ':batchGet') return Response.json(body.documents.map((name: string) => {
      const d = docs.get(name)
      return d ? { found: { name, fields: encodeFields(d.data), updateTime: d.version } } : { missing: name }
    }).reverse())
    expect(suffix).toBe(':commit')
    if (conflicts-- > 0) return Response.json({ error: { status: 'ABORTED' } }, { status: 409 })
    for (const w of body.writes) {
      const name = w.update?.name ?? w.verify
      const held = docs.get(name)
      const p = w.currentDocument
      if ((p.exists === false && held) || (p.updateTime && p.updateTime !== held?.version)) return Response.json({ error: { status: 'FAILED_PRECONDITION' } }, { status: 409 })
    }
    for (const w of body.writes) if (w.update) put(w.update.name.slice(root.length), decodeFields(w.update.fields as Record<string, FsValue>))
    if (loseResponse) { loseResponse = false; throw Error('synthetic response lost after commit') }
    return Response.json({ writeResults: [] })
  }
  const store = experimentalRestStore('demo-r31', async () => 'synthetic-not-a-credential', fetcher)
  return { store, docs, put, requests, loseNextCommit: () => { loseResponse = true } }
}
function input(n: number): ExperimentalReceiptInput {
  return { brand: 'rnd', mode: 'manual', operationId: '11111111-1111-4111-8111-111111111111', supplierId: 'other', toLocationId: 'wh', date: 1_792_000_000_000, docDate: 1_792_000_000_000, invoiceNo: 'SYNTHETIC', lines: [], experimental: Array.from({ length: n }, (_, i) => ({ draftId: 'draft-' + i, parentId: 'parent', name: 'Synthetic item ' + i, spec: '', qty: i + 1, unit: 'Pack', expectedBaseQty: i + 1 })) }
}

test('six actual command lines use four bounded batch reads and one atomic commit, independent of row order', async () => {
  const s = server()
  const r = await receiveExperimental(s.store, input(6), 'admin')
  expect(r.products).toHaveLength(6)
  expect(s.requests.map(r => r.suffix)).toEqual([':batchGet', ':batchGet', ':batchGet', ':batchGet', ':commit'])
  expect([...s.docs].filter(([k]) => k.includes('/rnd__stockMovements/'))).toHaveLength(6)
  const commit = s.requests.at(-1)!.body.writes as { verify?: string; currentDocument: object }[]
  expect(commit.find(w => w.verify?.endsWith('/users/admin'))?.currentDocument).toHaveProperty('updateTime')
  expect(commit.find(w => w.verify?.endsWith('/revokedUsers/admin'))?.currentDocument).toEqual({ exists: false })
})
test('50 worst-case distinct parents and stale claimed products still use five subrequests and fewer than500 commit operations', async () => {
  const s = server()
  const p = input(50)
  p.photoDataUrl = 'data:image/png;base64,AAAA'
  for (const [i, l] of p.experimental.entries()) {
    l.parentId = 'parent-' + i
    s.put('rnd__products/' + l.parentId, { id: l.parentId, name: 'CHEESE-(OTHER)', category: 'Test-' + i, active: true })
    const claim = await otherHash(otherIdentity(p.supplierId, l.parentId, l.name, l.spec, l.unit))
    s.put('meta/rnd_other_key_' + claim, { productId: 'stale-' + i, sku: 'OLD' })
    s.put('rnd__products/stale-' + i, { id: 'stale-' + i, name: 'ordinary restored item', active: true })
  }
  expect((await receiveExperimental(s.store, p, 'admin')).products).toHaveLength(50)
  expect(s.requests).toHaveLength(5)
  expect(s.requests.filter(r => r.suffix === ':batchGet').map(r => (r.body.documents as unknown[]).length)).toEqual([3, 104, 100, 100])
  expect((s.requests.at(-1)!.body.writes as unknown[]).length).toBe(308)
  expect([...s.docs].filter(([k]) => k.includes('/rnd__stockMovements/'))).toHaveLength(50)
})
test('50-line conflict retries are bounded to15 REST requests and commit exactly once', async () => {
  const s = server(2)
  expect((await receiveExperimental(s.store, input(50), 'admin')).products).toHaveLength(50)
  expect(s.requests).toHaveLength(15)
  expect([...s.docs].filter(([k]) => k.includes('/rnd__stockMovements/'))).toHaveLength(50)
})
test('a mixed50 receipt with explicit existing items remains batched and preserves their identities', async () => {
  const s = server()
  const first = await receiveExperimental(s.store, input(25), 'admin')
  const p = input(50)
  p.operationId = '22222222-2222-4222-8222-222222222222'
  for (let i = 0; i < 25; i++) p.experimental[i].existingProductId = first.products[i].productId
  s.requests.length = 0
  const next = await receiveExperimental(s.store, p, 'admin')
  expect(next.products.slice(0, 25).map(p => p.productId)).toEqual(first.products.map(p => p.productId))
  expect(s.requests).toHaveLength(5)
  expect([...s.docs].filter(([k]) => /\/rnd__products\/rnd_other_/.test(k))).toHaveLength(50)
})
test('25 ordinary plus25 new experimental lines share the same bounded read phases', async () => {
  const s = server()
  const p = input(25)
  p.lines = Array.from({ length: 25 }, (_, i) => {
    const id = 'ordinary-' + i
    s.put('rnd__products/' + id, { id, name: 'Ordinary ' + i, category: 'Test', unit: 'Pack', unitType: 'Pack', active: true })
    return { productId: id, productName: 'Ordinary ' + i, unit: 'Pack', qty: 2 }
  })
  expect((await receiveExperimental(s.store, p, 'admin')).products).toHaveLength(25)
  expect(s.requests).toHaveLength(5)
  expect([...s.docs].filter(([k]) => k.includes('/rnd__stockMovements/'))).toHaveLength(50)
})

test('a multi-item receipt cannot step past the SKU counter ceiling', async () => {
  const s = server()
  s.put('rnd__counters/otherSku', { value: 999_999_998 })
  await expect(receiveExperimental(s.store, input(6), 'admin')).rejects.toMatchObject({ code: 'collision' })
  expect(s.requests.some(r => r.suffix === ':commit')).toBe(false)
})

test('51 lines are refused before any database request', async () => {
  const s = server()
  await expect(receiveExperimental(s.store, input(51), 'admin')).rejects.toMatchObject({ code: 'too_large' })
  expect(s.requests).toHaveLength(0)
})

test('read-only replay makes only the authority/operation batch request and no extra stock', async () => {
  const s = server()
  const first = await receiveExperimental(s.store, input(6), 'admin')
  const before = structuredClone([...s.docs])
  s.requests.length = 0
  expect(await receiveExperimental(s.store, input(6), 'admin')).toEqual(first)
  expect(s.requests.map(r => r.suffix)).toEqual([':batchGet'])
  expect([...s.docs]).toEqual(before)
})
test('a dropped commit response is recovered only by the same operation, without duplicate records', async () => {
  const s = server()
  s.loseNextCommit()
  await expect(receiveExperimental(s.store, input(6), 'admin')).rejects.toThrow(/response lost/)
  const before = structuredClone([...s.docs])
  expect((await receiveExperimental(s.store, input(6), 'admin')).products).toHaveLength(6)
  expect([...s.docs]).toEqual(before)
})
test.each(['omitted', 'duplicate', 'unknown'] as const)('batch response %s documents fail closed, never commit', async (kind) => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(kind === 'omitted' ? [] : kind === 'duplicate' ? [{ missing: root + 'users/admin' }, { missing: root + 'users/admin' }] : [{ missing: root + 'users/other' }]))
  const s = experimentalRestStore('demo-r31', async () => 'synthetic', fetcher)
  await expect(s.transaction(async tx => {
    await tx.prefetch!([{ collection: 'users', id: 'admin' }])
    tx.set('counters', 'receive', { value: 1 })
  })).rejects.toThrow(/invalid read response/)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
test('batched reads validate the entire scope before any subrequest', async () => {
  const fetcher = vi.fn<typeof fetch>()
  const s = experimentalRestStore('demo-r31', async () => 'synthetic', fetcher)
  await expect(s.transaction(tx => tx.prefetch!([{ collection: 'users', id: 'admin' }, { collection: 'lelapin__products', id: 'p1' }]))).rejects.toThrow(/not allowed/)
  expect(fetcher).not.toHaveBeenCalled()
})
