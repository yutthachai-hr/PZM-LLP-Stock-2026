/**
 * Firestore documents → shadow PostgreSQL rows (Supabase shadow foundation, 7 Oct 2026).
 *
 * Pure: no database here. The backfill (from a backup file) and the outbox replicator (from
 * committed events) both go through these functions, so a record lands the same way
 * whichever route brought it. Ids are the Firestore ids; nothing is renamed or re-keyed.
 * Unmodelled fields survive in `doc`.
 *
 * Not imported by the app — this code runs in the cron Worker and in local tools only.
 */

export type Brand = 'pizza' | 'lelapin' | 'rnd'
type Doc = Record<string, unknown>

/** One row to write. `versioned`: only when its version is not older than the stored one. */
export interface Upsert {
  table: string
  pk: string[]
  row: Record<string, unknown>
  versioned?: boolean
  /** Columns that keep their stored value when this row brings null (several sources fill them). */
  coalesce?: string[]
  /** Insert only; an existing row is left as it is. */
  insertOnly?: boolean
}

/** Child rows of a parent, replaced as a set (PO lines, transfer items …). */
export interface ChildSet {
  table: string
  parent: Record<string, unknown>
  rows: Record<string, unknown>[]
}

export interface Plan {
  upserts: Upsert[]
  children: ChildSet[]
}

/** The tables, in an order that satisfies foreign keys. */
export const ENTITY_ORDER = [
  'users',
  'locations',
  'suppliers',
  'products',
  'supplierItems',
  'productAliases',
  'purchaseRequests',
  'purchaseOrders',
  'stockMovements',
  'stockLevels',
  'transfers',
] as const
export type Entity = (typeof ENTITY_ORDER)[number]

