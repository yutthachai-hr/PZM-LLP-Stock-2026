import { beforeEach, expect, test } from 'vitest'
import { experimentalRestStore } from '../../functions/_lib/experimentalStore'
import { receiveExperimental, type ExperimentalReceiptInput } from '../../src/services/experimentalReceipt'
import { decodeFields, encodeFields } from '../../worker/src/codec'

const project = 'demo-r31-r25'
const root = `projects/${project}/databases/(default)/documents`
const base = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}/v1/${root}`
const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' }
const requests: string[] = []
let loseResponse = false
let beforeCommit: (() => Promise<void>) | undefined
async function put(path: string, data: Record<string, unknown>) {
  const r = await fetch(`${base}/${path}`, { method: 'PATCH', headers, body: JSON.stringify({ fields: encodeFields(data) }) })
  expect(r.ok, `synthetic fixture ${path}: HTTP${r.status}`).toBe(true)
}
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input)
  expect(url.startsWith(`https://firestore.googleapis.com/v1/${root}`)).toBe(true)
  const suffix = url.split('/documents')[1]
  requests.push(suffix)
  if (suffix === ':commit' && beforeCommit) { const change = beforeCommit; beforeCommit = undefined; await change() }
  const r = await fetch(url.replace(`https://firestore.googleapis.com/v1/${root}`, base), { ...init, headers })
  if (suffix === ':commit' && r.ok && loseResponse) { loseResponse = false; throw Error('synthetic response lost after emulator commit') }
  return r
}
const store = () => experimentalRestStore(project, async () => 'owner', fetcher)
function input(): ExperimentalReceiptInput {
  return { brand: 'rnd', mode: 'manual', operationId: '11111111-1111-4111-8111-111111111111', supplierId: 'other', toLocationId: 'wh', date: 1_792_000_000_000, docDate: 1_792_000_000_000, invoiceNo: 'SYNTHETIC-EMU', lines: [], experimental: Array.from({ length: 50 }, (_, i) => ({ draftId: 'draft-' + i, parentId: 'parent', name: 'Synthetic item ' + i, spec: '', qty: i + 1, unit: 'Pack', expectedBaseQty: i + 1 })) }
}
async function list(collection: string) {
  const r = await fetch(`${base}/${collection}?pageSize=300`, { headers })
  expect(r.ok).toBe(true)
  const body = await r.json() as { documents?: { fields: Parameters<typeof decodeFields>[0] }[] }
  return (body.documents ?? []).map(d => decodeFields(d.fields))
}
beforeEach(async () => {
  const r = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' })
  expect(r.ok).toBe(true)
  await put('users/admin', { name: 'Synthetic admin', role: 'admin', active: true })
  await put('rnd__suppliers/other', { id: 'other', name: 'OTHER', active: true })
  await put('rnd__products/parent', { id: 'parent', name: 'CHEESE-(OTHER)', category: 'Test', active: true })
  await put('rnd__locations/wh', { id: 'wh', active: true })
  requests.length = 0
  loseResponse = false
  beforeCommit = undefined
})
test('50 lines commit atomically through real batchGet/updateTime/exists preconditions in five REST calls', async () => {
  const first = await receiveExperimental(store(), input(), 'admin')
  expect(first.products).toHaveLength(50)
  expect(requests).toEqual([':batchGet', ':batchGet', ':batchGet', ':batchGet', ':commit'])
  const movements = await list('rnd__stockMovements'), levels = await list('rnd__stockLevels')
  expect(movements).toHaveLength(50)
  expect(levels.map(l => l.qty).sort((a, b) => Number(a) - Number(b))).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
  requests.length = 0
  expect(await receiveExperimental(store(), input(), 'admin')).toEqual(first)
  expect(requests).toEqual([':batchGet'])
  expect(await list('rnd__stockMovements')).toEqual(movements)
})
test('two simultaneous50-line submissions converge without duplicate movement/counter increments', async () => {
  const [a, b] = await Promise.all([receiveExperimental(store(), input(), 'admin'), receiveExperimental(store(), input(), 'admin')])
  expect(a).toEqual(b)
  expect(await list('rnd__stockMovements')).toHaveLength(50)
  expect((await list('rnd__counters')).find(c => c.id === 'receive')?.value).toBe(1)
})
test.each(['role', 'revocation'])('a concurrent %s change defeats the atomic read precondition and refuses the retried command', async (kind) => {
  beforeCommit = () => kind === 'role'
    ? put('users/admin', { name: 'Synthetic admin', role: 'staff', active: true })
    : put('revokedUsers/admin', { id: 'admin' })
  await expect(receiveExperimental(store(), input(), 'admin')).rejects.toMatchObject({ code: 'forbidden' })
  expect(await list('rnd__stockMovements')).toHaveLength(0)
  expect(await list('rnd__stockLevels')).toHaveLength(0)
})

test('a real committed receipt with lost response replays once, not another50 movements', async () => {
  loseResponse = true
  await expect(receiveExperimental(store(), input(), 'admin')).rejects.toThrow(/response lost/)
  expect((await receiveExperimental(store(), input(), 'admin')).products).toHaveLength(50)
  expect(await list('rnd__stockMovements')).toHaveLength(50)
})
