// R33 trusted stock command against a real Firestore (emulator), through the REST adapter the
// Pages Function would use. Synthetic data only.
//   firebase emulators:exec --only firestore --project demo-r33-stock "vitest run --config vitest.rules.config.ts tests/functions/r33-stock-command.emulator.test.ts"
import { beforeEach, expect, test } from 'vitest'
import { handleStockCommand, runStockCommand, type StockCommandDeps } from '../../functions/_lib/stockCommand'
import { stockCommandStore, type StockBrand } from '../../functions/_lib/stockCommandStore'
import { decodeFields, encodeFields } from '../../worker/src/codec'

const project = 'demo-r33-stock'
const root = `projects/${project}/databases/(default)/documents`
const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const base = `http://${host}/v1/${root}`
const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' }
const DATE = 1_792_000_000_000
let loseResponse = false
let beforeCommit: (() => Promise<void>) | undefined
let commits = 0

async function put(path: string, data: Record<string, unknown>) {
  const r = await fetch(`${base}/${path}`, { method: 'PATCH', headers, body: JSON.stringify({ fields: encodeFields(data) }) })
  expect(r.ok, `fixture ${path}: HTTP${r.status}`).toBe(true)
}
async function list(collection: string) {
  const r = await fetch(`${base}/${collection}?pageSize=300`, { headers })
  expect(r.ok).toBe(true)
  const body = (await r.json()) as { documents?: { fields: Parameters<typeof decodeFields>[0] }[] }
  return (body.documents ?? []).map((d) => decodeFields(d.fields))
}
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input)
  expect(url.startsWith(`https://firestore.googleapis.com/v1/${root}`)).toBe(true)
  const suffix = url.split('/documents')[1]
  if (suffix === ':commit') {
    commits++
    if (beforeCommit) {
      const change = beforeCommit
      beforeCommit = undefined
      await change()
    }
  }
  const r = await fetch(url.replace(`https://firestore.googleapis.com/v1/${root}`, base), { ...init, headers })
  if (suffix === ':commit' && r.ok && loseResponse) {
    loseResponse = false
    throw Error('synthetic response lost after commit')
  }
  return r
}
const deps = (allowed: StockBrand[] = ['pizza', 'lelapin']): Pick<StockCommandDeps, 'store' | 'brandAllowed' | 'now'> => ({
  store: (brand) => stockCommandStore(project, brand, async () => 'owner', fetcher),
  brandAllowed: (_user, brand) => allowed.includes(brand),
  now: () => DATE,
})
let seq = 0
const opId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
const adjust = (over: Record<string, unknown> = {}, brand: StockBrand = 'pizza') => ({
  command: 'adjust',
  brand,
  operationId: opId(),
  payload: { locationId: 'wh', date: DATE, lines: [{ productId: 'p1', productName: 'Flour', unit: 'kg', qty: 3, direction: 'in', reason: 'found' }] },
  ...over,
})
const count = (countedQty: number, expectedQty: number) => ({
  command: 'count',
  brand: 'pizza',
  operationId: opId(),
  payload: { locationId: 'wh', date: DATE, lines: [{ productId: 'p1', productName: 'Flour', unit: 'kg', countedQty, expectedQty }] },
})
const levelOf = async (col = 'stockLevels') => (await list(col)).find((l) => l.productId === 'p1')?.qty

beforeEach(async () => {
  const r = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' })
  expect(r.ok).toBe(true)
  await put('users/u1', { name: 'Staff One', role: 'staff', active: true })
  await put('users/u2', { name: 'Staff Two', role: 'staff', active: true })
  for (const prefix of ['', 'lelapin__']) {
    await put(`${prefix}products/p1`, { id: 'p1', name: 'Flour', unit: 'kg', active: true })
    await put(`${prefix}locations/wh`, { id: 'wh', name: 'WH', active: true })
    await put(`${prefix}stockLevels/wh__p1`, { id: 'wh__p1', productId: 'p1', locationId: 'wh', qty: 10, updatedAt: DATE, updatedBy: 'seed' })
  }
  loseResponse = false
  beforeCommit = undefined
  commits = 0
})

