import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import type { ParsedSheet, SheetColumn } from '../lib/stockSheet'
import { COL, type Product, type StockLocation, type StockMovement } from '../types'
import { QTY_MAX, roundQty } from '../lib/validate'
import { setStockCount } from './stock'

// ============================================================================
// Turns a parsed closing-stock sheet into stock counts, in two steps.
//
// Everything is decided in buildImportPlan() before a single write happens, the same way
// parseBackup() validates a whole backup file before restoreBackup() touches anything. An
// import that gets halfway and stops leaves the warehouse in a state nobody chose, and the
// person running it has no way to tell which half went in.
//
// The plan is also what the preview screen shows. What you approve is literally what runs.
// ============================================================================

export interface Actor {
  id: string
  name: string
}

/** One location column on the sheet, pointed at a location in the app. */
export interface ColumnMapping extends SheetColumn {
  /** null means "do not import this column". */
  locationId: string | null
}

/** One counting date on the sheet. */
export interface SnapshotMapping {
  label: string
  /** Business date of the count. Guessed from the label, confirmed by whoever imports. */
  date: number
  include: boolean
  columns: ColumnMapping[]
}

export interface SheetMapping {
  sheetName: string
  snapshots: SnapshotMapping[]
}

/** One balance to set: this product, at this location, on this date. */
export interface Posting {
  date: number
  snapshotLabel: string
  locationId: string
  locationName: string
  productId: string
  sku: string
  productName: string
  /** The product's own unit — what the movement is recorded in. */
  unit: string
  /** The unit written on the sheet, kept so a disagreement can be shown. */
  sheetUnit: string
  targetQty: number
  excelRow: number
}

/** What last happened to a product at a location, and whether it was a count or a move. */
export interface LastActivity {
  date: number
  kind: 'count' | 'movement'
}

/**
 * The most recent thing that happened to each product at each location.
 *
 * A stock count says "the shelf holds exactly this". Applying one sets the balance to that
 * figure **now**, whatever date is written on it — so a count can only be applied while
 * nothing has moved that item since it was taken. Otherwise the count silently undoes
 * everything that happened in between: importing the August sheet in November sets the
 * balance back to what August found and quietly erases September and October's receipts
 * from it.
 *
 * That is why this looks at every movement and not only at previous counts. Two different
 * refusals come out of it, and the difference matters to whoever is importing:
 *
 *  - a later **count** means the file has already been loaded, or an older file is being
 *    loaded over a newer one — usually nothing to worry about;
 *  - a later **movement** means the sheet is stale relative to the warehouse, which is a
 *    reason to stop and look rather than to shrug.
 *
 * Reads the ledger once, the way buildBackup() does. This runs monthly, by an admin, and
 * the alternative is a read per posting.
 */
export async function loadLastActivity(): Promise<Map<string, LastActivity>> {
  const db = backend.forBrand(getBrand())
  const movements = await db.getAll<StockMovement>(COL.movements)
  const latest = new Map<string, LastActivity>()
  const note = (locationId: string, productId: string, m: StockMovement) => {
    const key = countKey(locationId, productId)
    const known = latest.get(key)
    if (known && known.date >= m.date) return
    const kind = m.type === 'adjust' && m.reason === 'opening' ? 'count' : 'movement'
    latest.set(key, { date: m.date, kind })
  }
  for (const m of movements) {
    if (m.voided) continue
    // A transfer touches both ends, and a count at either one is equally stale afterwards.
    if (m.fromLocationId) note(m.fromLocationId, m.productId, m)
    if (m.toLocationId) note(m.toLocationId, m.productId, m)
  }
  return latest
}

export function countKey(locationId: string, productId: string): string {
  return `${locationId}|${productId}`
}

export type SkipReason =
  | 'noSku'
  | 'unknownSku'
  | 'inactive'
  | 'duplicate'
  | 'badQty'
  | 'negative'

/**
 * A row that carried quantities which are not being imported, and why.
 *
 * Reported per row rather than per cell: one unrecognised item is one thing for the owner
 * to look up, not nine identical lines because the sheet has nine columns.
 */
export interface SkippedRow {
  excelRow: number
  code: string
  name: string
  packSize: string
  reason: SkipReason
  /** How many quantities on this row are being dropped. */
  droppedCells: number
  /** Where those quantities were, e.g. 'SKV.23, Onnut.'. */
  where: string
  detail?: string
}

/** A product whose sheet unit disagrees with its unit in the catalog. */
export interface UnitWarning {
  sku: string
  productName: string
  sheetUnit: string
  productUnit: string
}

