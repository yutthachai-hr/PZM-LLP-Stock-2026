import { BadInput } from './spec'

/**
 * Checking a command's JSON parameters on the server (ADR-001). Shapes only — the
 * transaction bodies check the business rules (quantities, dates, master data) themselves.
 */
type Obj = Record<string, unknown>

export function obj(v: unknown, what = 'params'): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new BadInput(what)
  return v as Obj
}
export function id(v: unknown, what: string): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new BadInput(what)
  return v
}
export function text(v: unknown, what: string, max = 2000): string {
  if (typeof v !== 'string' || v.length > max) throw new BadInput(what)
  return v
}
export function optText(v: unknown, what: string, max = 2000): string | undefined {
  return v === undefined ? undefined : text(v, what, max)
}
export function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadInput(what)
  return v
}
export function optNum(v: unknown, what: string): number | undefined {
  return v === undefined ? undefined : num(v, what)
}
export function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') throw new BadInput(what)
  return v
}
export function list<T>(v: unknown, what: string, item: (x: unknown) => T, max = 200): T[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) throw new BadInput(what)
  return v.map(item)
}
export function photo(v: unknown): string | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string' || v.length > 1_000_000 || !v.startsWith('data:image/')) throw new BadInput('photoDataUrl')
  return v
}
/** Only the keys a command names: anything else in the body is refused, not ignored. */
export function only(o: Obj, keys: readonly string[], what = 'params'): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new BadInput(`${what}.${k}`)
}

/** A stock line: product, units, quantity in the product's own unit, a note. */
export function movementLine(v: unknown) {
  const l = obj(v, 'line')
  only(l, ['productId', 'productName', 'unit', 'entryUnit', 'entryQty', 'qty', 'note'], 'line')
  return {
    productId: id(l.productId, 'line.productId'),
    productName: text(l.productName, 'line.productName', 300),
    unit: text(l.unit, 'line.unit', 40),
    ...(l.entryUnit !== undefined ? { entryUnit: text(l.entryUnit, 'line.entryUnit', 20) } : {}),
    ...(l.entryQty !== undefined ? { entryQty: num(l.entryQty, 'line.entryQty') } : {}),
    qty: num(l.qty, 'line.qty'),
    ...(l.note !== undefined ? { note: text(l.note, 'line.note') } : {}),
  }
}