test('adjust files one movement, balance, counter and ledger revision atomically, signed by the live user record', async () => {
  const r = await runStockCommand(deps(), adjust(), 'u1')
  expect(r).toEqual({ docNo: 'ADJ-00001', ledgerRev: 1, replayed: false })
  const [mv] = await list('stockMovements')
  expect(mv).toMatchObject({ type: 'adjust', qty: 3, toLocationId: 'wh', byUserId: 'u1', byUserName: 'Staff One', docNo: 'ADJ-00001' })
  expect(await levelOf()).toBe(13)
  expect((await list('stockLevels'))[0].updatedBy).toBe('u1')
  expect((await list('counters')).find((c) => c.id === 'adjust')?.value).toBe(1)
  expect((await list('meta')).find((m) => m.id === 'stockLedger_pizza')?.value).toBe(1)
})

test.each([
  ['an actor in the body', { actor: { id: 'boss', name: 'Boss' } }],
  ['a client ledger revision', { ledgerRev: 99 }],
])('S1/S5 forged fields: %s is refused before any database call', async (_label, extra) => {
  await expect(runStockCommand(deps(), adjust(extra), 'u1')).rejects.toMatchObject({ code: 'invalid' })
  const line = { productId: 'p1', productName: 'Flour', unit: 'kg', qty: 3, direction: 'in', reason: 'found', byUserId: 'boss' }
  await expect(runStockCommand(deps(), adjust({ payload: { locationId: 'wh', date: DATE, lines: [line] } }), 'u1')).rejects.toMatchObject({ code: 'invalid' })
  expect(commits).toBe(0)
  expect(await list('stockMovements')).toHaveLength(0)
})

test('replay with the same operation returns the first result; the same ID with other content conflicts', async () => {
  const cmd = adjust()
  const first = await runStockCommand(deps(), cmd, 'u1')
  expect(await runStockCommand(deps(), cmd, 'u1')).toEqual({ ...first, replayed: true })
  const changed = { ...cmd, payload: { ...cmd.payload, lines: [{ ...cmd.payload.lines[0], qty: 4 }] } }
  await expect(runStockCommand(deps(), changed, 'u1')).rejects.toMatchObject({ code: 'operation_conflict' })
  expect(await list('stockMovements')).toHaveLength(1)
  expect(await levelOf()).toBe(13)
})

test('a lost response after commit is recovered by the same operation ID, not filed twice', async () => {
  const cmd = adjust()
  loseResponse = true
  await expect(runStockCommand(deps(), cmd, 'u1')).rejects.toThrow(/response lost/)
  expect(await runStockCommand(deps(), cmd, 'u1')).toMatchObject({ docNo: 'ADJ-00001', replayed: true })
  expect(await list('stockMovements')).toHaveLength(1)
})

