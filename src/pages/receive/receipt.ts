import type { Line } from '../../components/LineBuilder'
import { roundQty } from '../../lib/validate'
import type { PurchaseOrder, PurchaseOrderLine } from '../../types'

/**
 * The receiving screen's arithmetic, kept out of the page so it can be tested.
 *
 * Owner, 24 Sep 2026: a delivery is checked against its purchase order — pick the order,
 * "รับครบตาม PO", fix the lines that differ, review, confirm. Everything here is measured
 * against what is still OUTSTANDING on the order (ordered, less every earlier delivery),
 * because a short delivery keeps the order open for the rest.
 */

export type Mode = 'po' | 'manual'

/** What was keyed against one order line on this delivery. `qty` null = not keyed yet. */
export interface PoLineEntry {
  qty: number | null
  reason: string
}

export type Variance = 'match' | 'short' | 'over' | 'pending'

/** What is still to come on a line. Never below zero. */
export function outstanding(line: Pick<PurchaseOrderLine, 'orderedQty' | 'receivedQty'>): number {
  return Math.max(0, roundQty(line.orderedQty - (line.receivedQty ?? 0)))
}

/** The order's lines still owed — the ones this delivery is checked against. */
export function owedLines(order: Pick<PurchaseOrder, 'lines'>): PurchaseOrderLine[] {
  return order.lines.filter((l) => outstanding(l) > 0)
}

/** How what arrived compares with what was still owed. */
export function variance(owed: number, qty: number | null): Variance {
  if (qty === null || !Number.isFinite(qty)) return 'pending'
  const q = roundQty(qty)
  return q === roundQty(owed) ? 'match' : q < owed ? 'short' : 'over'
}

/** "Receive all as ordered": every owed line as it was ordered. Reasons already typed stay. */
export function receiveAll(
  order: Pick<PurchaseOrder, 'lines'>,
  entries: Readonly<Record<string, PoLineEntry>>,
): Record<string, PoLineEntry> {
  const out: Record<string, PoLineEntry> = {}
  for (const l of owedLines(order)) out[l.productId] = { qty: outstanding(l), reason: entries[l.productId]?.reason ?? '' }
  return out
}

/** A line that differs from what was owed and says nothing about why. */
export function needsReason(owed: number, entry: PoLineEntry | undefined): boolean {
  const v = variance(owed, entry?.qty ?? null)
  return (v === 'short' || v === 'over') && !entry?.reason.trim()
}

export interface ReceiptSummary {
  items: number
  matched: number
  short: number
  over: number
  pending: number
  /** Lines that differ and have no reason yet. */
  unexplained: number
  /** Lines with something arriving on this delivery. */
  arriving: number
}

export function summarise(
  order: Pick<PurchaseOrder, 'lines'>,
  entries: Readonly<Record<string, PoLineEntry>>,
): ReceiptSummary {
  const s: ReceiptSummary = { items: 0, matched: 0, short: 0, over: 0, pending: 0, unexplained: 0, arriving: 0 }
  for (const l of owedLines(order)) {
    const owed = outstanding(l)
    const e = entries[l.productId]
    const v = variance(owed, e?.qty ?? null)
    s.items++
    if (v === 'match') s.matched++
    else if (v === 'short') s.short++
    else if (v === 'over') s.over++
    else s.pending++
    if (needsReason(owed, e)) s.unexplained++
    if ((e?.qty ?? 0) > 0) s.arriving++
  }
  return s
}

/** "Partly received 2/5" — lines complete out of lines ordered — for an order already part-delivered. */
export function partialLabel(
  order: Pick<PurchaseOrder, 'lines' | 'receipts'>,
  t: (s: string, v?: Record<string, string | number>) => string,
): string | null {
  if (!order.receipts?.length) return null
  const done = order.lines.filter((l) => outstanding(l) === 0).length
  return t('รับแล้วบางส่วน {x}/{y}', { x: done, y: order.lines.length })
}

/** What stops the review opening, first problem first — or null when it may open. */
export type ReceiptProblem = 'noOrder' | 'pending' | 'unexplained' | 'nothing' | 'noInvoice' | 'noLines' | 'badQty' | 'noSupplier'

export function poProblem(
  order: Pick<PurchaseOrder, 'lines'> | null,
  entries: Readonly<Record<string, PoLineEntry>>,
  invoiceNo: string,
): ReceiptProblem | null {
  if (!order) return 'noOrder'
  const s = summarise(order, entries)
  if (s.pending) return 'pending'
  if (s.unexplained) return 'unexplained'
  if (!s.arriving) return 'nothing'
  if (!invoiceNo.trim()) return 'noInvoice'
  return null
}

