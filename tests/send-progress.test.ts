// Multi-page PO send progress survives a reload — but only for the same order content and the
// same person (R38 review finding A: an amended PO must not resume past its revised page 1).
import { beforeEach, describe, expect, test } from 'vitest'
import { clearPageProgress, orderFingerprint, pageToResume, savePageProgress } from '../src/pages/purchase/sendProgress'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage
})

const order = (over: Record<string, unknown> = {}) => ({
  id: 'po1', revision: 0, expectedAt: 5, note: '', lines: [{ productId: 'a', orderedQty: 1, unit: 'KG' }, { productId: 'b', orderedQty: 2, unit: 'KG' }], ...over,
})
const scope = (over: Record<string, unknown> = {}, o = order()) => ({ brand: 'pizza', userId: 'u1', orderId: o.id, fingerprint: orderFingerprint(o as never), ...over })

describe('send progress', () => {
  test('resumes at the saved page for the same brand, person and order content, and clears', () => {
    savePageProgress(scope(), 1, 1000)
    expect(pageToResume(scope(), 3, 2000)).toBe(1)
    expect(pageToResume(scope({ brand: 'lelapin' }), 3, 2000)).toBe(0)
    expect(pageToResume(scope({ orderId: 'po2' }), 3, 2000)).toBe(0)
    clearPageProgress(scope())
    expect(pageToResume(scope(), 3, 2000)).toBe(0)
  })

  test('an amended order starts again at page 1', () => {
    savePageProgress(scope(), 1, 1000)
    for (const amended of [order({ revision: 1 }), order({ lines: [{ productId: 'a', orderedQty: 9, unit: 'KG' }, { productId: 'b', orderedQty: 2, unit: 'KG' }] }), order({ expectedAt: 6 }), order({ note: 'x' })]) {
      expect(pageToResume(scope({}, amended), 3, 2000)).toBe(0)
    }
  })

  test('another person on the same device starts at page 1', () => {
    savePageProgress(scope(), 1, 1000)
    expect(pageToResume(scope({ userId: 'u2' }), 3, 2000)).toBe(0)
  })

  test('status fields do not change the fingerprint', () => {
    expect(orderFingerprint(order({ shareStatus: 'shareOpened', updatedAt: 9 }) as never)).toBe(orderFingerprint(order() as never))
  })

  test('never points past the last page and expires after a day', () => {
    savePageProgress(scope(), 2, 0)
    expect(pageToResume(scope(), 2, 10)).toBe(1)
    expect(pageToResume(scope(), 1, 10)).toBe(0)
    expect(pageToResume(scope(), 3, 86_400_001)).toBe(0)
  })

  test('unreadable storage is no progress, not a crash', () => {
    store.set('pmstock:v1:send-progress', '{not json')
    expect(pageToResume(scope(), 3)).toBe(0)
  })
})
