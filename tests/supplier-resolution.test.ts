// Smart supplier resolution on receiving (owner, 7 Oct 2026).
import { describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { buildAuditEntry } = await import('../src/services/auditLog')
import { candidatesFor, conflictsWith, fitOf, resolveForProduct, resolveReceipt, supplierIssues, supplierRank, type ResolveContext } from '../src/lib/supplierResolution'
import type { Product, StockMovement, Supplier } from '../src/types'
import { overrideAudit, overridesFromAudit } from '../src/lib/supplierFeedback'


const sup = (id: string, name: string, active = true) => ({ id, name, active }) as unknown as Supplier
const prod = (id: string, name: string, supplierId?: string, alternateSupplierIds?: string[], active = true) => ({ id, name, sku: id.toUpperCase(), supplierId, alternateSupplierIds, active }) as unknown as Product
const rcv = (productId: string, supplierId: string, n = 1, voided = false) =>
  Array.from({ length: n }, (_, i) => ({ id: `${productId}-${supplierId}-${i}`, type: 'receive', productId, supplierId, voided }) as unknown as StockMovement)

const SUPPLIERS = [sup('s_foodway', 'FOOD WAY'), sup('s_panfood', 'PANFOOD'), sup('s_tgm', 'TGM'), sup('s_betagro', 'เบทาโก'), sup('s_old', 'OLD CO', false)]
const PRODUCTS = [
  prod('p_sausage', 'SAUSAGE MIX DOLCE (FOOD WAY)', 's_foodway'),
  prod('p_fries', 'FRENCH FRIES 3/8 (PANFOOD)', 's_panfood'),
  prod('p_bacon', 'SMOKED BACON SLICED 1 KG (TGM)', 's_tgm', ['s_betagro']),
  prod('p_mozz', 'MOZZARELLA (SHREDDED)'), // brackets name no supplier, and there is no mapping
  prod('p_feta', 'FETA CHEESE (HOMEMADE)', undefined, ['s_foodway', 's_panfood']),
  prod('p_ham', 'HAM', undefined, ['s_tgm']),
  prod('p_oldmap', 'OLD SAUCE', 's_old'),
  prod('p_hist', 'BASIL'),
  prod('p_hist2', 'OREGANO'),
  prod('p_gone', 'ARCHIVED THING', 's_foodway', [], false),
]
const ctx = (movements: StockMovement[] = []): ResolveContext => ({ products: PRODUCTS, suppliers: SUPPLIERS, movements })
const P = (id: string) => PRODUCTS.find((p) => p.id === id)!

describe('one product', () => {
  test('single supplier product → AUTO from the product mapping (the screenshot case)', () => {
    expect(resolveForProduct(P('p_sausage'), ctx())).toMatchObject({ kind: 'AUTO', because: 'product', candidate: { supplierId: 's_foodway', supplierName: 'FOOD WAY' } })
  })
  test('usual supplier with an alternate → AUTO to the usual one while history does not say otherwise', () => {
    expect(resolveForProduct(P('p_bacon'), ctx())).toMatchObject({ kind: 'AUTO', candidate: { supplierId: 's_tgm' } })
    expect(resolveForProduct(P('p_bacon'), ctx(rcv('p_bacon', 's_betagro', 4)))).toMatchObject({ kind: 'SUGGEST', candidate: { supplierId: 's_tgm' }, others: [{ supplierId: 's_betagro' }] })
  })
  test('several suppliers and no usual one → AMBIGUOUS, never chosen silently', () => {
    const r = resolveForProduct(P('p_feta'), ctx())
    expect(r.kind).toBe('AMBIGUOUS')
    if (r.kind === 'AMBIGUOUS') expect(r.candidates.map((c) => c.supplierId).sort()).toEqual(['s_foodway', 's_panfood'])
  })
  test('one listed alternate only → SUGGEST, not AUTO', () => {
    expect(resolveForProduct(P('p_ham'), ctx())).toMatchObject({ kind: 'SUGGEST', because: 'alternate', candidate: { supplierId: 's_tgm' } })
  })
  test('no supplier and brackets in the name → NO_MATCH (brackets are not evidence)', () => {
    expect(resolveForProduct(P('p_mozz'), ctx())).toEqual({ kind: 'NO_MATCH' })
  })
  test('inactive supplier is never offered', () => {
    expect(resolveForProduct(P('p_oldmap'), ctx())).toEqual({ kind: 'NO_MATCH' })
    expect(candidatesFor(P('p_oldmap'), ctx(rcv('p_oldmap', 's_old', 5)))).toEqual([])
  })
  test('history suggests, only when clear', () => {
    expect(resolveForProduct(P('p_hist'), ctx(rcv('p_hist', 's_tgm', 2)))).toMatchObject({ kind: 'SUGGEST', because: 'history', candidate: { supplierId: 's_tgm', receipts: 2 } })
    expect(resolveForProduct(P('p_hist'), ctx([...rcv('p_hist', 's_tgm', 2), ...rcv('p_hist', 's_panfood', 2)])).kind).toBe('AMBIGUOUS')
    expect(resolveForProduct(P('p_hist'), ctx([...rcv('p_hist', 's_tgm', 9), ...rcv('p_hist', 's_panfood', 1)]))).toMatchObject({ kind: 'SUGGEST', candidate: { supplierId: 's_tgm' } })
    expect(resolveForProduct(P('p_hist'), ctx(rcv('p_hist', 's_tgm', 3, true)))).toEqual({ kind: 'NO_MATCH' }) // voided receipts do not count
  })
  test('history never outranks the product mapping', () => {
    expect(resolveForProduct(P('p_sausage'), ctx(rcv('p_sausage', 's_panfood', 50)))).toMatchObject({ kind: 'SUGGEST', candidate: { supplierId: 's_foodway' } })
  })
})

describe('the receipt', () => {
  const order = { supplierId: 's_panfood', supplierName: 'PANFOOD', docNo: 'PO-000123' }
  test('PO receive: the order’s supplier, locked, whatever the products say', () => {
    expect(resolveReceipt({ order, productIds: ['p_sausage'], ocrSupplierId: 's_tgm', ctx: ctx() })).toEqual({ kind: 'LOCKED', supplierId: 's_panfood', supplierName: 'PANFOOD', poDocNo: 'PO-000123' })
  })
  test('manual receive, several products of the same supplier → AUTO', () => {
    const p2 = prod('p_sausage2', 'SAUSAGE HOT (FOOD WAY)', 's_foodway')
    const c = { ...ctx(), products: [...PRODUCTS, p2] }
    expect(resolveReceipt({ order: null, productIds: ['p_sausage', 'p_sausage2'], ctx: c })).toMatchObject({ kind: 'AUTO', candidate: { supplierId: 's_foodway' } })
  })
  test('a product without mapping does not block the others', () => {
    expect(resolveReceipt({ order: null, productIds: ['p_sausage', 'p_mozz'], ctx: ctx() })).toMatchObject({ kind: 'AUTO', candidate: { supplierId: 's_foodway' } })
  })
  test('conflicting products → AMBIGUOUS, never switched', () => {
    expect(resolveReceipt({ order: null, productIds: ['p_sausage', 'p_fries'], ctx: ctx() }).kind).toBe('AMBIGUOUS')
  })
  test('OCR agrees with the products → AUTO; OCR alone → SUGGEST', () => {
    expect(resolveReceipt({ order: null, productIds: ['p_sausage'], ocrSupplierId: 's_foodway', ctx: ctx() })).toMatchObject({ kind: 'AUTO', candidate: { supplierId: 's_foodway', evidence: ['product', 'ocr'] } })
    expect(resolveReceipt({ order: null, productIds: [], ocrSupplierId: 's_foodway', ctx: ctx() })).toMatchObject({ kind: 'SUGGEST', because: 'ocr' })
  })
  test('OCR conflicts with the product mapping → MISMATCH for a person', () => {
    expect(resolveReceipt({ order: null, productIds: ['p_fries'], ocrSupplierId: 's_foodway', ctx: ctx() })).toMatchObject({ kind: 'MISMATCH', ocr: { supplierId: 's_foodway' }, mapped: [{ supplierId: 's_panfood' }] })
  })
  test('ids that are not on file are never returned', () => {
    const r = resolveReceipt({ order: null, productIds: ['p_nope'], ocrSupplierId: 's_invented', ctx: ctx() })
    expect(r).toEqual({ kind: 'NO_MATCH' })
  })
})

describe('supplier chosen, then products (and the other way round)', () => {
  test('fit of each product to the chosen supplier', () => {
    expect(fitOf(P('p_sausage'), 's_foodway', ctx())).toBe('compatible')
    expect(fitOf(P('p_bacon'), 's_betagro', ctx())).toBe('alternate')
    expect(fitOf(P('p_hist'), 's_tgm', ctx(rcv('p_hist', 's_tgm')))).toBe('history')
    expect(fitOf(P('p_fries'), 's_foodway', ctx())).toBe('incompatible')
    expect(fitOf(P('p_mozz'), 's_foodway', ctx())).toBe('unknown')
  })
  test('adding FRENCH FRIES to a FOOD WAY receipt is a conflict naming PANFOOD', () => {
    expect(conflictsWith('s_foodway', ['p_sausage', 'p_fries', 'p_mozz'], ctx())).toEqual([{ productId: 'p_fries', productName: 'FRENCH FRIES 3/8 (PANFOOD)', fit: 'incompatible', mappedTo: [expect.objectContaining({ supplierId: 's_panfood' })] }])
  })
  test('changing the supplier after items: every line is re-checked', () => {
    expect(conflictsWith('s_panfood', ['p_sausage', 'p_fries'], ctx()).map((c) => c.productId)).toEqual(['p_sausage'])
    expect(conflictsWith('s_betagro', ['p_bacon'], ctx())).toEqual([])
  })
  test('search puts the chosen supplier’s products first, hides nothing', () => {
    const r = supplierRank('s_tgm', ctx(rcv('p_hist2', 's_tgm')))
    const order = [...PRODUCTS].sort((a, b) => r(b) - r(a)).map((p) => p.id)
    expect(order.slice(0, 3)).toEqual(['p_bacon', 'p_ham', 'p_hist2'])
    expect(order).toHaveLength(PRODUCTS.length)
  })
})

describe('data quality and feedback', () => {
  test('mapping problems are listed; archived products are ignored', () => {
    const issues = supplierIssues(ctx())
    expect(issues).toContainEqual({ kind: 'noSupplier', productId: 'p_mozz' })
    expect(issues).toContainEqual({ kind: 'inactiveSupplier', productId: 'p_oldmap', supplierId: 's_old' })
    expect(issues).toContainEqual({ kind: 'alternatesWithoutUsual', productId: 'p_feta' })
    expect(issues.some((i) => i.productId === 'p_gone')).toBe(false)
  })
  test('one override is nothing; repeated overrides flag the mapping for review', () => {
    const o = { productId: 'p_sausage', suggested: 's_foodway', chosen: 's_panfood', at: 1 }
    expect(supplierIssues(ctx(), [o]).some((i) => i.kind === 'frequentOverride')).toBe(false)
    expect(supplierIssues(ctx(), [o, o, o])).toContainEqual({ kind: 'frequentOverride', productId: 'p_sausage', suggested: 's_foodway', chosen: 's_panfood', times: 3 })
  })
  test('resolution changes nothing it is given', () => {
    const snapshot = JSON.stringify(PRODUCTS)
    resolveReceipt({ order: null, productIds: PRODUCTS.map((p) => p.id), ocrSupplierId: 's_foodway', ctx: ctx() })
    expect(JSON.stringify(PRODUCTS)).toBe(snapshot)
  })
})

describe('override feedback in the audit log', () => {
  const ctxOverride = { productId: 'p_sausage', suggestedSupplierId: 's_foodway', selectedSupplierId: 's_panfood', resolution: 'AUTO' as const, evidence: 'product' as const, toLocationId: 'loc_main', invoiceNo: 'IV123', receiptOperationId: 'rcop_123456' }
  test('one structured, rules-shaped entry per override (action x.y, entity product, small maps)', () => {
    const e = buildAuditEntry(overrideAudit(ctxOverride, 'op-1'), { id: 'u1', name: 'Staff', role: 'staff' }, 1_791_000_000_000)
    expect(e.action).toMatch(/^[a-zA-Z]{1,30}[.][a-zA-Z]{1,40}$/)
    expect(e.entityType).toBe('product')
    expect(e.entityId).toBe('p_sausage')
    expect(e.before).toEqual({ supplierId: 's_foodway', resolution: 'AUTO', evidence: 'product' })
    expect(e.after).toEqual({ supplierId: 's_panfood', toLocationId: 'loc_main', invoiceNo: 'IV123', receiptOperationId: 'rcop_123456', context: 'receive.manual' })
    expect(Object.keys(e).sort()).toEqual(['action', 'actorId', 'actorName', 'actorRole', 'after', 'before', 'createdAt', 'entityId', 'entityType', 'id', 'operationId'])
    expect(e.operationId).toBe('op-1')
    // No probability is recorded: the resolution is a rule, not a score.
    expect(JSON.stringify(e)).not.toMatch(/confidence|probability|score/)
  })
  test('entries read back as overrides, and repeats flag the mapping', () => {
    const e = buildAuditEntry(overrideAudit(ctxOverride), { id: 'u1', name: 'Staff', role: 'staff' }, 1)
    const other = { ...e, action: 'product.update' }
    const events = overridesFromAudit([e, e, e, other])
    expect(events).toHaveLength(3)
    expect(supplierIssues(ctx(), events)).toContainEqual({ kind: 'frequentOverride', productId: 'p_sausage', suggested: 's_foodway', chosen: 's_panfood', times: 3 })
  })
})
