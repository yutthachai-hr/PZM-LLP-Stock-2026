import type { Line } from '../../components/LineBuilder'
import { genId } from '../../lib/id'

/**
 * One supplier's delivery note on the receiving screen.
 *
 * The warehouse gets several a day from several suppliers (owner, 24 Sep 2026: "เรารับเข้า
 * 1 วัน หลายรายการ หลายซับพลายเออ"), and the screen used to take one at a time: key its
 * number, key its lines, save, clear, start again. Now it holds a card per bill, and a save
 * files each one as its own RC- document with the bill's number as its note — exactly what
 * saving them one by one produced, so the history reads the same as it always has.
 */
export interface Bill {
  /** Only for React keys and focus — never stored anywhere. */
  id: string
  /** The supplier's bill number and name, as typed. Filed as the RC- document's note. */
  note: string
  lines: Line[]
}

export function emptyBill(): Bill {
  return { id: genId(), note: '', lines: [] }
}

export type BillProblem = 'noNote' | 'noLines' | 'badQty' | 'nothing'

/**
 * What a save will file, or the first card that stops it — decided before anything is
 * written, so a refusal never leaves half a day's bills filed.
 *
 * A card with neither a number nor a line is a card nobody used, and is skipped rather than
 * complained about: the screen always keeps one empty card ready for the next bill.
 */
export function planBills(
  bills: readonly Bill[],
): { ok: true; bills: Bill[] } | { ok: false; index: number; reason: BillProblem } {
  const out: Bill[] = []
  for (let i = 0; i < bills.length; i++) {
    const b = bills[i]
    const note = b.note.trim()
    if (!note && b.lines.length === 0) continue
    if (b.lines.length === 0) return { ok: false, index: i, reason: 'noLines' }
    if (!note) return { ok: false, index: i, reason: 'noNote' }
    if (b.lines.some((l) => !(l.qty > 0))) return { ok: false, index: i, reason: 'badQty' }
    out.push({ ...b, note })
  }
  if (out.length === 0) return { ok: false, index: 0, reason: 'nothing' }
  return { ok: true, bills: out }
}

function isLine(x: unknown): x is Line {
  const l = x as Partial<Line> | null
  return !!l && typeof l.productId === 'string' && typeof l.qty === 'number'
}

function linesOf(x: unknown): Line[] {
  return Array.isArray(x) ? x.filter(isLine) : []
}

/**
 * A saved draft back as bills.
 *
 * Takes the new shape (`{ bills }`) and the one this screen saved before bills existed
 * (`{ note, lines }`) — somebody may have left a half-keyed delivery on screen across the
 * update, and it must come back as the first bill rather than disappear. Never returns an
 * empty list: the screen always has a card to key into.
 */
export function restoreBills(saved: unknown): Bill[] {
  const d = saved as { bills?: unknown; note?: unknown; lines?: unknown } | null | undefined
  if (d && Array.isArray(d.bills)) {
    const bills = d.bills
      .filter((b): b is { note?: unknown; lines?: unknown } => !!b && typeof b === 'object')
      .map((b) => ({ id: genId(), note: typeof b.note === 'string' ? b.note : '', lines: linesOf(b.lines) }))
    if (bills.length) return bills
  } else if (d && (typeof d.note === 'string' || Array.isArray(d.lines))) {
    return [{ id: genId(), note: typeof d.note === 'string' ? d.note : '', lines: linesOf(d.lines) }]
  }
  return [emptyBill()]
}
