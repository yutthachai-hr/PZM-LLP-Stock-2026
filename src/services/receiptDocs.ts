import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { mergeKey } from '../lib/supplierName'
import { COL, type PurchaseOrder, type StockMovement } from '../types'

/**
 * A supplier's bill that is already on the books.
 *
 * The owner's rule (24 Sep 2026): the same bill must never be taken into stock twice without
 * a warning. "The same bill" is the same number from the same supplier — two suppliers may
 * well print the same number.
 */
export interface DuplicateDoc {
  /** The stock receipt it was filed as (RC-…). */
  docNo?: string
  /** The day that receipt is filed under. */
  date?: number
  supplierName?: string
  /** The purchase order it checked in, when it came from one. */
  poId?: string
  poDocNo?: string
}

function scoped() {
  return backend.forBrand(getBrand())
}

/** Loose supplier match: the id when both sides have one, otherwise the name as merged. */
function sameSupplier(
  a: { supplierId?: string; supplierName?: string },
  b: { supplierId?: string; supplierName?: string },
): boolean {
  if (a.supplierId && b.supplierId) return a.supplierId === b.supplierId
  if (a.supplierName && b.supplierName) return mergeKey(a.supplierName) === mergeKey(b.supplierName)
  return false
}

/**
 * The receipt this bill number was already filed under, for this supplier — or null.
 *
 * Two places hold bill numbers: every receipt row since 24 Sep 2026 (`invoiceNo` on the
 * movement), and every purchase order received before then (`invoiceNo` on the order). Each
 * is one equality query — a handful of reads, and nothing at all when the number is new. A
 * bill keyed by hand before 24 Sep 2026 has its number inside a free-text note, which no
 * query can find; the screen says so rather than claim a check it cannot make.
 */
export async function findDuplicateDocument(params: {
  invoiceNo: string
  supplierId?: string
  supplierName?: string
}): Promise<DuplicateDoc | null> {
  const invoiceNo = params.invoiceNo.trim()
  if (!invoiceNo) return null
  const who = { supplierId: params.supplierId?.trim() || undefined, supplierName: params.supplierName?.trim() || undefined }
  if (!who.supplierId && !who.supplierName) return null
  const db = scoped()
  // People type "iv-1001" for "IV-1001"; equality is exact, so ask both ways when they differ.
  const spellings = [...new Set([invoiceNo, invoiceNo.toUpperCase()])]

  for (const n of spellings) {
    const rows = await db.getBy<StockMovement>(COL.movements, 'invoiceNo', n)
    const hit = rows
      .filter((m) => m.type === 'receive' && !m.voided && sameSupplier(m, who))
      .sort((a, b) => b.date - a.date)[0]
    if (hit) {
      return { docNo: hit.docNo, date: hit.date, supplierName: hit.supplierName, poId: hit.poId, poDocNo: hit.poDocNo }
    }
  }
  for (const n of spellings) {
    const orders = await db.getBy<PurchaseOrder>(COL.purchaseOrders, 'invoiceNo', n)
    const hit = orders.find((o) => o.movementDocNo && sameSupplier(o, who))
    if (hit) {
      return { docNo: hit.movementDocNo, date: hit.receivedAt, supplierName: hit.supplierName, poId: hit.id, poDocNo: hit.docNo }
    }
  }
  return null
}
