// Turning the brackets in product names into a supplier list, and renaming one afterwards.
//
//   npm test
//
// The proposal is checked against the real shipped catalogue rather than a handful of made-up
// products. That is the whole point: the rules exist because of what is actually in those 454
// names, so a fixture invented to suit them would prove nothing.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, seed, raw } = await import('./helpers/memory-backend')
const { buildSupplierProposal, applySupplierProposal, renameSupplier } = await import(
  '../src/services/supplierImport'
)
const { setActiveBrand } = await import('../src/brand/brand')
const { PZM_PRODUCTS, LLP_PRODUCTS } = await import('../src/seed/catalog.generated')
import type { Product } from '../src/types'

/** The shipped catalogue, both brands, shaped as products. */
const catalogue: Product[] = [...PZM_PRODUCTS, ...LLP_PRODUCTS].map((c, i) => ({
  id: `p${i}`,
  sku: c.sku,
  name: c.name,
  category: c.category,
  unit: c.unit,
  unitType: c.unitType,
  minStock: 0,
  hasImage: false,
  active: true,
  createdAt: 1,
  updatedAt: 1,
}))

const product = (id: string, name: string, over: Partial<Product> = {}): Product => ({
  id,
  sku: id,
  name,
  category: 'C',
  unit: 'Each',
  unitType: 'EA',
  minStock: 0,
  hasImage: false,
  active: true,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

beforeEach(() => {
  setActiveBrand('pizza')
  resetMemory()
})

describe('the proposal over the real catalogue', () => {
  const proposal = buildSupplierProposal(catalogue)
  const named = (n: string) => proposal.suppliers.find((s) => s.name === n)

  test('it accounts for every product exactly once', () => {
    expect(proposal.linked + proposal.withoutSupplier.length).toBe(catalogue.length)
  })

  test('the biggest suppliers come out with their products', () => {
    expect(named('KT')?.productIds.length).toBe(28)
    expect(named('OLIVA')?.productIds.length).toBe(10)
  })

  test("the owner's three-way spelling settles into one supplier", () => {
    const sim = named('SIMMUMMUANG')
    expect(sim).toBeDefined()
    // 19 + 19 + 4 products that were three separate suppliers before.
    expect(sim!.productIds.length).toBe(42)
    expect(sim!.spellings.sort()).toEqual(['SIMUMMUANG', 'SIMUMUANG', 'SIMUNMMANG'])
    expect(proposal.suppliers.some((s) => s.name.startsWith('SIMU'))).toBe(false)
  })

  test('the transposed pair is proposed as one, and flagged as merged', () => {
    const makro = proposal.suppliers.find((s) => s.spellings.includes('MAKRO'))!
    expect(makro.spellings.sort()).toEqual(['MAKRO', 'MARKO'])
    expect(makro.merged).toBe(true)
    expect(makro.productIds.length).toBe(38)
  })

  test('the shop that reads as a measurement survives, renamed', () => {
    expect(named('7/11 SEVEN ELEVEN')?.productIds.length).toBe(1)
  })

  test('the branch is replaced by the company that delivers there, with the reason kept', () => {
    const pap = named('PAP GAS')
    expect(pap?.productIds.length).toBe(1)
    expect(pap?.note).toContain('อ่อนนุช')
    expect(named('BRANCH 3')).toBeUndefined()
  })

  test('the six the owner will fill in by hand are listed, not guessed at', () => {
    const names = proposal.withoutSupplier.map((p) => p.name)
    expect(names).toContain('GAS 48 KG')
    expect(names).toContain('WOOD')
    expect(names).toContain('Whole Grain')
    // The one whose only bracket is a pack size.
    expect(names.some((n) => n.includes('1*100'))).toBe(true)
  })

  test('no pack size became a supplier', () => {
    for (const s of proposal.suppliers) {
      expect(s.name).not.toMatch(/^\d+\s*\*/)
      expect(s.name).not.toMatch(/^[\d.]+\s*(KG|G|ML)$/i)
    }
  })

  test('the list is short enough to work with, and ordered by size', () => {
    // 126 brackets in the catalogue come out as 103 suppliers once the sizes are dropped and
    // the spellings folded. Pinned rather than bounded: if the catalogue changes and this
    // moves, somebody should look at why rather than find out from a supplier list.
    expect(proposal.suppliers.length).toBe(103)
    const counts = proposal.suppliers.map((s) => s.productIds.length)
    expect([...counts].sort((a, b) => b - a)).toEqual(counts)
  })
})

describe('accepting the proposal', () => {
  const products = [
    product('a', 'BAKING SODA (MARKO)'),
    product('b', 'SOMETHING (MAKRO)'),
    product('c', 'GAS 48 KG'),
  ]

  test('it creates the suppliers and points the products at them', async () => {
    seed('products', products as unknown as Record<string, unknown>[])
    const proposal = buildSupplierProposal(products)
    const result = await applySupplierProposal(proposal.suppliers)
    expect(result).toEqual({ suppliers: 1, products: 2 })

    const suppliers = raw('suppliers')
    expect(suppliers).toHaveLength(1)
    const written = raw('products') as { id: string; supplierId?: string }[]
    expect(written.find((p) => p.id === 'a')?.supplierId).toBe(suppliers[0].id)
    expect(written.find((p) => p.id === 'b')?.supplierId).toBe(suppliers[0].id)
    // The one the owner will fill in later is left alone rather than guessed at.
    expect(written.find((p) => p.id === 'c')?.supplierId).toBeUndefined()
  })

  test('running it again reuses the supplier rather than making a second one', async () => {
    seed('products', products as unknown as Record<string, unknown>[])
    const proposal = buildSupplierProposal(products)
    await applySupplierProposal(proposal.suppliers)
    const second = await applySupplierProposal(proposal.suppliers)
    expect(second.suppliers).toBe(0)
    expect(raw('suppliers')).toHaveLength(1)
  })

  test('accepting nothing is refused rather than quietly doing nothing', async () => {
    await expect(applySupplierProposal([])).rejects.toThrow()
  })
})

describe('renaming a supplier', () => {
  test('the bracket changes in every product name, under every spelling', async () => {
    // The owner's example: (KT) becomes (Klongtoei) and reads that way everywhere.
    const products = [
      product('a', 'BAKING SODA (MARKO)'),
      product('b', 'SOMETHING (MAKRO)'),
      product('c', 'DRIED CHILLI (KT)'),
    ]
    seed('products', products as unknown as Record<string, unknown>[])
    const proposal = buildSupplierProposal(products)
    await applySupplierProposal(proposal.suppliers)

    const written = raw('products') as Product[]
    const makroId = written.find((p) => p.id === 'a')!.supplierId!
    const renamed = await renameSupplier(makroId, 'Makro Cash & Carry', written)
    expect(renamed).toBe(2)

    const after = raw('products') as Product[]
    expect(after.find((p) => p.id === 'a')?.name).toBe('BAKING SODA (Makro Cash & Carry)')
    expect(after.find((p) => p.id === 'b')?.name).toBe('SOMETHING (Makro Cash & Carry)')
    // Another supplier's product is untouched.
    expect(after.find((p) => p.id === 'c')?.name).toBe('DRIED CHILLI (KT)')
    expect((raw('suppliers')[0] as { name: string }).name).toBe('Makro Cash & Carry')
  })

  test('a product whose name was edited by hand still follows its supplier', async () => {
    // The link is the id, not the text, so a name nobody can parse is not orphaned.
    const products = [product('a', 'BAKING SODA (MARKO)'), product('b', 'Odd name, no bracket')]
    seed('products', products as unknown as Record<string, unknown>[])
    await applySupplierProposal(buildSupplierProposal(products).suppliers)
    const id = (raw('products') as Product[]).find((p) => p.id === 'a')!.supplierId!
    await backendLink('b', id)

    const renamed = await renameSupplier(id, 'Makro', raw('products') as Product[])
    // Only the one whose name actually carries the bracket is rewritten.
    expect(renamed).toBe(1)
    expect((raw('products') as Product[]).find((p) => p.id === 'b')?.name).toBe(
      'Odd name, no bracket',
    )
  })

  test('an empty name is refused', async () => {
    seed('products', [product('a', 'X (MARKO)')] as unknown as Record<string, unknown>[])
    await applySupplierProposal(buildSupplierProposal([product('a', 'X (MARKO)')]).suppliers)
    const id = (raw('suppliers')[0] as { id: string }).id
    await expect(renameSupplier(id, '   ', raw('products') as Product[])).rejects.toThrow()
  })
})

/** Attach a product to a supplier the way the product editor will. */
async function backendLink(productId: string, supplierId: string) {
  const { backend } = await import('../src/backend')
  await backend.update('products', productId, { supplierId })
}