export interface ImportPlan {
  postings: Posting[]
  /**
   * Counts the ledger has already moved past — something happened to that product at that
   * location on the same day or later, so applying the count would overwrite a newer
   * balance with an older figure.
   */
  superseded: { posting: Posting; by: LastActivity }[]
  /**
   * Counts the balance already agrees with. Nothing moved, so the ledger records nothing —
   * separated out so the summary promises the number of movements it will actually write.
   */
  unchanged: Posting[]
  skipped: SkippedRow[]
  unitWarnings: UnitWarning[]
  /** Distinct products and locations the postings touch, for the summary. */
  productCount: number
  locationCount: number
}

function normUnit(u: string): string {
  return u.trim().toLowerCase().replace(/\s+/g, '')
}

interface Dropped {
  reason: SkipReason
  where: string[]
  detail?: string
}

/**
 * Decide what to post, and what to refuse.
 *
 * The rules that matter, and why:
 *
 *  - **A blank cell is not a zero.** It means nobody counted that item at that location on
 *    that date. Posting it as zero would wipe the balance of everything the counter did not
 *    walk past. An explicit 0 is a real count and is posted.
 *  - **An unknown code is never created.** SKUs come from the company's item-code workbook;
 *    inventing one here would put an item in the system that no purchase order can match.
 *  - **The same product counted twice at one place on one date is refused, not merged.** The
 *    sheet repeats some codes in its Work-in-Progress block, and there is no way to tell
 *    from the file whether that is the same stock listed again or a second stash. Summing
 *    would double it; keeping the last would lose the first. Both are wrong silently, so
 *    neither is posted.
 *  - **The unit comes from the catalog, not the sheet.** A count of 3 recorded against the
 *    wrong unit is a different quantity. Where the two disagree, the number is still posted
 *    against the catalog unit and the disagreement is reported.
 */
