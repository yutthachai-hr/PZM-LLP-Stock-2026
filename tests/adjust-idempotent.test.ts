import { describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

import { appendAdjRow, type AdjRow } from '../src/pages/Adjust'
import type { Product } from '../src/types'

const prod = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  sku: id.toUpperCase(),
  name: `Product ${id}`,
  category: 'cat',
  unit: 'Kilogram',
  unitType: 'KG',
  minStock: 0,
  hasImage: false,
  active: true,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

describe('Adjust desktop repeated scan idempotency', () => {
  const p1 = prod('p1')
  const p2 = prod('p2')
  const defaultReason = 'damaged'

  test('repeated add of same product is idempotent and does not create twin rows', () => {
    const r1 = appendAdjRow([], p1, defaultReason)
    expect(r1).toHaveLength(1)
    expect(r1[0].productId).toBe('p1')

    // Second scan/Enter/click of p1
    const r2 = appendAdjRow(r1, p1, defaultReason)
    expect(r2).toHaveLength(1)
    expect(r2[0].productId).toBe('p1')
  })

  test('repeated add preserves existing typed value, mode, reason, note and unit', () => {
    const existingRow: AdjRow = {
      productId: 'p1',
      productName: 'Product p1',
      unit: 'KG',
      mode: 'delta',
      value: -3.5,
      reason: 'expired',
      note: 'broken seal',
    }

    const next = appendAdjRow([existingRow], p1, defaultReason)
    expect(next).toHaveLength(1)
    expect(next[0]).toEqual(existingRow)
    expect(next[0].value).toBe(-3.5)
    expect(next[0].mode).toBe('delta')
    expect(next[0].reason).toBe('expired')
    expect(next[0].note).toBe('broken seal')
    expect(next[0].unit).toBe('KG')
  })

  test('different products append distinctly while preserving earlier rows', () => {
    const r1 = appendAdjRow([], p1, defaultReason)
    const r2 = appendAdjRow(r1, p2, defaultReason)
    expect(r2).toHaveLength(2)
    expect(r2[0].productId).toBe('p1')
    expect(r2[1].productId).toBe('p2')

    // Re-scanning p1 does not change r2
    const r3 = appendAdjRow(r2, p1, defaultReason)
    expect(r3).toHaveLength(2)
    expect(r3[0].productId).toBe('p1')
    expect(r3[1].productId).toBe('p2')
  })

  test('functional updater batched behavior is idempotent and preserves row state', () => {
    const step1 = (rs: AdjRow[]) => appendAdjRow(rs, p1, defaultReason)
    const step2 = (rs: AdjRow[]) => appendAdjRow(rs, p1, defaultReason)

    // Simulate React batched functional updates
    const initial: AdjRow[] = []
    const afterBatch = step2(step1(initial))
    expect(afterBatch).toHaveLength(1)
    expect(afterBatch[0].productId).toBe('p1')
  })
})
