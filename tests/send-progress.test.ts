// Multi-page PO send progress survives a reload — but only for the same order content and the
// same person (R38 review finding A: an amended PO must not resume past its revised page 1).
import { beforeEach, describe, expect, test } from 'vitest'
import { beginShareAttempt, clearPageProgress, clearShareAttempt, confirmShareAttempt, orderFingerprint, pageToResume, savePageProgress, shareToRecover } from '../src/pages/purchase/sendProgress'

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

  test('the device keeps no readable order content, only an opaque fingerprint (R40, shared devices)', () => {
    const secret = order({ note: 'deliver to back door, call Somchai', lines: [{ productId: 'flour-24kg', orderedQty: 37, unit: 'KG' }] })
    savePageProgress(scope({}, secret), 1, 1000)
    beginShareAttempt(scope({}, secret), 1, 1, 1000)
    const stored = [...store.values()].join('\n')
    for (const leak of ['back door', 'Somchai', 'flour-24kg', '"KG"']) expect(stored).not.toContain(leak)
    expect(pageToResume(scope({}, secret), 3, 2000)).toBe(1)
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
    for (const value of ['{not json', 'null', '[]', '5']) {
      store.set('pmstock:v1:send-progress', value)
      expect(pageToResume(scope(), 3)).toBe(0)
      expect(shareToRecover(scope(), 3)).toBeNull()
    }
  })

  test('an unresolved hand-off survives reload even after a day; expiry is not proof it was unsent', () => {
    expect(beginShareAttempt(scope(), 1, 4, 1000)).toBe(true)
    expect(shareToRecover(scope(), 3)).toEqual({ page: 1, version: 4, confirmed: false })
    savePageProgress(scope({ orderId: 'other' }), 1, 86_402_000)
    expect(shareToRecover(scope(), 3)).not.toBeNull()
    clearShareAttempt(scope())
    expect(shareToRecover(scope(), 3)).toBeNull()
  })

  test('confirmed delivery is distinguishable from an uncertain opened picker, and scope is isolated', () => {
    beginShareAttempt(scope(), 0, 2)
    confirmShareAttempt(scope())
    expect(shareToRecover(scope(), 1)).toEqual({ page: 0, version: 2, confirmed: true })
    for (const other of [scope({ userId: 'other' }), scope({ brand: 'lelapin' }), scope({}, order({ revision: 1 }))]) expect(shareToRecover(other, 1)).toBeNull()
    savePageProgress(scope(), 1)
    expect(shareToRecover(scope(), 3)).toBeNull()
    expect(pageToResume(scope(), 3)).toBe(1)
  })

  test('cannot journal a hand-off when storage fails', () => {
    localStorage.setItem = () => { throw new Error('no storage') }
    expect(beginShareAttempt(scope(), 0, 1)).toBe(false)
  })

  test('malformed attempt cannot claim confirmed delivery or a nonexistent page', () => {
    for (const attempt of [{ page: 3, version: 1, confirmed: true }, { page: 0, version: 1, confirmed: 'yes' }, { page: 0, version: 0, confirmed: true }]) {
      store.set('pmstock:v1:send-progress', JSON.stringify({ 'pizza:u1:po1': { page: 0, at: Date.now(), fp: scope().fingerprint, attempt } }))
      expect(shareToRecover(scope(), 2)).toBeNull()
    }
  })
})