export function manualProblem(lines: readonly Line[], supplierName: string, invoiceNo: string): ReceiptProblem | null {
  if (lines.length === 0) return 'noLines'
  if (lines.some((l) => !(l.qty > 0))) return 'badQty'
  if (!supplierName.trim()) return 'noSupplier'
  if (!invoiceNo.trim()) return 'noInvoice'
  return null
}

/** One bill's worth of a draft this screen saved before it went PO-first. */
export interface LegacyBill {
  note: string
  lines: Line[]
}

/** Everything the screen keeps across leaving it (lib/useDraft). The photo never is. */
export interface ReceiptDraft {
  mode: Mode
  poId: string
  entries: Record<string, PoLineEntry>
  toLocationId: string
  dateStr: string
  docDateStr: string
  supplierId: string
  supplierName: string
  invoiceNo: string
  note: string
  lines: Line[]
  /** Bills from an older draft still to be keyed, one at a time, after this one. */
  queue: LegacyBill[]
}

export function emptyDraft(): ReceiptDraft {
  return {
    mode: 'po', poId: '', entries: {}, toLocationId: '', dateStr: '', docDateStr: '',
    supplierId: '', supplierName: '', invoiceNo: '', note: '', lines: [], queue: [],
  }
}

/** Whether a draft holds anything someone keyed. */
export function draftIsEmpty(d: Pick<ReceiptDraft, 'poId' | 'lines' | 'invoiceNo' | 'note' | 'queue'>): boolean {
  return !d.poId && d.lines.length === 0 && !d.invoiceNo.trim() && !d.note.trim() && d.queue.length === 0
}

function isLine(x: unknown): x is Line {
  const l = x as Partial<Line> | null
  return !!l && typeof l.productId === 'string' && typeof l.qty === 'number'
}

function linesOf(x: unknown): Line[] {
  return Array.isArray(x) ? x.filter(isLine) : []
}

function str(x: unknown): string {
  return typeof x === 'string' ? x : ''
}

function billsOf(x: unknown): LegacyBill[] {
  if (!Array.isArray(x)) return []
  return x
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .map((b) => ({ note: str(b.note), lines: linesOf(b.lines) }))
    .filter((b) => b.note.trim() || b.lines.length)
}

/** A bill from an old draft, as a hand-keyed receipt. Its free text stays as the note. */
function fromBill(base: ReceiptDraft, b: LegacyBill): ReceiptDraft {
  return { ...base, mode: 'manual', poId: '', entries: {}, lines: b.lines, note: b.note }
}

/**
 * A saved draft back as the screen's state, whichever shape it was saved in.
 *
 * Three shapes exist: this one; the multi-bill screen's `{ bills }` (24 Sep 2026, a few
 * hours); and the single form's `{ note, lines }` before that. Someone may have left a
 * half-keyed delivery across the update, so nothing is dropped: the first old bill comes
 * back as a hand-keyed receipt with its text as the note, and any others wait in `queue`
 * for "รับบิลถัดไป".
 */
export function restoreReceipt(saved: unknown): ReceiptDraft {
  const d = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  const base: ReceiptDraft = {
    ...emptyDraft(),
    toLocationId: str(d.toLocationId),
    dateStr: str(d.dateStr),
  }
  if (Array.isArray(d.bills)) {
    const [first, ...rest] = billsOf(d.bills)
    return first ? { ...fromBill(base, first), queue: rest } : base
  }
  if (d.mode === 'po' || d.mode === 'manual') {
    const entries: Record<string, PoLineEntry> = {}
    if (d.entries && typeof d.entries === 'object') {
      for (const [k, v] of Object.entries(d.entries as Record<string, unknown>)) {
        const e = v as Partial<PoLineEntry> | null
        if (!e) continue
        entries[k] = { qty: typeof e.qty === 'number' && Number.isFinite(e.qty) ? e.qty : null, reason: str(e.reason) }
      }
    }
    return {
      ...base,
      mode: d.mode,
      poId: str(d.poId),
      entries,
      docDateStr: str(d.docDateStr),
      supplierId: str(d.supplierId),
      supplierName: str(d.supplierName),
      invoiceNo: str(d.invoiceNo),
      note: str(d.note),
      lines: linesOf(d.lines),
      queue: billsOf(d.queue),
    }
  }
  if (typeof d.note === 'string' || Array.isArray(d.lines)) {
    return fromBill(base, { note: str(d.note), lines: linesOf(d.lines) })
  }
  return base
}

/** The next old bill off the queue, as a fresh hand-keyed receipt — or null when none. */
export function nextQueued(d: ReceiptDraft): ReceiptDraft | null {
  const [first, ...rest] = d.queue
  if (!first) return null
  return { ...fromBill({ ...emptyDraft(), toLocationId: d.toLocationId, dateStr: d.dateStr }, first), queue: rest }
}
