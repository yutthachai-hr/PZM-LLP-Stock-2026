/**
 * Smart supplier resolution on receiving (owner, 7 Oct 2026): pick or suggest the receipt's
 * supplier from what is known about the products on it, so nobody has to choose FOOD WAY by
 * hand after choosing "SAUSAGE MIX DOLCE (FOOD WAY)".
 *
 * Evidence, strongest first — a weaker kind never overrides a stronger one:
 *   1. the purchase order being received (locked; never changed here)
 *   2. the product's own supplier, `Product.supplierId` (the usual supplier)
 *   3. the product's listed alternates, `Product.alternateSupplierIds`
 *   4. the supplier read off the bill (OCR), matched to a supplier on file
 *   5. who this product was received from before (receipts already in memory — no read)
 * The name in brackets is NOT evidence: "MOZZARELLA (SHREDDED)" names no supplier.
 *
 * Results are labels with reasons, not percentages: AUTO, SUGGEST, AMBIGUOUS, NO_MATCH (and
 * LOCKED from an order, MISMATCH when strong evidence disagrees). Every id returned is a
 * supplier on file and active. Nothing here writes, creates a supplier, or edits a product.
 */
import type { Product, PurchaseOrder, StockMovement, Supplier } from '../types'

export type Evidence = 'po' | 'product' | 'alternate' | 'ocr' | 'history'

export interface Candidate {
  supplierId: string
  supplierName: string
  evidence: Evidence[]
  /** Receipts of these products from this supplier in the window in memory. */
  receipts: number
}

export type Resolution =
  | { kind: 'LOCKED'; supplierId: string; supplierName: string; poDocNo: string }
  | { kind: 'AUTO'; candidate: Candidate; because: Evidence }
  | { kind: 'SUGGEST'; candidate: Candidate; because: Evidence; others: Candidate[] }
  | { kind: 'AMBIGUOUS'; candidates: Candidate[] }
  | { kind: 'MISMATCH'; ocr: Candidate; mapped: Candidate[] }
  | { kind: 'NO_MATCH' }

/** How one product stands against a chosen supplier. */
export type Fit = 'compatible' | 'alternate' | 'history' | 'incompatible' | 'unknown'

export interface ResolveContext {
  products: readonly Product[]
  suppliers: readonly Supplier[]
  /** Receipt movements already in memory (DataContext), for history. */
  movements: readonly StockMovement[]
}

const RANK: Record<Evidence, number> = { po: 5, product: 4, alternate: 3, ocr: 2, history: 1 }

function activeSupplier(ctx: ResolveContext, id: string | undefined): Supplier | null {
  if (!id) return null
  const s = ctx.suppliers.find((x) => x.id === id)
  return s && s.active !== false ? s : null
}

/** Supplier → receipt count for one product, from receipts in memory that name a supplier on file. */
export function historyFor(productId: string, ctx: ResolveContext): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of ctx.movements) {
    if (m.voided || m.type !== 'receive' || m.productId !== productId || !m.supplierId) continue
    if (!activeSupplier(ctx, m.supplierId)) continue
    out.set(m.supplierId, (out.get(m.supplierId) ?? 0) + 1)
  }
  return out
}

/** Every active supplier this product is linked to, with the evidence for each. */
export function candidatesFor(product: Product, ctx: ResolveContext): Candidate[] {
  const by = new Map<string, Candidate>()
  const add = (id: string | undefined, ev: Evidence, receipts = 0) => {
    const s = activeSupplier(ctx, id)
    if (!s) return
    const c = by.get(s.id) ?? { supplierId: s.id, supplierName: s.name, evidence: [], receipts: 0 }
    if (!c.evidence.includes(ev)) c.evidence.push(ev)
    c.receipts += receipts
    by.set(s.id, c)
  }
  add(product.supplierId, 'product')
  for (const a of product.alternateSupplierIds ?? []) if (a !== product.supplierId) add(a, 'alternate')
  for (const [id, n] of historyFor(product.id, ctx)) add(id, 'history', n)
  return rank([...by.values()])
}

function strongest(c: Candidate): number {
  return Math.max(...c.evidence.map((e) => RANK[e]))
}

function rank(cs: Candidate[]): Candidate[] {
  return cs.sort((a, b) => strongest(b) - strongest(a) || b.receipts - a.receipts || a.supplierName.localeCompare(b.supplierName))
}

