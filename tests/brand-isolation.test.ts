// Release hardening (8 Oct 2026, R&D brand): every collection lands in its brand's own
// namespace — the same way in the app and on the server — and stays there however often the
// brand is switched. The shared three (people, meta, revocations) are the only exceptions.
//
//   npm test
import { describe, expect, test } from 'vitest'
import { BRANDS, getBrand, resolveCollection, setActiveBrand, type BrandId } from '../src/brand/brand'
import { brandCollection } from '../functions/_lib/serverStore'
import { COL } from '../src/types'

const brands = BRANDS.map((b) => b.id) as BrandId[]
const names = Object.values(COL) as string[]
const SHARED = ['users', 'meta', 'revokedUsers']

describe('brand namespaces', () => {
  test('three brands exist: Pizza Mania, Le Lapin, R&D', () => {
    expect(brands).toEqual(['pizza', 'lelapin', 'rnd'])
  })
  test('app and server route every collection of every brand identically', () => {
    for (const b of brands) for (const n of names) expect(resolveCollection(n, b), `${b}/${n}`).toBe(brandCollection(b, n))
  })
  test('no two brands share a stock, order, product or notification collection', () => {
    for (const n of names.filter((x) => !SHARED.includes(x))) {
      const homes = brands.map((b) => resolveCollection(n, b))
      expect(new Set(homes).size, n).toBe(3)
    }
    for (const n of SHARED) expect(new Set(brands.map((b) => resolveCollection(n, b))).size, n).toBe(1)
  })
  test('switching back and forth many times always routes to the brand now active', () => {
    const order: BrandId[] = ['pizza', 'rnd', 'lelapin', 'rnd', 'pizza', 'lelapin', 'rnd', 'rnd', 'pizza']
    for (let round = 0; round < 5; round++) {
      for (const b of order) {
        setActiveBrand(b)
        expect(getBrand()).toBe(b)
        expect(resolveCollection(COL.stockLevels)).toBe(b === 'pizza' ? 'stockLevels' : `${b}__stockLevels`)
        expect(resolveCollection(COL.products)).toBe(b === 'pizza' ? 'products' : `${b}__products`)
      }
    }
    setActiveBrand('pizza')
  })
})
