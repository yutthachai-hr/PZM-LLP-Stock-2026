// The movement and balance documents every stock writer files, browser or trusted server.
// One definition, because firestore.rules (validLevel, movementCore) mirrors their shape.
import { AppError } from '../i18n/AppError'
import type { MovementType } from '../types'
import { filedUnit } from '../lib/levelKey'
import { roundQty } from '../lib/validate'
import { keyedUnit, type MovementLine } from './receivePlan'

interface Actor {
  id: string
  name: string
}

const PREFIX: Record<MovementType, string> = {
  receive: 'RC',
  issue: 'IS',
  adjust: 'ADJ',
  consume: 'CS',
}

/** "สต๊อกไม่พอ" with the base balance, and what was keyed when that differs. */
export function shortMessage(l: MovementLine, avail: number): AppError {
  const keyed = keyedUnit(l)
  if (keyed && l.entryQty !== undefined) {
    return new AppError('สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit}) — {entryQty} {entryUnit} = {need} {unit}', {
      name: l.productName, qty: avail, unit: l.unit, entryQty: l.entryQty, entryUnit: keyed, need: l.qty,
    })
  }
  return new AppError('สต๊อกไม่พอสำหรับ "{name}" (คงเหลือ {qty} {unit})', { name: l.productName, qty: avail, unit: filedUnit(l) })
}

/**
 * The cached balance document.
 *
 * `updatedBy` is not decoration: the security rules require it to equal the caller's uid.
 * Balances are the one thing the rules cannot prove correct — that needs a trusted server
 * comparing every write against the ledger, and the free plan has no room for one — so the
 * next best thing is that every balance in the database names whoever last wrote it.
 */
export function levelDoc(
  locationId: string,
  productId: string,
  qty: number,
  actor: Actor,
  now: number,
  unit?: string,
): Record<string, unknown> {
  return {
    productId,
    locationId,
    // Omitted for the product's own unit, so rows written before units were selectable keep
    // exactly the shape they have.
    ...(unit ? { unit } : {}),
    qty: roundQty(qty),
    updatedAt: now,
    updatedBy: actor.id,
  }
}

export function makeDocNo(type: MovementType, seq: number): string {
  return `${PREFIX[type]}-${String(seq).padStart(5, '0')}`
}