/** One product on its own: what the supplier field should do when it is the first line. */
export function resolveForProduct(product: Product, ctx: ResolveContext): Resolution {
  const cs = candidatesFor(product, ctx)
  if (!cs.length) return { kind: 'NO_MATCH' }
  const own = cs.find((c) => c.evidence.includes('product'))
  const alternates = cs.filter((c) => c.evidence.includes('alternate') && c !== own)
  if (own) {
    // The usual supplier — chosen outright unless lately this has come from someone else more
    // often, when it is still the one offered, but with the others shown (the mapping may be stale).
    const others = cs.filter((c) => c !== own)
    if (others.every((c) => c.receipts <= own.receipts)) return { kind: 'AUTO', candidate: own, because: 'product' }
    return { kind: 'SUGGEST', candidate: own, because: 'product', others }
  }
  if (alternates.length === 1 && cs.length === 1) return { kind: 'SUGGEST', candidate: alternates[0], because: 'alternate', others: [] }
  if (alternates.length > 1) return { kind: 'AMBIGUOUS', candidates: cs }
  // History only.
  const hist = cs.filter((c) => c.evidence.includes('history'))
  if (hist.length === 1) return { kind: 'SUGGEST', candidate: hist[0], because: 'history', others: [] }
  const [top, second] = hist
  if (top && second && top.receipts >= 3 * second.receipts && top.receipts >= 3) return { kind: 'SUGGEST', candidate: top, because: 'history', others: hist.slice(1) }
  return { kind: 'AMBIGUOUS', candidates: cs }
}

/** How a product fits a supplier already on the receipt. */
export function fitOf(product: Product, supplierId: string, ctx: ResolveContext): Fit {
  if (product.supplierId === supplierId) return 'compatible'
  if ((product.alternateSupplierIds ?? []).includes(supplierId)) return 'alternate'
  if ((historyFor(product.id, ctx).get(supplierId) ?? 0) > 0) return 'history'
  const linked = !!activeSupplier(ctx, product.supplierId) || (product.alternateSupplierIds ?? []).some((a) => activeSupplier(ctx, a))
  return linked ? 'incompatible' : 'unknown'
}

export interface Conflict {
  productId: string
  productName: string
  fit: 'incompatible'
  /** Where this product is normally bought, for the message. */
  mappedTo: Candidate[]
}

/**
 * The whole receipt: an order locks it; otherwise the products on it (and the bill, when read)
 * decide together. Supplier is document-level: one product never switches the receipt.
 */
export function resolveReceipt(input: {
  order: Pick<PurchaseOrder, 'supplierId' | 'supplierName' | 'docNo'> | null
  productIds: readonly string[]
  ocrSupplierId?: string
  ctx: ResolveContext
}): Resolution {
  const { order, ctx } = input
  if (order) return { kind: 'LOCKED', supplierId: order.supplierId, supplierName: order.supplierName, poDocNo: order.docNo }
  const products = input.productIds.map((id) => ctx.products.find((p) => p.id === id)).filter((p): p is Product => !!p)
  const ocr = activeSupplier(ctx, input.ocrSupplierId)

  if (!products.length) {
    if (!ocr) return { kind: 'NO_MATCH' }
    return { kind: 'SUGGEST', candidate: { supplierId: ocr.id, supplierName: ocr.name, evidence: ['ocr'], receipts: 0 }, because: 'ocr', others: [] }
  }
  const each = products.map((p) => resolveForProduct(p, ctx))
  const firm = each.filter((r): r is Extract<Resolution, { kind: 'AUTO' }> => r.kind === 'AUTO').map((r) => r.candidate)
  const firmIds = new Set(firm.map((c) => c.supplierId))

  if (ocr) {
    const ocrCand: Candidate = { supplierId: ocr.id, supplierName: ocr.name, evidence: ['ocr'], receipts: 0 }
    // The bill names a supplier, and a product's own mapping names another: a person decides.
    const against = firm.filter((c) => c.supplierId !== ocr.id)
    if (against.length) return { kind: 'MISMATCH', ocr: ocrCand, mapped: dedupe(against) }
    // Every product that can fit the bill's supplier does: very strong.
    if (products.every((p) => fitOf(p, ocr.id, ctx) !== 'incompatible')) {
      return firmIds.size === 1 ? { kind: 'AUTO', candidate: { ...firm[0], evidence: [...firm[0].evidence, 'ocr'] }, because: 'product' } : { kind: 'SUGGEST', candidate: ocrCand, because: 'ocr', others: [] }
    }
    return { kind: 'MISMATCH', ocr: ocrCand, mapped: dedupe(products.flatMap((p) => candidatesFor(p, ctx).filter((c) => c.evidence.includes('product')))) }
  }

  if (firmIds.size === 1) {
    // One supplier is certain for some product; the receipt is that supplier's if nothing else contradicts it.
    const s = firm[0]
    return products.every((p) => fitOf(p, s.supplierId, ctx) !== 'incompatible') ? { kind: 'AUTO', candidate: s, because: 'product' } : { kind: 'AMBIGUOUS', candidates: dedupe(firm.concat(products.flatMap((p) => candidatesFor(p, ctx)))) }
  }
  if (firmIds.size > 1) return { kind: 'AMBIGUOUS', candidates: dedupe(firm) }
  // No product is firm: the supplier every product can come from, best evidence first.
  const shared = intersect(products.map((p) => candidatesFor(p, ctx)))
  if (shared.length === 1) return { kind: 'SUGGEST', candidate: shared[0], because: bestEvidence(shared[0]), others: [] }
  if (shared.length > 1) return each.length === 1 ? each[0] : { kind: 'AMBIGUOUS', candidates: shared }
  return each.length === 1 ? each[0] : { kind: 'NO_MATCH' }
}

