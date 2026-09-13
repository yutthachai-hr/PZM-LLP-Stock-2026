// Suppliers, and the one thing the screen they came from got wrong.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const {
  addSupplierItem,
  createSupplier,
  deleteSupplier,
  linkProduct,
  listSupplierItems,
  listSuppliers,
  removeSupplierItem,
  unlinkProduct,
  updateSupplier,
} = await import('../src/services/suppliers')
import type { Product, SupplierItem } from '../src/types'

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id,
  sku: id,
  name: id,
  category: 'Vegetable',
  unit: 'Kilogram',
  unitType: 'KG',
  minStock: 0,
  hasImage: false,
  active: true,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})
const { setActiveBrand } = await import('../src/brand/brand')

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
})

const INPUT = {
  name: 'SIMUMMUANG',
  contactNumber: '021234567',
  email: 'order@simummuang.example',
  type: 'takingReturn' as const,
}

describe('suppliers', () => {
  test('one supplier holds many products', async () => {
    // The design this came from put a product and a price on the supplier row, but the
    // same supplier appeared several times in it. Folding the product into the supplier
    // would make this unrepresentable.
    const id = await createSupplier(INPUT)
    await addSupplierItem(id, 'VGT-01-01-001', 120)
    await addSupplierItem(id, 'VGT-01-02-017', 85.5)

    const items = await listSupplierItems()
    expect(items.filter((i) => i.supplierId === id)).toHaveLength(2)
    expect(items.map((i) => i.buyingPrice).sort((a, b) => a! - b!)).toEqual([85.5, 120])
  })

  test('a supplier with no name is refused', async () => {
    await expect(createSupplier({ ...INPUT, name: '   ' })).rejects.toThrow()
    await expect(listSuppliers()).resolves.toEqual([])
  })

  test('buyingPrice is optional and is left off rather than stored as zero', async () => {
    // Firestore's rules allow the field to be absent; a 0 would read as "free" instead of
    // "we have not recorded it".
    const id = await createSupplier(INPUT)
    await addSupplierItem(id, 'VGT-01-01-001')
    const [item] = await listSupplierItems()
    expect('buyingPrice' in item).toBe(false)
  })

  test('a negative price is refused', async () => {
    const id = await createSupplier(INPUT)
    await expect(addSupplierItem(id, 'VGT-01-01-001', -5)).rejects.toThrow()
  })

  test('deleting a supplier takes its product links with it', async () => {
    const keep = await createSupplier({ ...INPUT, name: 'KEEP' })
    const drop = await createSupplier({ ...INPUT, name: 'DROP' })
    await addSupplierItem(keep, 'VGT-01-01-001', 10)
    await addSupplierItem(drop, 'VGT-01-02-017', 20)
    await addSupplierItem(drop, 'MES-01-01-002', 30)

    await deleteSupplier(drop, [])

    // A link whose supplier is gone is unreachable from every screen, and would still be
    // counted by anything grouping by product.
    const items = await listSupplierItems()
    expect(items).toHaveLength(1)
    expect(items[0].supplierId).toBe(keep)
    expect((await listSuppliers()).map((s) => s.name)).toEqual(['KEEP'])
  })

  test('editing touches updatedAt and leaves createdAt alone', async () => {
    const id = await createSupplier(INPUT)
    const before = (await listSuppliers())[0]
    await updateSupplier(id, { name: 'RENAMED', type: 'notTakingReturn' })
    const after = (await listSuppliers())[0]
    expect(after.name).toBe('RENAMED')
    expect(after.type).toBe('notTakingReturn')
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt)
  })

  test('suppliers are scoped to the brand, like every other collection', async () => {
    await createSupplier(INPUT)
    setActiveBrand('lelapin')
    expect(await listSuppliers()).toEqual([])
    await createSupplier({ ...INPUT, name: 'LE LAPIN SUPPLIER' })
    expect((await listSuppliers()).map((s) => s.name)).toEqual(['LE LAPIN SUPPLIER'])

    setActiveBrand('pizza')
    expect((await listSuppliers()).map((s) => s.name)).toEqual(['SIMUMMUANG'])
    // Physically separate collections, not a field filter.
    expect(raw('suppliers')).toHaveLength(1)
    expect(raw('lelapin__suppliers')).toHaveLength(1)
  })

  test('unlinking a product leaves the supplier', async () => {
    const id = await createSupplier(INPUT)
    const itemId = await addSupplierItem(id, 'VGT-01-01-001', 10)
    await removeSupplierItem(itemId)
    expect(await listSupplierItems()).toEqual([])
    expect(await listSuppliers()).toHaveLength(1)
  })

  // The catalogue import wrote `supplierId` onto 299 products, and the Suppliers screen
  // then showed all 86 suppliers as "ยังไม่ได้ผูกสินค้า" — it was reading a different link,
  // the supplierItems price rows, and its own "เพิ่มสินค้า" wrote only those. Two links that
  // never agreed. The product's supplierId is the one Orders reads, so it is the one.
  describe('linking a product', () => {
    test('sets supplierId on the product, and a price row only when there is a price', async () => {
      const id = await createSupplier(INPUT)
      seed('products', [product('p1'), product('p2')] as unknown as Record<string, unknown>[])

      await linkProduct(id, 'p1', undefined, [])
      await linkProduct(id, 'p2', 42, [])

      const products = raw('products') as Product[]
      expect(products.find((p) => p.id === 'p1')?.supplierId).toBe(id)
      expect(products.find((p) => p.id === 'p2')?.supplierId).toBe(id)
      const items = await listSupplierItems()
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ supplierId: id, productId: 'p2', buyingPrice: 42 })
    })

    test('moving a product to another supplier takes the old price row with it', async () => {
      const a = await createSupplier({ ...INPUT, name: 'A' })
      const b = await createSupplier({ ...INPUT, name: 'B' })
      seed('products', [product('p1', { supplierId: a })] as unknown as Record<string, unknown>[])
      await addSupplierItem(a, 'p1', 10)
      const items = await listSupplierItems()

      await linkProduct(b, 'p1', 12, items)

      expect((raw('products') as Product[])[0].supplierId).toBe(b)
      const after = await listSupplierItems()
      expect(after).toHaveLength(1)
      expect(after[0]).toMatchObject({ supplierId: b, buyingPrice: 12 })
    })

    test('a second price for the same pair updates the row rather than adding one', async () => {
      const id = await createSupplier(INPUT)
      seed('products', [product('p1')] as unknown as Record<string, unknown>[])
      await linkProduct(id, 'p1', 10, [])
      await linkProduct(id, 'p1', 11, await listSupplierItems())
      const items = await listSupplierItems()
      expect(items).toHaveLength(1)
      expect(items[0].buyingPrice).toBe(11)
    })

    test('unlinking clears supplierId and drops the price row', async () => {
      const id = await createSupplier(INPUT)
      seed('products', [product('p1', { supplierId: id })] as unknown as Record<string, unknown>[])
      await addSupplierItem(id, 'p1', 10)

      await unlinkProduct('p1', await listSupplierItems())

      const [p] = raw('products') as Product[]
      // Absent, not empty: the rules pin the product's shape with hasOnly.
      expect('supplierId' in p).toBe(false)
      expect(await listSupplierItems()).toEqual([])
    })

    test('deleting a supplier clears supplierId on its products, not just the price rows', async () => {
      const id = await createSupplier(INPUT)
      seed('products', [
        product('p1', { supplierId: id }),
        product('p2', { supplierId: 'someone-else' }),
      ] as unknown as Record<string, unknown>[])
      await addSupplierItem(id, 'p1', 10)

      await deleteSupplier(id, raw('products') as Product[])

      const products = raw('products') as Product[]
      expect('supplierId' in products.find((p) => p.id === 'p1')!).toBe(false)
      expect(products.find((p) => p.id === 'p2')?.supplierId).toBe('someone-else')
      expect(await listSupplierItems()).toEqual([])
    })
  })

  // Same rule as products: hide, never delete. A supplier that stops supplying keeps its
  // name on every order it ever filled; hiding it takes it off the ordering screen and the
  // product editor, and one click brings it back.
  describe('hiding', () => {
    test('hiding flips active off and leaves everything else alone', async () => {
      const id = await createSupplier(INPUT)
      await updateSupplier(id, { active: false })
      const [s] = await listSuppliers()
      expect(s.active).toBe(false)
      expect(s.name).toBe('SIMUMMUANG')
      await updateSupplier(id, { active: true })
      expect((await listSuppliers())[0].active).toBe(true)
    })

    test('a hidden supplier is still listed — the screen decides what to show', async () => {
      const id = await createSupplier(INPUT)
      await updateSupplier(id, { active: false })
      expect(await listSuppliers()).toHaveLength(1)
    })
  })

  test('the list is sorted by name so it does not reshuffle between loads', async () => {
    seed('suppliers', [
      { id: 'c', name: 'Zeta', contactNumber: '', email: '', type: 'takingReturn', active: true, createdAt: 3, updatedAt: 3 },
      { id: 'a', name: 'Alpha', contactNumber: '', email: '', type: 'takingReturn', active: true, createdAt: 1, updatedAt: 1 },
      { id: 'b', name: 'Mid', contactNumber: '', email: '', type: 'takingReturn', active: true, createdAt: 2, updatedAt: 2 },
    ])
    expect((await listSuppliers()).map((s) => s.name)).toEqual(['Alpha', 'Mid', 'Zeta'])
  })
})
