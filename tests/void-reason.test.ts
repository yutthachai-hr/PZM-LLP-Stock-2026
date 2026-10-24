// P0 (owner, 22 Oct 2026): cancelling a stock movement needs a reason, and the reason, who and
// when are kept on the row for good. Service-level, against the in-memory backend.
//
//   npm test
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw, failWritesWhere } = await import('./helpers/memory-backend')
const { receiveStock, consumeStock, editMovement, voidMovement, findLevelDrift } = await import('../src/services/stock')
const { setActiveBrand } = await import('../src/brand/brand')
const { VOID_REASON_MAX, normaliseVoidReason, voidSummary } = await import('../src/lib/voidAudit')
const { buildActivityLog } = await import('../src/lib/activityLog')

const ADMIN = { id: 'uid-admin', name: 'Owner' }
const MAIN = 'loc-main'
const line = (qty: number) => ({ productId: 'p1', productName: 'Mozzarella', unit: 'Kilogram', qty })
const movements = () => raw('stockMovements') as Record<string, unknown>[]
const balance = () => (raw('stockLevels').find((d) => d.id === `${MAIN}__p1`)?.qty as number) ?? 0

beforeEach(async () => {
  resetMemory()
  setActiveBrand('pizza')
  seed('products', [{ id: 'p1', sku: 'A-1', name: 'Mozzarella', category: 'Cheese', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1 }])
  seed('locations', [{ id: MAIN, name: 'Main Warehouse', type: 'warehouse', active: true, createdAt: 1 }])
  await receiveStock({ lines: [line(10)], toLocationId: MAIN, date: Date.now(), actor: ADMIN })
})

const receiptId = () => movements()[0].id as string

describe('the reason is required and bounded', () => {
  test.each([
    ['empty', ''],
    ['whitespace only', ' \n\t '],
    ['over the limit', 'x'.repeat(VOID_REASON_MAX + 1)],
  ])('%s is refused before anything moves', async (_label, reason) => {
    await expect(voidMovement(receiptId(), ADMIN, reason)).rejects.toThrow()
    expect(balance()).toBe(10)
    expect(movements()[0].voided).toBeUndefined()
    expect(movements()[0].voidReason).toBeUndefined()
  })

  test('a missing reason (an old caller) is refused too', async () => {
    // @ts-expect-error the old two-argument call must no longer compile, and must fail at runtime
    await expect(voidMovement(receiptId(), ADMIN)).rejects.toThrow()
    expect(balance()).toBe(10)
  })

  test('the limit itself is accepted, and the reason is stored trimmed', async () => {
    expect(normaliseVoidReason(`  ${'y'.repeat(VOID_REASON_MAX)}  `)).toHaveLength(VOID_REASON_MAX)
    await voidMovement(receiptId(), ADMIN, '  keyed the wrong branch  ')
    expect(movements()[0].voidReason).toBe('keyed the wrong branch')
  })
})

describe('the audit trail', () => {
  test('reason, who and when are stored with the reversal, and earlier edits survive', async () => {
    await editMovement({ movementId: receiptId(), actor: ADMIN, patch: { note: 'first note' } })
    const before = Date.now()
    await voidMovement(receiptId(), ADMIN, 'duplicate of RC-00002')
    const mv = movements()[0]
    expect(mv).toMatchObject({ voided: true, voidReason: 'duplicate of RC-00002', voidedBy: ADMIN.id, voidedByName: ADMIN.name, note: 'first note' })
    expect(mv.voidedAt as number).toBeGreaterThanOrEqual(before)
    expect((mv.edits as unknown[]).length).toBe(1)
    expect(balance()).toBe(0)
    expect(await findLevelDrift()).toEqual([])
  })

  test('voiding twice (a double tap) reverses once and keeps the first reason and person', async () => {
    const id = receiptId()
    const results = await Promise.allSettled([
      voidMovement(id, ADMIN, 'first tap'),
      voidMovement(id, { id: 'uid-admin2', name: 'Second' }, 'second tap'),
    ])
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(balance()).toBe(0)
    expect(await findLevelDrift()).toEqual([])
    const mv = movements()[0]
    expect([mv.voidReason, mv.voidedBy]).toEqual(['first tap', ADMIN.id])
    await voidMovement(id, { id: 'uid-admin2', name: 'Second' }, 'later attempt')
    expect(movements()[0].voidReason).toBe('first tap')
    expect(balance()).toBe(0)
  })

  test('a reversal that would go negative is refused and records no reason', async () => {
    await consumeStock({ lines: [line(8)], fromLocationId: MAIN, date: Date.now(), actor: ADMIN })
    await expect(voidMovement(receiptId(), ADMIN, 'wrong supplier')).rejects.toThrow()
    const receipt = movements().find((m) => m.type === 'receive')!
    expect(receipt.voided).toBeUndefined()
    expect(receipt.voidReason).toBeUndefined()
    expect(balance()).toBe(2)
  })

  test('a failed write leaves neither the reversal nor the reason behind', async () => {
    failWritesWhere((c) => c.endsWith('stockMovements'))
    await expect(voidMovement(receiptId(), ADMIN, 'network drop')).rejects.toThrow()
    failWritesWhere(() => false)
    expect(balance()).toBe(10)
    expect(movements()[0].voided).toBeUndefined()
    expect(await findLevelDrift()).toEqual([])
  })
})

describe('reading it back', () => {
  const fmt = (ms: number) => `T${ms}`
  const t = (s: string, v?: Record<string, unknown>) => Object.entries(v ?? {}).reduce((out, [k, x]) => out.replace(`{${k}}`, String(x)), s)

  test('a reasoned void names reason, person and time; a legacy one says it has no reason', () => {
    expect(voidSummary({ voided: true, voidReason: 'wrong qty', voidedByName: 'Owner', voidedAt: 5 }, t, fmt)).toBe('ยกเลิกโดย Owner T5 · เหตุผล: wrong qty')
    expect(voidSummary({ voided: true, updatedByName: 'Old', updatedAt: 4 }, t, fmt)).toBe('ยกเลิกโดย Old T4 · ข้อมูลเดิม: ไม่มีเหตุผลการยกเลิก')
    expect(voidSummary({ voided: false }, t, fmt)).toBe('')
  })

  test('the activity log shows the reason, the canceller and the moment of cancelling', async () => {
    await voidMovement(receiptId(), ADMIN, 'duplicate')
    const mv = movements()[0] as never as import('../src/types').StockMovement
    const entries = buildActivityLog({
      from: 0, to: Date.now() + 1000, t, movements: [mv, { ...mv, id: 'legacy', voidReason: undefined, voidedAt: undefined, voidedBy: undefined, voidedByName: undefined, updatedByName: 'Old', updatedAt: 7 }],
      orders: [], requests: [], events: [], movementType: (x: string) => x, locationName: (x?: string) => x ?? '', fmtQty: String,
      formatDate: fmt, formatDateTime: fmt, editChange: () => '', requestAction: String, taskAction: String,
    } as never)
    const voids = entries.filter((e) => e.key.endsWith(':void'))
    expect(voids.find((e) => e.key === `mv:${mv.id}:void`)).toMatchObject({ by: 'Owner', at: mv.voidedAt, detail: 'เหตุผล: duplicate' })
    expect(voids.find((e) => e.key === 'mv:legacy:void')).toMatchObject({ by: 'Old', at: 7, detail: 'ข้อมูลเดิม: ไม่มีเหตุผลการยกเลิก' })
  })
})
