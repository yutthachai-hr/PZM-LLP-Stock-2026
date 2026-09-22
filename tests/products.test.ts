// Reference conversions on a product — "1 ลัง = 288 EA" — round-tripping through create,
// update, and clear.
//
//   npm test

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, raw } = await import('./helpers/memory-backend')
const { createProduct, updateProduct } = await import('../src/services/products')
const { setActiveBrand } = await import('../src/brand/brand')

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
})

const BASE = {
  sku: 'GAS-01',
  name: 'GAS 48 KG',
  category: 'Other',
  unit: 'Each',
  unitType: 'EA',
  minStock: 0,
}

describe('a product with no reference conversions', () => {
  test('is created without the field at all', async () => {
    await createProduct(BASE)
    const [row] = raw('products') as Record<string, unknown>[]
    expect('unitConversions' in row).toBe(false)
  })

  test('an empty list is the same as none', async () => {
    await createProduct({ ...BASE, unitConversions: [] })
    const [row] = raw('products') as Record<string, unknown>[]
    expect('unitConversions' in row).toBe(false)
  })
})

describe('setting reference conversions', () => {
  test('creating with them writes the sanitised list', async () => {
    await createProduct({
      ...BASE,
      unitConversions: [
        { label: '  ลัง  ', size: 288 },
        { label: 'ไม่เอา', size: 0 },
      ],
    })
    const [row] = raw('products') as { unitConversions: { label: string; size: number }[] }[]
    expect(row.unitConversions).toEqual([{ label: 'ลัง', size: 288 }])
  })

  test('adding them later, then clearing them, removes the key rather than leaving []', async () => {
    const id = await createProduct(BASE)
    await updateProduct(id, { unitConversions: [{ label: 'ลัง', size: 288 }] })
    expect((raw('products')[0] as { unitConversions?: unknown }).unitConversions).toEqual([
      { label: 'ลัง', size: 288 },
    ])

    await updateProduct(id, { unitConversions: [] })
    expect('unitConversions' in (raw('products')[0] as Record<string, unknown>)).toBe(false)
  })

  test('editing something else on the product leaves an existing list alone', async () => {
    const id = await createProduct({ ...BASE, unitConversions: [{ label: 'ลัง', size: 288 }] })
    await updateProduct(id, { name: 'GAS 48 KG (renamed)' })
    const row = raw('products')[0] as { name: string; unitConversions: unknown }
    expect(row.name).toBe('GAS 48 KG (renamed)')
    expect(row.unitConversions).toEqual([{ label: 'ลัง', size: 288 }])
  })
})

describe('alternate suppliers', () => {
  test('never include the primary, blanks, or repeats, and are removed when emptied', async () => {
    const id = await createProduct({
      ...BASE,
      supplierId: 's-main',
      alternateSupplierIds: ['s-main', 's-b', ' ', 's-b', 's-c'],
    })
    const row = () => raw('products')[0] as Record<string, unknown>
    expect(row().alternateSupplierIds).toEqual(['s-b', 's-c'])

    await updateProduct(id, { supplierId: 's-main', alternateSupplierIds: [] })
    expect('alternateSupplierIds' in row()).toBe(false)
  })
})

describe('barcodes (owner, 22 Sep 2026)', () => {
  test('are optional, stored trimmed, and cleared as an absent field', async () => {
    const id = await createProduct({ ...BASE, barcode: '  8851000654321 ' })
    const row = () => (raw('products') as Record<string, unknown>[]).find((r) => r.id === id)!
    expect(row().barcode).toBe('8851000654321')
    await updateProduct(id, { barcode: '' })
    expect('barcode' in row()).toBe(false)
    const plain = await createProduct({ ...BASE, sku: 'GAS-02' })
    expect('barcode' in (raw('products') as Record<string, unknown>[]).find((r) => r.id === plain)!).toBe(false)
  })

  test('cannot land on two products — a scan has to mean one thing', async () => {
    await createProduct({ ...BASE, barcode: '111' })
    await expect(createProduct({ ...BASE, sku: 'GAS-03', barcode: '111' })).rejects.toThrow()
    const other = await createProduct({ ...BASE, sku: 'GAS-04' })
    await expect(updateProduct(other, { barcode: '111' })).rejects.toThrow()
    // Saving a product with the barcode it already has is not a clash with itself.
    await expect(updateProduct(other, { barcode: '222' })).resolves.toBeUndefined()
    await expect(updateProduct(other, { barcode: '222' })).resolves.toBeUndefined()
  })
})