export function buildImportPlan(
  sheet: ParsedSheet,
  mapping: SheetMapping,
  products: Product[],
  locations: StockLocation[],
  lastActivity: ReadonlyMap<string, LastActivity> = new Map(),
  balances?: ReadonlyMap<string, number>,
): ImportPlan {
  const bySku = new Map<string, Product>()
  for (const p of products) {
    const key = p.sku.trim().toUpperCase()
    if (key && !bySku.has(key)) bySku.set(key, p)
  }
  const locationById = new Map(locations.map((l) => [l.id, l]))

  const postings: Posting[] = []
  const unitWarnings = new Map<string, UnitWarning>()
  // Row -> why its quantities were dropped. A row can only fail one way, except for
  // per-cell problems, which are collected under the first reason seen.
  const dropped = new Map<number, Dropped>()
  // (date, location, product) -> index into postings, to catch a second count of one thing.
  const seen = new Map<string, number>()

  function drop(row: number, reason: SkipReason, where: string, detail?: string) {
    const cur = dropped.get(row)
    if (cur) {
      cur.where.push(where)
      return
    }
    dropped.set(row, { reason, where: [where], detail })
  }

  const snapshots = mapping.snapshots
    .filter((s) => s.include)
    .slice()
    .sort((a, b) => a.date - b.date)

  for (const snap of snapshots) {
    for (const col of snap.columns) {
      if (!col.locationId) continue
      const location = locationById.get(col.locationId)
      if (!location) continue

      for (const row of sheet.rows) {
        const raw = row.cells[col.qtyCol]
        // Not counted here. Not a zero.
        if (raw === null || raw === undefined || raw === '') continue

        const where = `${snap.label} / ${col.header}`

        if (!row.hasSku) {
          drop(row.excelRow, 'noSku', where)
          continue
        }
        const product = bySku.get(row.code.toUpperCase())
        if (!product) {
          drop(row.excelRow, 'unknownSku', where)
          continue
        }
        if (product.active === false) {
          drop(row.excelRow, 'inactive', where)
          continue
        }

        const parsed = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''))
        if (!Number.isFinite(parsed) || parsed > QTY_MAX) {
          drop(row.excelRow, 'badQty', where, String(raw))
          continue
        }
        if (parsed < 0) {
          drop(row.excelRow, 'negative', where, String(raw))
          continue
        }
        // Rounded here, not just on the way in, so the preview shows the number that will
        // actually be stored rather than one the ledger will quietly change.
        const qty = roundQty(parsed)

        const key = `${snap.date}|${col.locationId}|${product.id}`
        const already = seen.get(key)
        if (already !== undefined) {
          const first = postings[already]
          drop(
            row.excelRow,
            'duplicate',
            where,
            `${first.targetQty} (แถว ${first.excelRow}) / ${qty} (แถว ${row.excelRow})`,
          )
          // The first one cannot stand either — it is only "first" because of sheet order.
          drop(first.excelRow, 'duplicate', where, undefined)
          postings[already].targetQty = Number.NaN
          continue
        }

        const sheetUnit = col.unitCol >= 0 ? String(row.cells[col.unitCol] ?? '').trim() : ''
        if (sheetUnit && normUnit(sheetUnit) !== normUnit(product.unitType)) {
          const wKey = `${product.sku}|${normUnit(sheetUnit)}`
          if (!unitWarnings.has(wKey)) {
            unitWarnings.set(wKey, {
              sku: product.sku,
              productName: product.name,
              sheetUnit,
              productUnit: product.unitType,
            })
          }
        }

        seen.set(key, postings.length)
        postings.push({
          date: snap.date,
          snapshotLabel: snap.label,
          locationId: col.locationId,
          locationName: location.name,
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          unit: product.unitType,
          sheetUnit,
          targetQty: qty,
          excelRow: row.excelRow,
        })
      }
    }
  }

  // Drop the postings a later duplicate invalidated.
  const usable = postings.filter((p) => !Number.isNaN(p.targetQty))
  const staleAgainst = (p: Posting): LastActivity | null => {
    const last = lastActivity.get(countKey(p.locationId, p.productId))
    return last && last.date >= p.date ? last : null
  }
  const superseded: { posting: Posting; by: LastActivity }[] = []
  const toPost: Posting[] = []
  for (const p of usable) {
    const by = staleAgainst(p)
    if (by) superseded.push({ posting: p, by })
    else toPost.push(p)
  }
  // Chronological: each count is a delta from the balance the previous one left, so they
  // have to go in the order they happened for the stock card to read correctly — and for
  // the simulation below to meet the same balances the import will.
  toPost.sort((a, b) => a.date - b.date || a.excelRow - b.excelRow)

  const rowByNumber = new Map(sheet.rows.map((r) => [r.excelRow, r]))
  const skipped: SkippedRow[] = [...dropped.entries()]
    .map(([excelRow, d]) => {
      const row = rowByNumber.get(excelRow)
      return {
        excelRow,
        code: row?.code ?? '',
        name: row?.name ?? '',
        packSize: row?.packSize ?? '',
        reason: d.reason,
        droppedCells: d.where.length,
        where: [...new Set(d.where)].join(', '),
        detail: d.detail,
      }
    })
    .sort((a, b) => a.excelRow - b.excelRow)

  superseded.sort(
    (a, b) => a.posting.date - b.posting.date || a.posting.excelRow - b.posting.excelRow,
  )

  // Walk the plan against the balances it will actually meet, in the order it will meet
  // them, and set aside the counts that will find nothing to change. setStockCount writes
  // no movement for those, so counting them as work would make the summary promise more
  // than the import delivers — and "615 to write" followed by "540 written" reads as a
  // failure rather than as two counts agreeing.
  const unchanged: Posting[] = []
  const kept: Posting[] = []
  if (balances) {
    const simulated = new Map(balances)
    for (const p of toPost) {
      const key = countKey(p.locationId, p.productId)
      const now = simulated.get(key) ?? 0
      if (roundQty(now) === p.targetQty) {
        unchanged.push(p)
        continue
      }
      simulated.set(key, p.targetQty)
      kept.push(p)
    }
  } else {
    kept.push(...toPost)
  }

  return {
    postings: kept,
    superseded,
    unchanged,
    skipped,
    unitWarnings: [...unitWarnings.values()],
    productCount: new Set(kept.map((p) => p.productId)).size,
    locationCount: new Set(kept.map((p) => p.locationId)).size,
  }
}

export interface ImportResult {
  /** Counts that changed a balance and wrote a movement. */
  posted: number
  /** Counts whose balance already matched — re-importing the same file lands here. */
  unchanged: number
  failed: { posting: Posting; error: unknown }[]
}

/**
 * Run a plan.
 *
 * Sequential rather than batched, because each count is a read-then-write of the same
 * balance: two postings for one product racing each other would both read the old value.
 * setStockCount is a transaction per posting, which is also what makes a second run of the
 * same file a no-op — every balance already matches, so nothing is written.
 *
 * A posting that fails does not stop the rest. The ones that went in are real counts and
 * are worth keeping; the failures come back named, so they can be looked at.
 */
export async function applyImportPlan(
  plan: ImportPlan,
  actor: Actor,
  note: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { posted: 0, unchanged: 0, failed: [] }
  const total = plan.postings.length
  for (let i = 0; i < total; i++) {
    const p = plan.postings[i]
    try {
      const wrote = await setStockCount({
        productId: p.productId,
        productName: p.productName,
        unit: p.unit,
        locationId: p.locationId,
        targetQty: p.targetQty,
        actor,
        note,
        date: p.date,
      })
      if (wrote) result.posted++
      else result.unchanged++
    } catch (e) {
      result.failed.push({ posting: p, error: e })
    }
    onProgress?.(i + 1, total)
  }
  return result
}