test('two people counting the same shelf from the same screen: one count lands, the other is stale, never an overwrite', async () => {
  const results = await Promise.allSettled([runStockCommand(deps(), count(7, 10), 'u1'), runStockCommand(deps(), count(12, 10), 'u2')])
  const ok = results.filter((r) => r.status === 'fulfilled')
  const stale = results.filter((r) => r.status === 'rejected')
  expect(ok).toHaveLength(1)
  expect(stale).toHaveLength(1)
  expect((stale[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'stale' })
  const level = await levelOf()
  expect([7, 12]).toContain(level)
  expect(await list('stockMovements')).toHaveLength(1)
})

test('a count whose expected balance has moved is refused with the current figure and writes nothing', async () => {
  await runStockCommand(deps(), adjust(), 'u1') // 10 -> 13
  await expect(runStockCommand(deps(), count(5, 10), 'u2')).rejects.toMatchObject({ code: 'stale', detail: [{ productId: 'p1', expectedQty: 10, currentQty: 13 }] })
  expect(await levelOf()).toBe(13)
  expect(await list('stockMovements')).toHaveLength(1)
})

test('a count equal to the balance writes no movement and keeps the ledger revision', async () => {
  expect(await runStockCommand(deps(), count(10, 10), 'u1')).toEqual({ docNo: null, ledgerRev: 0, replayed: false })
  expect(await list('stockMovements')).toHaveLength(0)
})

test('cross-brand: a brand outside the policy is forbidden; an allowed brand writes only its own namespace', async () => {
  await expect(runStockCommand(deps(['pizza']), adjust({}, 'lelapin'), 'u1')).rejects.toMatchObject({ code: 'forbidden' })
  expect(await list('lelapin__stockMovements')).toHaveLength(0)
  await runStockCommand(deps(), adjust({}, 'lelapin'), 'u1')
  expect(await list('lelapin__stockMovements')).toHaveLength(1)
  expect(await list('stockMovements')).toHaveLength(0)
  expect(await levelOf()).toBe(10)
  expect((await list('meta')).map((m) => m.id)).toContain('stockLedger_lelapin')
})

test.each(['inactive', 'revoked'])('a user made %s between read and commit is refused on retry, nothing written', async (kind) => {
  beforeCommit = () => (kind === 'inactive' ? put('users/u1', { name: 'Staff One', role: 'staff', active: false }) : put('revokedUsers/u1', { id: 'u1' }))
  await expect(runStockCommand(deps(), adjust(), 'u1')).rejects.toMatchObject({ code: 'forbidden' })
  expect(await list('stockMovements')).toHaveLength(0)
  expect(await levelOf()).toBe(10)
})

test('a product retired between read and commit fails the commit and the retry refuses it', async () => {
  beforeCommit = () => put('products/p1', { id: 'p1', name: 'Flour', unit: 'kg', active: false })
  await expect(runStockCommand(deps(), adjust(), 'u1')).rejects.toThrow(/ถูกปิดใช้งาน/)
  expect(await list('stockMovements')).toHaveLength(0)
})

test('taking out more than the balance is refused whole', async () => {
  const out = { productId: 'p1', productName: 'Flour', unit: 'kg', qty: 11, direction: 'out', reason: 'lost' }
  await expect(runStockCommand(deps(), adjust({ payload: { locationId: 'wh', date: DATE, lines: [out] } }), 'u1')).rejects.toThrow(/สต๊อกไม่พอ/)
  expect(await list('stockMovements')).toHaveLength(0)
})

test('counter/revision integrity: three concurrent adjusts give three distinct docNos and ledger revision 3', async () => {
  const rs = await Promise.all([1, 2, 3].map(() => runStockCommand(deps(), adjust(), 'u1')))
  expect(new Set(rs.map((r) => r.docNo)).size).toBe(3)
  expect(rs.map((r) => r.ledgerRev).sort()).toEqual([1, 2, 3])
  expect((await list('counters')).find((c) => c.id === 'adjust')?.value).toBe(3)
  expect((await list('meta')).find((m) => m.id === 'stockLedger_pizza')?.value).toBe(3)
  expect(await levelOf()).toBe(19)
})

test('the endpoint is off by default, needs a verified user, and bounds the body', async () => {
  const handlerDeps: StockCommandDeps = { ...deps(), enabled: false, verifyUser: async (h) => (h === 'Bearer good' ? 'u1' : null) }
  const req = (body: string, auth = 'Bearer good') => new Request('https://x/api/stock-command', { method: 'POST', headers: { authorization: auth }, body })
  expect((await handleStockCommand(req(JSON.stringify(adjust())), handlerDeps)).status).toBe(503)
  const on = { ...handlerDeps, enabled: true }
  expect((await handleStockCommand(req(JSON.stringify(adjust()), 'Bearer bad'), on)).status).toBe(401)
  expect((await handleStockCommand(req('x'.repeat(200_001)), on)).status).toBe(413)
  expect((await handleStockCommand(req('{'), on)).status).toBe(400)
  const res = await handleStockCommand(req(JSON.stringify(adjust())), on)
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ docNo: 'ADJ-00001', ledgerRev: 1 })
})
