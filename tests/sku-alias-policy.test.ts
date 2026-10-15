import { describe, expect, test, vi } from 'vitest'

// Only the browser/network persistence boundary is replaced; matching and batch parsing are real.
vi.mock('../src/backend', async () => {
  const { memoryBackend } = await import('./helpers/memory-backend')
  return { backend: memoryBackend, BACKEND_MODE: 'local' }
})
import type { Product } from '../src/types'
import { buildMatchIndex, matchProduct, type ProductAlias } from '../src/lib/productMatch'
import { choose, importable, planRows } from '../src/lib/importReview'
import { ocrCandidates } from '../src/lib/billOcr'
import { ocrFill } from '../src/pages/receive/ocrApply'
import { emptyDraft } from '../src/pages/receive/receipt'
import { buildBatchRows } from '../src/services/purchaseBatch'

const p = (id: string, sku: string, name: string, extra: Partial<Product> = {}): Product => ({ id, sku, name, category: 'test', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: 1, updatedAt: 1, ...extra })
const ranch = p('ranch', 'PZS-01-06-001', 'RANCH (PICHON)', { unitConversions: [{ label: 'Pack', size: 0.5 }] })
const mayo = p('mayo', 'MAY-001', 'MAYONNAISE 1 KG')
const branch = p('branch', 'GAS-001', 'GAS 48 KG (BRANCH 3)')
const catalogue = [ranch, mayo, branch]
const alias: ProductAlias = { id: 'a', key: 'SAUCE FOR SALAD', sourceName: 'sauce for salad', productId: 'ranch', createdBy: 'human', createdByName: 'Reviewer', createdAt: 1 }
const idx = (aliases: ProductAlias[] = []) => buildMatchIndex(catalogue, aliases)

// Removing the SKU/alias-only gate must make these real consumer assertions fail.
describe('SKU or human alias only, across product-resolution consumers', () => {
  test.each(['RANCH (PICHON)', 'ranch', 'RANCH (DIFFERENT SUPPLIER)', 'MAYONNAISE 1KG', 'GAS 48KG (BRANCH 3)'])('name %s is never an automatic answer', (name) => {
    expect(matchProduct(name, idx()).product).toBeUndefined()
    const row = planRows([{ name, qty: 2 }], catalogue)[0]
    expect(row.how).not.toBe('sure')
    expect(importable([row])).toEqual([])
  })
  test('exact SKU and a recorded human alias resolve only the intended product', () => {
    expect(matchProduct('PZS-01-06-001', idx())).toMatchObject({ kind: 'exact', product: ranch })
    expect(matchProduct('sauce for salad', idx([alias]))).toMatchObject({ kind: 'alias', product: ranch })
  })
  test.each(['RANCH 1 kg.', 'BRANCH', 'MAYONNAISE 1 KG', 'RANCH 500 G', 'RANCH 1 BOX'])('shared words/packaging %s cannot select another product', (name) => {
    expect(matchProduct(name, idx()).product).toBeUndefined()
  })
  test('a foreign-brand alias cannot resolve a product outside this brand catalogue', () => {
    expect(matchProduct('sauce for salad', buildMatchIndex([mayo], [alias])).product).toBeUndefined()
    expect(matchProduct(ranch.sku, buildMatchIndex([mayo], [alias])).product).toBeUndefined()
  })
  test.each([{ ...alias, createdBy: '' }, { ...alias, sourceName: 'different historical spelling' }])('unconfirmed or corrupt historical alias is not trusted: %j', (record) => {
    expect(matchProduct('sauce for salad', idx([record])).product).toBeUndefined()
  })
  test('alias to an inactive product cannot silently select it', () => {
    expect(matchProduct('sauce for salad', buildMatchIndex([{ ...ranch, active: false }], [alias])).product).toBeUndefined()
  })
  test('a bare alias never authorizes an explicitly different supplier bracket', () => {
    expect(matchProduct('sauce for salad (OTHER SUPPLIER)', idx([alias])).product).toBeUndefined()
  })
  test('duplicate SKU cannot silently choose the last product', () => {
    expect(matchProduct(ranch.sku, buildMatchIndex([ranch, { ...mayo, sku: ranch.sku }], [])).product).toBeUndefined()
  })
  test('workbook batch does not pre-resolve an unconfirmed name', () => {
    const block = { rows: [{ excelRow: 2, name: 'RANCH (PICHON)', unit: 'KG', rawQty: '2', qty: 2, qtyState: 'number' }] } as Parameters<typeof buildBatchRows>[0]
    expect(buildBatchRows(block, catalogue, [])[0].productId).toBeUndefined()
  })
  test('explicitly chosen name converts by that product only', () => {
    const guessed = planRows([{ name: 'RANCH (PICHON)', qty: 2, unit: 'Pack' }], catalogue)[0]
    expect(guessed.include).toBe(false)
    const picked = choose(guessed, ranch)
    expect([picked.qty, picked.entryUnit, picked.entryQty, picked.how]).toEqual([1, 'Pack', 2, 'picked'])
    expect(importable([picked])).toHaveLength(1)
    expect(choose({ ...guessed, read: { ...guessed.read, unit: 'Box' } }, ranch).include).toBe(false)
  })
  test('document-import provenance cannot pre-tick even a valid SKU', () => {
    const [row] = planRows([{ name: ranch.sku, qty: 2, source: 'ocr' }], catalogue)
    expect(row.include).toBe(false)
    expect(row.how).not.toBe('sure')
  })
  test('OCR-derived SKU/name/alias candidates never automatically populate a receiving line', () => {
    const lines = [{ name: ranch.sku, qty: 2 }, { name: 'RANCH (PICHON)', qty: 2 }, { name: alias.sourceName, qty: 2 }]
    const filled = ocrFill({ lines }, ocrCandidates({ lines }), { draft: emptyDraft(), order: null, suppliers: [] })
    expect(filled.filled).toBe(0)
    expect(filled.patch.lines).toEqual([])
    expect(filled.skipped.map((s) => s.name)).toEqual([ranch.sku, 'RANCH (PICHON)', alias.sourceName])
  })
})
