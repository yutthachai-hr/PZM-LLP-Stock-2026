/**
 * The top bar's global search (early release, Phase 3): one box for pages, products, places,
 * suppliers and document numbers, grouped, from what the app already holds in memory.
 *
 * It never reads the database. So it can only find what is loaded, and it says so: suppliers
 * appear once a screen has read them this session; documents come from the stock movements
 * in the loaded window (receipts, issues, adjustments and the POs they received against).
 * Purchase requests and transfers are not held anywhere global, so a search for them offers
 * their page, never an empty "nothing found" that would read as "there is none".
 */
import type { NavItem } from '../components/nav/navItems'
import type { Product, StockLocation, StockMovement, Supplier } from '../types'
import { looseScore } from './search'
import { searchFields } from './barcode'

export type SearchGroup = 'pages' | 'products' | 'locations' | 'suppliers' | 'documents'

export interface SearchHit {
  group: SearchGroup
  key: string
  /** Where Enter goes: an app path with its deep-link parameter. */
  to: string
  label: string
  sub?: string
  /** A product's id, for its thumbnail and stock total. */
  productId?: string
}

export interface SearchSources {
  pages: readonly NavItem[]
  products: readonly Product[]
  locations: readonly StockLocation[]
  /** `null` = not loaded this session, so not searched (never a read from here). */
  suppliers: readonly Supplier[] | null
  movements: readonly StockMovement[]
  /** Translate a page label (t). */
  label: (key: string) => string
}

export interface SearchResult {
  hits: SearchHit[]
  /** Groups that hit their cap: there may be more than shown. */
  capped: SearchGroup[]
  suppliersSearched: boolean
}

export const MIN_QUERY = 2
const CAP: Record<SearchGroup, number> = { pages: 4, products: 6, locations: 4, suppliers: 4, documents: 5 }
export const GROUP_ORDER: SearchGroup[] = ['pages', 'products', 'documents', 'suppliers', 'locations']

function top<T>(rows: readonly T[], score: (r: T) => number, cap: number): { rows: T[]; capped: boolean } {
  const scored = rows.map((r) => ({ r, s: score(r) })).filter((x) => x.s > 0)
  scored.sort((a, b) => b.s - a.s)
  return { rows: scored.slice(0, cap).map((x) => x.r), capped: scored.length > cap }
}

export function globalSearch(query: string, src: SearchSources): SearchResult {
  const q = query.trim()
  const out: SearchResult = { hits: [], capped: [], suppliersSearched: src.suppliers !== null }
  if (q.length < MIN_QUERY) return out
  const add = (group: SearchGroup, found: { rows: SearchHit[]; capped: boolean }) => {
    out.hits.push(...found.rows)
    if (found.capped) out.capped.push(group)
  }

  // Pages: both languages match, so "receive" finds รับสินค้าเข้า on a Thai screen.
  const pages = top(src.pages, (n) => looseScore([src.label(n.label), n.label, n.to.replace(/\//g, ' ')], q), CAP.pages)
  add('pages', { capped: pages.capped, rows: pages.rows.map((n) => ({ group: 'pages', key: `page:${n.to}`, to: n.to, label: src.label(n.label) })) })

  const products = top(
    src.products.filter((p) => p.active !== false),
    (p) => looseScore(searchFields(p), q),
    CAP.products,
  )
  add('products', {
    capped: products.capped,
    rows: products.rows.map((p) => ({ group: 'products', key: `product:${p.id}`, to: `/products/${encodeURIComponent(p.id)}/card`, label: p.name, sub: p.sku, productId: p.id })),
  })

  // Document numbers seen in the loaded movements: one hit per document, newest first.
  const docs = new Map<string, SearchHit & { at: number; s: number }>()
  for (const m of src.movements) {
    const s = looseScore([m.docNo, m.invoiceNo], q)
    if (s > 0 && m.docNo) {
      const was = docs.get(`doc:${m.docNo}`)
      if (!was || m.createdAt > was.at)
        docs.set(`doc:${m.docNo}`, { group: 'documents', key: `doc:${m.docNo}`, to: `/movements?doc=${encodeURIComponent(m.docNo)}`, label: m.docNo, sub: [m.supplierName, m.invoiceNo].filter(Boolean).join(' · ') || undefined, at: m.createdAt, s })
    }
    const ps = m.poId && m.poDocNo ? looseScore([m.poDocNo], q) : 0
    if (ps > 0) {
      const was = docs.get(`po:${m.poId}`)
      if (!was || m.createdAt > was.at)
        docs.set(`po:${m.poId}`, { group: 'documents', key: `po:${m.poId}`, to: `/orders?po=${encodeURIComponent(m.poId!)}`, label: m.poDocNo!, sub: m.supplierName, at: m.createdAt, s: ps })
    }
  }
  const docRows = [...docs.values()].sort((a, b) => b.s - a.s || b.at - a.at)
  add('documents', {
    capped: docRows.length > CAP.documents,
    rows: docRows.slice(0, CAP.documents).map(({ at: _at, s: _s, ...hit }) => hit),
  })

  if (src.suppliers) {
    const sups = top(src.suppliers, (s) => looseScore([s.name, s.code, s.contactName, s.contactNumber], q), CAP.suppliers)
    add('suppliers', {
      capped: sups.capped,
      rows: sups.rows.map((s) => ({ group: 'suppliers', key: `supplier:${s.id}`, to: `/suppliers?id=${encodeURIComponent(s.id)}`, label: s.name, sub: s.code })),
    })
  }

  const places = top(
    src.locations.filter((l) => l.active !== false),
    (l) => looseScore([l.name, l.nameEn], q),
    CAP.locations,
  )
  add('locations', {
    capped: places.capped,
    rows: places.rows.map((l) => ({ group: 'locations', key: `location:${l.id}`, to: `/movements?location=${encodeURIComponent(l.id)}`, label: l.name })),
  })

  out.hits.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  return out
}
