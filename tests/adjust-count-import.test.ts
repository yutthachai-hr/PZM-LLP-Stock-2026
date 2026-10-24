import { describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

import {
  displayedSystemQty,
  isMoved,
  mergeAdjustImportRow,
  type AdjRow,
} from '../src/pages/Adjust'

describe('Adjust CSV re-import row baseline preservation (R59 / Reviewer Gemini P2)', () => {
  const product = { id: 'p1', name: 'Bacon', unitType: 'KG' }
  const defaultReason = 'count'

  test('preserves existing count row seen on re-import and retains moved warning', () => {
    // Row was initially keyed against system=10, level=10
    const existing: AdjRow = {
      productId: 'p1',
      productName: 'Bacon',
      unit: 'KG',
      mode: 'count',
      value: 12,
      reason: defaultReason,
      seen: { system: 10, level: 10 },
    }

    // Meanwhile system/level moved to 14
    const seenNow = { system: 14, level: 14 }
    expect(isMoved(existing, 14, 14)).toBe(true)

    // Re-import file with new count value 13
    const merged = mergeAdjustImportRow(existing, { product, qty: 13 }, seenNow, defaultReason)

    // Count value is updated to 13
    expect(merged.value).toBe(13)
    // The baseline MUST NOT be overwritten by seenNow; it must preserve the original locked seen!
    expect(merged.seen).toEqual({ system: 10, level: 10 })
    // Because baseline 10 != current 14, moved warning MUST still be active
    expect(isMoved(merged, 14, 14)).toBe(true)
  })

  test('preserves legacy count row with undefined seen on re-import, requiring confirm', () => {
    // Legacy count row from draft storage before PR33: seen is undefined
    const existing: AdjRow = {
      productId: 'p1',
      productName: 'Bacon',
      unit: 'KG',
      mode: 'count',
      value: 12,
      reason: defaultReason,
      seen: undefined,
    }

    const seenNow = { system: 10, level: 10 }
    expect(isMoved(existing, 10, 10)).toBe(true)

    // Re-import file
    const merged = mergeAdjustImportRow(existing, { product, qty: 15 }, seenNow, defaultReason)

    // Legacy row MUST NOT silently acquire seenNow to bypass confirmation
    expect(merged.seen).toBeUndefined()
    expect(isMoved(merged, 10, 10)).toBe(true)
  })

  test('does not preserve seen when switching a delta row into a new count row', () => {
    // Existing row was a delta row (e.g. +2 KG waste)
    const existing: AdjRow = {
      productId: 'p1',
      productName: 'Bacon',
      unit: 'KG',
      mode: 'delta',
      value: 2,
      reason: 'waste',
      seen: undefined,
    }

    // Now imported as a count row against current system=10, level=10
    const seenNow = { system: 10, level: 10 }
    const merged = mergeAdjustImportRow(existing, { product, qty: 15 }, seenNow, defaultReason)

    expect(merged.mode).toBe('count')
    expect(merged.value).toBe(15)
    // Entering count mode for the first time locks baseline at re-import time (seenNow)
    expect(merged.seen).toEqual({ system: 10, level: 10 })
    expect(isMoved(merged, 10, 10)).toBe(false)
  })

  test('the first imported count on an empty row captures the current baseline', () => {
    const empty: AdjRow = { productId: 'p1', productName: 'Bacon', unit: 'KG', mode: 'count', value: null, reason: 'count' }
    const merged = mergeAdjustImportRow(empty, { product, qty: 8 }, { system: 10, level: 10 }, defaultReason)
    expect(merged.seen).toEqual({ system: 10, level: 10 })
    expect(isMoved(merged, 10, 10)).toBe(false)
  })

  test('initializes seen with seenNow for a newly imported product', () => {
    const seenNow = { system: 10, level: 10 }
    const merged = mergeAdjustImportRow(undefined, { product, qty: 8 }, seenNow, defaultReason)

    expect(merged.mode).toBe('count')
    expect(merged.value).toBe(8)
    expect(merged.seen).toEqual({ system: 10, level: 10 })
    expect(isMoved(merged, 10, 10)).toBe(false)
  })

  test('displayedSystemQty aligns count mode with seen baseline, live otherwise', () => {
    // Count mode with locked seen returns seen.system
    expect(displayedSystemQty({ mode: 'count', seen: { system: 10, level: 10 } }, 15)).toBe(10)
    // Count mode with legacy undefined seen falls back to live
    expect(displayedSystemQty({ mode: 'count', seen: undefined }, 15)).toBe(15)
    // Delta mode always returns live system
    expect(displayedSystemQty({ mode: 'delta', seen: { system: 10, level: 10 } }, 15)).toBe(15)
  })
})
