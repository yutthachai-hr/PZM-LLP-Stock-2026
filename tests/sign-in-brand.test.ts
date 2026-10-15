import { beforeEach, describe, expect, test, vi } from 'vitest'

// brand.ts reads the device's last brand from localStorage when it loads.
const store: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = String(v)
  },
  removeItem: (k: string) => {
    delete store[k]
  },
})
store['pmstock:v1:lastBrand'] = 'pizza'

const { clearSignInBrand, getBrand, onSignInBrandSettled, pendingSignInBrand, resolveCollection, savedBrand, setSignInBrand, startingBrand } = await import('../src/brand/brand')

describe('the brand that opens after sign-in (owner, 14 Oct 2026: Le Lapin picked, Pizza Mania opened)', () => {
  beforeEach(() => clearSignInBrand())

  test('a pick on the sign-in screen beats a LINE resume and the last brand', () => {
    expect(startingBrand('lelapin', 'rnd', 'pizza')).toBe('lelapin')
    expect(startingBrand('pizza', null, 'lelapin')).toBe('pizza')
    expect(startingBrand('rnd', null, 'pizza')).toBe('rnd')
  })

  test('without a pick: a resumed LINE send, then the last brand, then the picker', () => {
    expect(startingBrand(null, 'rnd', 'pizza')).toBe('rnd')
    expect(startingBrand(null, null, 'lelapin')).toBe('lelapin')
    expect(startingBrand(null, null, null)).toBeNull()
  })

  test('recording a pick saves nothing and points the data layer nowhere until the gate opens it', () => {
    setSignInBrand('lelapin')
    expect(pendingSignInBrand()).toBe('lelapin')
    // A sign-in that then fails leaves the device exactly as it was.
    expect(store['pmstock:v1:lastBrand']).toBe('pizza')
    expect(savedBrand()).toBe('pizza')
    expect(getBrand()).toBe('pizza')
    expect(resolveCollection('products')).toBe('products')
    clearSignInBrand()
    expect(pendingSignInBrand()).toBeNull()
  })

  test('an older failed or unmounted attempt cannot clear a newer intent', () => {
    const first = setSignInBrand('lelapin')
    const second = setSignInBrand('rnd')
    clearSignInBrand(first)
    expect(pendingSignInBrand()).toBe('rnd')
    clearSignInBrand(second)
    expect(pendingSignInBrand()).toBeNull()
  })

  test('settlement notifies once, including a login with no explicit pick', () => {
    const settled = vi.fn()
    const off = onSignInBrandSettled(settled)
    try {
      const attempt = setSignInBrand(null)
      expect(settled).not.toHaveBeenCalled()
      clearSignInBrand(attempt)
      clearSignInBrand(attempt)
      expect(settled).toHaveBeenCalledTimes(1)
    } finally { off() }
  })
})
