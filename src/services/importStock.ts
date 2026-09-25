import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import type { ParsedSheet, SheetColumn } from '../lib/stockSheet'
import { COL, type Product, type StockLocation, type StockMovement } from '../types'
import { QTY_MAX, roundQty } from '../lib/validate'
import { balanceBefore } from '../lib/ledger'
import { bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { postCountAsOf } from './stock'

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
  /**
   * What the books said at the end of the count day, earlier postings in the same plan
   * included. The import files `targetQty - asOfQty` on `date`. Set by buildImportPlan.
   */
  asOfQty: number
  excelRow: number
}

/** The latest count of a product at a location — the one thing a count cannot go behind. */
export interface LastCount {
  date: number
}

/**
 * The whole ledger, read once, the way buildBackup() does. This runs monthly, by an admin,
 * and the alternative is a read per posting.
 *
 * Each count is compared with what the books said at the end of ITS day (lib/ledger
 * `balanceBefore`), and posted as that difference on that day. So receipts, issues and
 * transfers filed after the count date are no reason to refuse it any more: they stay on
 * top of the corrected figure. (Until 25 Sep 2026 a count set the balance to its figure
 * NOW, so any later movement had to block it — which blocked exactly the busiest items.)
 */
export async function loadLedger(): Promise<StockMovement[]> {
  const db = backend.forBrand(getBrand())
  return (await db.getAll<StockMovement>(COL.movements)) ?? []
}

/**
 * The latest count per product and location. A count on the same day or later means the
 * file has already been loaded, or an older file is being loaded over a newer one; posting
 * behind it would move the balance that count already agreed.
 */
export function lastCounts(ledger: readonly StockMovement[]): Map<string, LastCount> {
  const latest = new Map<string, LastCount>()
  for (const m of ledger) {
    if (m.voided || m.type !== 'adjust' || m.reason !== 'opening') continue
    const at = m.toLocationId ?? m.fromLocationId
    if (!at) continue
    const key = countKey(at, m.productId)
    const known = latest.get(key)
    if (!known || known.date < m.date) latest.set(key, { date: m.date })
  }
  return latest
}

/** Every row that touches a product at a location, both ends of a transfer included. */
function rowsByKey(ledger: readonly StockMovement[]): Map<string, StockMovement[]> {
  const out = new Map<string, StockMovement[]>()
  const put = (locationId: string, m: StockMovement) => {
    const key = countKey(locationId, m.productId)
    const list = out.get(key)
    if (list) list.push(m)
    else out.set(key, [m])
  }
  for (const m of ledger) {
    if (m.voided) continue
    if (m.fromLocationId) put(m.fromLocationId, m)
    if (m.toLocationId) put(m.toLocationId, m)
  }
  return out
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
   * Counts with a count already on the books at that product and location on the same day
   * or later — the file was loaded before, or an older file is going in over a newer one.
   */
  superseded: { posting: Posting; by: LastCount }[]
  /**
   * Counts the books already agreed with at the end of their day. Nothing moved, so the
   * ledger records nothing — separated out so the summary promises the number of movements
   * it will actually write.
   */
  unchanged: Posting[]
  /**
   * Postings (a subset of `postings`) whose product moved at that location after the count
   * day. They are posted as the difference from that day's balance, so what came later
   * stays — listed so the person importing can see it was taken into account.
   */
  movedSince: Posting[]
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
 *  - **A count is compared with its own day, never with today.** `ledger` is every movement
 *    (loadLedger); each posting carries `asOfQty`, the balance at the end of the count day,
 *    and the import files the difference on that day.
 */
export function buildImportPlan(
  sheet: ParsedSheet,
  mapping: SheetMapping,
  products: Product[],
  locations: StockLocation[],
  ledger: readonly StockMovement[] = [],
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
          asOfQty: 0,
          excelRow: row.excelRow,
        })
      }
    }
  }

  // Drop the postings a later duplicate invalidated.
  const usable = postings.filter((p) => !Number.isNaN(p.targetQty))
  const counted = lastCounts(ledger)
  const staleAgainst = (p: Posting): LastCount | null => {
    const last = counted.get(countKey(p.locationId, p.productId))
    return last && last.date >= p.date ? last : null
  }
  const superseded: { posting: Posting; by: LastCount }[] = []
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

  // Walk the plan in the order it will be filed and give every count the balance it will
  // meet at the end of its own day: the ledger up to then, plus the differences this plan
  // files earlier at the same place. Counts that find nothing to change are set aside —
  // no movement is written for those, so counting them as work would make the summary
  // promise more than the import delivers ("615 to write" followed by "540 written" reads
  // as a failure rather than as two counts agreeing).
  const rows = rowsByKey(ledger)
  const planned = new Map<string, { date: number; delta: number }[]>()
  const unchanged: Posting[] = []
  const movedSince: Posting[] = []
  const kept: Posting[] = []
  for (const p of toPost) {
    const key = countKey(p.locationId, p.productId)
    const end = bkkDayStart(p.date) + DAY_MS
    const scope = { productId: p.productId, locationId: p.locationId }
    const here = rows.get(key) ?? []
    const earlier = (planned.get(key) ?? []).reduce((s, x) => (x.date < end ? s + x.delta : s), 0)
    const asOfQty = roundQty(balanceBefore(here, scope, end) + earlier)
    if (asOfQty === p.targetQty) {
      unchanged.push({ ...p, asOfQty })
      continue
    }
    const posting = { ...p, asOfQty }
    planned.set(key, [...(planned.get(key) ?? []), { date: p.date, delta: roundQty(p.targetQty - asOfQty) }])
    if (here.some((m) => m.date >= end)) movedSince.push(posting)
    kept.push(posting)
  }

  return {
    postings: kept,
    superseded,
    unchanged,
    movedSince,
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
 * Sequential and in date order, one transaction per posting, each filing the difference the
 * plan worked out on the count's own date. A second run of the same FILE is a no-op because
 * the plan is rebuilt from the ledger and finds the counts already there (`superseded`);
 * the same PLAN object must not be applied twice.
 *
 * A posting that fails does not stop the rest. The ones that went in are real counts and
 * are worth keeping; the failures come back named, so they can be looked at. A later count
 * of the same item was planned on top of the failed one's difference, so that difference
 * is taken back out of its starting figure.
 */
export async function applyImportPlan(
  plan: ImportPlan,
  actor: Actor,
  note: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { posted: 0, unchanged: 0, failed: [] }
  const missed = new Map<string, { date: number; delta: number }[]>()
  const total = plan.postings.length
  for (let i = 0; i < total; i++) {
    const p = plan.postings[i]
    const key = countKey(p.locationId, p.productId)
    const end = bkkDayStart(p.date) + DAY_MS
    const notFiled = (missed.get(key) ?? []).reduce((s, x) => (x.date < end ? s + x.delta : s), 0)
    try {
      const wrote = await postCountAsOf({
        productId: p.productId,
        productName: p.productName,
        unit: p.unit,
        locationId: p.locationId,
        countedQty: p.targetQty,
        asOfQty: roundQty(p.asOfQty - notFiled),
        actor,
        note,
        date: p.date,
      })
      if (wrote) result.posted++
      else result.unchanged++
    } catch (e) {
      result.failed.push({ posting: p, error: e })
      missed.set(key, [...(missed.get(key) ?? []), { date: p.date, delta: roundQty(p.targetQty - p.asOfQty) }])
    }
    onProgress?.(i + 1, total)
  }
  return result
}