function bestEvidence(c: Candidate): Evidence {
  return [...c.evidence].sort((a, b) => RANK[b] - RANK[a])[0]
}

function dedupe(cs: Candidate[]): Candidate[] {
  const m = new Map<string, Candidate>()
  for (const c of cs) if (!m.has(c.supplierId)) m.set(c.supplierId, c)
  return rank([...m.values()])
}

function intersect(lists: Candidate[][]): Candidate[] {
  if (!lists.length) return []
  const [first, ...rest] = lists
  return rank(first.filter((c) => rest.every((l) => l.some((x) => x.supplierId === c.supplierId))))
}

/** Products on the receipt that do not fit the chosen supplier, with where each is normally bought. */
export function conflictsWith(supplierId: string, productIds: readonly string[], ctx: ResolveContext): Conflict[] {
  const out: Conflict[] = []
  for (const id of productIds) {
    const p = ctx.products.find((x) => x.id === id)
    if (!p || fitOf(p, supplierId, ctx) !== 'incompatible') continue
    out.push({ productId: p.id, productName: p.name, fit: 'incompatible', mappedTo: candidatesFor(p, ctx).filter((c) => c.evidence.includes('product') || c.evidence.includes('alternate')) })
  }
  return out
}

/**
 * Search order once a supplier is chosen: its own products, then its alternates, then what was
 * received from it before, then the rest. Higher sorts first. Nothing is hidden.
 */
export function supplierRank(supplierId: string, ctx: ResolveContext): (p: Product) => number {
  const received = new Set(ctx.movements.filter((m) => !m.voided && m.type === 'receive' && m.supplierId === supplierId).map((m) => m.productId))
  return (p) => (p.supplierId === supplierId ? 3 : (p.alternateSupplierIds ?? []).includes(supplierId) ? 2 : received.has(p.id) ? 1 : 0)
}

// ---------------------------------------------------------------- data quality ----

export type SupplierIssue =
  | { kind: 'noSupplier'; productId: string }
  | { kind: 'inactiveSupplier'; productId: string; supplierId: string }
  | { kind: 'unknownSupplier'; productId: string; supplierId: string }
  | { kind: 'alternatesWithoutUsual'; productId: string }
  | { kind: 'frequentOverride'; productId: string; suggested: string; chosen: string; times: number }

/** Mapping problems worth a person's look (for the Data Quality Center). Pure; no reads. */
export function supplierIssues(ctx: ResolveContext, overrides: readonly OverrideEvent[] = [], minOverrides = 3): SupplierIssue[] {
  const out: SupplierIssue[] = []
  for (const p of ctx.products) {
    if (p.active === false) continue
    const alts = p.alternateSupplierIds ?? []
    if (!p.supplierId && !alts.length) out.push({ kind: 'noSupplier', productId: p.id })
    if (!p.supplierId && alts.length > 1) out.push({ kind: 'alternatesWithoutUsual', productId: p.id })
    for (const id of [p.supplierId, ...alts].filter((x): x is string => !!x)) {
      const s = ctx.suppliers.find((x) => x.id === id)
      if (!s) out.push({ kind: 'unknownSupplier', productId: p.id, supplierId: id })
      else if (s.active === false) out.push({ kind: 'inactiveSupplier', productId: p.id, supplierId: id })
    }
  }
  const counts = new Map<string, OverrideEvent & { times: number }>()
  for (const o of overrides) {
    const k = `${o.productId}|${o.suggested}|${o.chosen}`
    counts.set(k, { ...o, times: (counts.get(k)?.times ?? 0) + 1 })
  }
  for (const c of counts.values()) if (c.times >= minOverrides) out.push({ kind: 'frequentOverride', productId: c.productId, suggested: c.suggested, chosen: c.chosen, times: c.times })
  return out
}

/** A person chose a different supplier than the one suggested. Kept as a signal; never applied. */
export interface OverrideEvent {
  productId: string
  suggested: string
  chosen: string
  at: number
}