const iso = (v: unknown): string | null => (typeof v === 'number' && Number.isFinite(v) ? new Date(v).toISOString() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const bool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const versionOf = (d: Doc): number => num(d.updatedAt) ?? num(d.createdAt) ?? 0

/** Bangkok calendar day of an epoch-ms business date, as YYYY-MM-DD. */
export function bkkDay(ms: unknown): string | null {
  const n = num(ms)
  if (n === null) return null
  return new Date(n + 7 * 3_600_000).toISOString().slice(0, 10)
}

/** The unit part of a stock-level id (`loc__product#Pack` → `Pack`), '' for the product's own. */
export function unitKeyOf(levelId: string): string {
  const i = levelId.indexOf('#')
  return i === -1 ? '' : levelId.slice(i + 1)
}

/** The balance a movement row files under, by the engine's rule (src/lib/levelKey.ts filedUnit). */
export function movementUnitKey(m: Doc): string {
  const entry = typeof m.entryUnit === 'string' ? m.entryUnit.trim() : ''
  const legacy = entry !== '' && m.entryQty === undefined
  return legacy && entry !== String(m.unit ?? '').trim() ? entry : ''
}

export function mapDoc(entity: Entity, brand: Brand, d: Doc): Plan {
  const id = String(d.id)
  const b = { brand, id }
  const v = versionOf(d)
  const one = (table: string, row: Record<string, unknown>, extra: Partial<Upsert> = {}): Plan => ({
    upserts: [{ table, pk: ['brand', 'id'], row: { ...b, ...row, version: v, doc: d }, versioned: true, ...extra }],
    children: [],
  })

  switch (entity) {
    case 'users':
      return {
        upserts: [{
          table: 'app_users',
          pk: ['uid'],
          row: {
            uid: id, name: String(d.name ?? ''), email: str(d.email), role: ['admin', 'manager', 'staff'].includes(String(d.role)) ? d.role : 'staff',
            active: bool(d.active, false), site_ids: arr(d.siteIds).map(String), created_at: iso(d.createdAt), doc: d,
          },
        }],
        children: [],
      }
    case 'locations':
      return one('locations', { name: String(d.name ?? ''), name_en: str(d.nameEn), type: d.type === 'transit' || id === 'transit' ? 'transit' : d.type === 'branch' ? 'branch' : 'warehouse', active: bool(d.active, true), created_at: iso(d.createdAt) })
    case 'suppliers':
      return one('suppliers', {
        code: str(d.code), name: String(d.name ?? ''), type: str(d.type), lead_time_days: num(d.leadTimeDays),
        order_days: Array.isArray(d.orderDays) ? d.orderDays.filter((x) => Number.isInteger(x)) : null, cutoff_time: str(d.cutoffTime),
        active: bool(d.active, true), created_at: iso(d.createdAt), updated_at: iso(d.updatedAt),
      })
    case 'products': {
      const p = one('products', {
        sku: String(d.sku ?? ''), barcode: str(d.barcode), name: String(d.name ?? ''), category: str(d.category), unit_label: str(d.unit),
        base_unit: String(d.unitType ?? d.unit ?? ''), min_stock: num(d.minStock) ?? 0, supplier_id: str(d.supplierId), cost: num(d.cost),
        active: bool(d.active, true), created_at: iso(d.createdAt), updated_at: iso(d.updatedAt),
      })
      p.children.push({
        table: 'unit_conversions',
        parent: { brand, product_id: id },
        rows: arr(d.unitConversions)
          .filter((c): c is Doc => !!c && typeof c === 'object' && typeof (c as Doc).label === 'string' && Number(((c as Doc).size)) > 0)
          // One rate per label: the engine reads the first one it finds (lib/inventoryRules/uom.ts).
          .filter((c, i, all) => all.findIndex((x) => (x as Doc).label === c.label) === i)
          .map((c) => ({ brand, product_id: id, label: c.label, size: c.size, per: num(c.per), of_unit: str(c.of) })),
      })
      return p
    }
    case 'supplierItems':
      return one('supplier_products', { supplier_id: String(d.supplierId ?? ''), product_id: String(d.productId ?? ''), buying_price: num(d.buyingPrice), min_order_qty: num(d.minOrderQty), active: bool(d.active, true), updated_at: iso(d.updatedAt) })
    case 'productAliases':
      return {
        upserts: [{ table: 'product_aliases', pk: ['brand', 'id'], row: { ...b, key: String(d.key ?? ''), source_name: str(d.sourceName), product_id: String(d.productId ?? ''), created_by: str(d.createdBy), created_at: iso(d.createdAt), doc: d } }],
        children: [],
      }
    case 'purchaseRequests': {
      const p = one('purchase_requests', {
        doc_no: String(d.docNo ?? ''), status: d.status, revision: num(d.revision) ?? 0, location_id: str(d.locationId), requested_by: str(d.requestedBy),
        approved_by: str(d.approvedBy), approved_at: iso(d.approvedAt), created_at: iso(d.createdAt), updated_at: iso(d.updatedAt),
      })
      p.children.push({
        table: 'purchase_request_lines',
        parent: { brand, request_id: id },
        rows: arr(d.items).map((it, i) => {
          const x = it as Doc
          return {
            brand, request_id: id, line_no: num(x.idx) ?? i, product_id: String(x.productId ?? ''), supplier_id: str(x.supplierId), unit: str(x.unit),
            entry_unit: str(x.entryUnit), requested_qty: num(x.requestedQty), approved_qty: num(x.approvedQty), removed: !!x.removed,
          }
        }),
      })
      return p
    }
    case 'purchaseOrders': {
      const p = one('purchase_orders', {
        doc_no: String(d.docNo ?? ''), supplier_id: String(d.supplierId ?? ''), supplier_name: str(d.supplierName), status: d.status,
        location_id: String(d.locationId ?? ''), request_id: str(d.requestId), ordered_at: iso(d.orderedAt), expected_at: iso(d.expectedAt),
        received_at: iso(d.receivedAt), revision: num(d.revision) ?? 0, created_by: str(d.createdBy), created_at: iso(d.createdAt), updated_at: iso(d.updatedAt),
      })
      p.children.push({
        table: 'purchase_order_lines',
        parent: { brand, po_id: id },
        rows: arr(d.lines).map((l, i) => {
          const x = l as Doc
          return {
            brand, po_id: id, line_no: i, product_id: String(x.productId ?? ''), unit: String(x.unit ?? ''), entry_unit: str(x.entryUnit),
            ordered_qty: num(x.orderedQty) ?? 0, base_qty: num(x.baseQty), received_qty: num(x.receivedQty) ?? 0,
          }
        }),
      })
      // The receipts this order lists: tie each stock document to the order (and its receipt id).
      const listed = arr(d.receipts).map((r) => r as Doc).filter((r) => typeof r.docNo === 'string')
      if (!listed.length && typeof d.movementDocNo === 'string') listed.push({ docNo: d.movementDocNo })
      for (const r of listed) {
        p.upserts.push({
          table: 'receipts', pk: ['brand', 'doc_no'], coalesce: ['receipt_id', 'po_id', 'supplier_id', 'invoice_no', 'business_date', 'created_by', 'created_at'],
          row: { brand, doc_no: r.docNo, receipt_id: str(r.receiptId), po_id: id, supplier_id: str(d.supplierId), invoice_no: str(r.invoiceNo), business_date: bkkDay(r.date), created_by: str(r.byId), created_at: null },
        })
      }
      return p
    }
    case 'stockMovements': {
      const p = one('stock_movements', {
        doc_no: String(d.docNo ?? ''), type: d.type, product_id: String(d.productId ?? ''), unit: String(d.unit ?? ''), entry_unit: str(d.entryUnit),
        entry_qty: num(d.entryQty), qty: num(d.qty) ?? 0, from_location: str(d.fromLocationId), to_location: str(d.toLocationId), reason: str(d.reason),
        po_id: str(d.poId), transfer_id: str(d.transferId), invoice_no: str(d.invoiceNo), business_date: bkkDay(d.date), occurred_ms: num(d.date) ?? 0,
        created_by: str(d.byUserId), created_at: iso(d.createdAt), updated_at: iso(d.updatedAt), voided: !!d.voided,
      })
      if (d.type === 'receive') {
        p.upserts.push({
          table: 'receipts', pk: ['brand', 'doc_no'], coalesce: ['receipt_id', 'po_id', 'supplier_id', 'invoice_no', 'business_date', 'created_by', 'created_at'],
          row: { brand, doc_no: d.docNo, receipt_id: id.startsWith('rc_') ? id.replace(/_\d+$/, '') : null, po_id: str(d.poId), supplier_id: str(d.supplierId), invoice_no: str(d.invoiceNo), business_date: bkkDay(d.date), created_by: str(d.byUserId), created_at: iso(d.createdAt) },
        })
        p.upserts.push({
          table: 'receipt_lines', pk: ['brand', 'doc_no', 'movement_id'],
          row: { brand, doc_no: d.docNo, movement_id: id, product_id: String(d.productId ?? ''), qty_base: num(d.qty) ?? 0, qty_entry: num(d.entryQty), entry_unit: str(d.entryUnit) },
        })
      }
      return p
    }
    case 'stockLevels':
      return {
        upserts: [{
          table: 'stock_balances', pk: ['brand', 'location_id', 'product_id', 'unit_key'], versioned: true,
          row: { brand, location_id: String(d.locationId ?? ''), product_id: String(d.productId ?? ''), unit_key: unitKeyOf(id), qty: num(d.qty) ?? 0, updated_at: iso(d.updatedAt), version: v },
        }],
        children: [],
      }
    case 'transfers': {
      const p = one('transfers', {
        doc_no: String(d.docNo ?? ''), status: String(d.status ?? ''), from_location: String(d.fromLocationId ?? ''), to_location: String(d.toLocationId ?? ''),
        parent_id: str(d.parentId), dispatch_date: iso(d.dispatchDate), created_at: iso(d.createdAt), updated_at: iso(d.updatedAt),
      })
      p.children.push({
        table: 'transfer_lines',
        parent: { brand, transfer_id: id },
        rows: arr(d.items).map((it, i) => {
          const x = it as Doc
          return {
            brand, transfer_id: id, line_no: num(x.idx) ?? i, product_id: String(x.productId ?? ''), unit: str(x.unit), requested_qty: num(x.requestedQty),
            dispatch_qty: num(x.dispatchQty) ?? 0, received_qty: num(x.receivedQty), in_transit_qty: num(x.inTransitQty) ?? 0, removed: !!x.removed,
          }
        }),
      })
      return p
    }
  }
}

/** The backup file's collection for each entity (brand-free names, as backup.ts writes them). */
export const BACKUP_COLLECTION: Record<Entity, string> = {
  users: 'users',
  locations: 'locations',
  suppliers: 'suppliers',
  products: 'products',
  supplierItems: 'supplierItems',
  productAliases: 'productAliases',
  purchaseRequests: 'purchaseRequests',
  purchaseOrders: 'purchaseOrders',
  stockMovements: 'stockMovements',
  stockLevels: 'stockLevels',
  transfers: 'transfers',
}
