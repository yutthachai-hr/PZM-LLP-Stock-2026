import { useEffect, useSyncExternalStore } from 'react'
import { onBrandChange } from '../brand/brand'
import { backend } from '../backend'
import { DELETE_FIELD } from '../backend/types'
import { AppError } from '../i18n/AppError'
import { COL, type Product, type Supplier, type SupplierItem, type SupplierLink, type SupplierType } from '../types'
import { updateProduct } from './products'

/**
 * Who we buy from, and what they sell us.
 *
 * ## Why these reads are not in DataContext
 *
 * Everything in DataContext is subscribed for the whole session, on every device, on every
 * brand — and because the shared tablets sign out after 20 minutes and `logout()` clears
 * the offline cache, nearly every session pays for it in full. This app is on Firebase's
 * free plan: 50,000 document reads a day for both companies together.
 *
 * Suppliers are looked at occasionally, by one person, on one screen. Subscribing them
 * globally would bill every tablet in every branch, all day, for a list almost nobody has
 * open. So these are one-shot reads made by the screen that needs them, and nothing here
 * is live.
 *
 * Product names are NOT read here. The catalogue is already in DataContext; the supplier
 * screen joins against it in memory.
 */

function clean(v: string): string {
  return v.trim()
}

export interface SupplierInput {
  name: string
  contactNumber: string
  email: string
  type: SupplierType
  note?: string
  /** Where the goods usually land; the automatic order offers it first. Empty = unknown. */
  defaultLocationId?: string
  /** Days from order to delivery. Shown, never enforced. Undefined = unknown. */
  leadTimeDays?: number
  /** Weekdays orders are placed, 0 = Sunday. Empty/undefined = any day. */
  orderDays?: number[]
  /** Time of day an order has to be in by, HH:mm. Undefined = none. */
  cutoffTime?: string
  /** The supplier's own details (owner's mock-up 10). All optional, all free text. */
  contactName?: string
  phone2?: string
  address?: string
  taxId?: string
  paymentTerms?: string
  category?: string
  links?: SupplierLink[]
}

/** The optional free-text fields, handled the same way on create and on update. */
const DETAIL_KEYS = ['contactName', 'phone2', 'address', 'taxId', 'paymentTerms', 'category'] as const
const DETAIL_MAX: Record<(typeof DETAIL_KEYS)[number], number> = {
  contactName: 200,
  phone2: 40,
  address: 500,
  taxId: 30,
  paymentTerms: 100,
  category: 100,
}

/** Links are kept as given, trimmed, and only when they have both a label and a URL. */
function cleanLinks(links: SupplierLink[] | undefined): SupplierLink[] | undefined {
  if (!links) return undefined
  const kept = links
    .map((l) => ({ label: clean(l.label).slice(0, 100), url: clean(l.url).slice(0, 500) }))
    .filter((l) => l.label && l.url)
    .slice(0, 20)
  return kept.length > 0 ? kept : undefined
}

const CODE_COUNTER = 'supplierCode'

/** V-00001, V-00002 … — a supplier's code, numbered like a document. */
export function makeSupplierCode(seq: number): string {
  return `V-${String(seq).padStart(5, '0')}`
}

/**
 * The next code, from the shared counter, floored past anything already issued.
 *
 * The floor matters because the codes are handed out in a batch to suppliers that predate
 * them (the owner's choice, 22 Sep 2026): if the counter were ever reset, or the batch run
 * twice, two suppliers would otherwise carry one code.
 */
async function nextCode(existing: readonly Supplier[]): Promise<{ seq: number; code: string }> {
  const counter = await backend.getOne<{ value: number }>(COL.counters, CODE_COUNTER)
  let floor = counter?.value ?? 0
  for (const s of existing) {
    const n = Number(s.code?.slice(2) ?? 0)
    if (Number.isFinite(n) && n > floor) floor = n
  }
  const seq = floor + 1
  return { seq, code: makeSupplierCode(seq) }
}

function checkLeadTime(days: number | undefined): void {
  if (days === undefined) return
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    throw new AppError('ระยะเวลาส่งของต้องเป็นจำนวนวัน 0–365')
  }
}

/** Sunday-first weekday numbers, each once, in order — the shape the calendar reads. */
function cleanOrderDays(days: number[] | undefined): number[] | undefined {
  if (!days) return undefined
  const out = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
  return out.length ? out : undefined
}

function checkCutoff(time: string | undefined): void {
  if (time === undefined || time === '') return
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new AppError('เวลาตัดรอบต้องเป็น HH:mm')
}

/** Every supplier, once. ~20 documents. Called when the Suppliers screen opens. */
export async function listSuppliers(): Promise<Supplier[]> {
  const rows = await backend.getAll<Supplier>(COL.suppliers)
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/** Every supplier-product link, once. ~100 documents. Called with listSuppliers(). */
export async function listSupplierItems(): Promise<SupplierItem[]> {
  return backend.getAll<SupplierItem>(COL.supplierItems)
}

export async function createSupplier(input: SupplierInput): Promise<string> {
  const name = clean(input.name)
  if (!name) throw new AppError('กรุณากรอกชื่อผู้ขาย')
  checkLeadTime(input.leadTimeDays)
  checkCutoff(input.cutoffTime)
  const now = Date.now()
  // A new supplier is numbered as it is created; the codes for the ones that came before
  // are issued in one go from the suppliers screen (assignSupplierCodes).
  const all = (await backend.getAll<Supplier>(COL.suppliers)) ?? []
  const { seq, code } = await nextCode(all)
  await backend.set(COL.counters, CODE_COUNTER, { value: seq })
  const details = Object.fromEntries(
    DETAIL_KEYS.map((k) => [k, clean(input[k] ?? '').slice(0, DETAIL_MAX[k])]).filter(([, v]) => v),
  )
  const links = cleanLinks(input.links)
  const id = await backend.add(COL.suppliers, {
    name,
    code,
    ...details,
    ...(links ? { links } : {}),
    contactNumber: clean(input.contactNumber),
    email: clean(input.email),
    type: input.type,
    ...(input.note?.trim() ? { note: clean(input.note) } : {}),
    ...(input.defaultLocationId ? { defaultLocationId: input.defaultLocationId } : {}),
    ...(input.leadTimeDays === undefined ? {} : { leadTimeDays: input.leadTimeDays }),
    ...(cleanOrderDays(input.orderDays) ? { orderDays: cleanOrderDays(input.orderDays) } : {}),
    ...(input.cutoffTime ? { cutoffTime: input.cutoffTime } : {}),
    active: true,
    createdAt: now,
    updatedAt: now,
  })
  const written = await backend.getOne<Supplier>(COL.suppliers, id)
  if (written) patchSupplierCache(id, written)
  return id
}

export async function updateSupplier(
  id: string,
  patch: Partial<SupplierInput> & { active?: boolean },
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() }
  // Hidden, not deleted — the same rule products follow. The orders it filled still name
  // it, and it is one click from coming back.
  if (patch.active !== undefined) next.active = patch.active
  if (patch.name !== undefined) {
    const name = clean(patch.name)
    if (!name) throw new AppError('กรุณากรอกชื่อผู้ขาย')
    next.name = name
  }
  if (patch.contactNumber !== undefined) next.contactNumber = clean(patch.contactNumber)
  if (patch.email !== undefined) next.email = clean(patch.email)
  if (patch.type !== undefined) next.type = patch.type
  if (patch.note !== undefined) next.note = clean(patch.note)
  for (const k of DETAIL_KEYS) {
    if (!(k in patch)) continue
    const v = clean(patch[k] ?? '').slice(0, DETAIL_MAX[k])
    next[k] = v ? v : DELETE_FIELD
  }
  if ('links' in patch) {
    const links = cleanLinks(patch.links)
    next.links = links ?? DELETE_FIELD
  }
  // Both are optional keys under hasOnly, so clearing one removes it rather than writing
  // an empty value — the same rule a product's supplierId follows.
  if ('defaultLocationId' in patch) {
    next.defaultLocationId = patch.defaultLocationId ? patch.defaultLocationId : DELETE_FIELD
  }
  if ('leadTimeDays' in patch) {
    checkLeadTime(patch.leadTimeDays)
    next.leadTimeDays = patch.leadTimeDays === undefined ? DELETE_FIELD : patch.leadTimeDays
  }
  if ('orderDays' in patch) {
    const days = cleanOrderDays(patch.orderDays)
    next.orderDays = days ?? DELETE_FIELD
  }
  if ('cutoffTime' in patch) {
    checkCutoff(patch.cutoffTime)
    next.cutoffTime = patch.cutoffTime ? patch.cutoffTime : DELETE_FIELD
  }
  await backend.update(COL.suppliers, id, next)
  if (cached) {
    const cur = cached.find((s) => s.id === id)
    if (cur) {
      const merged: Record<string, unknown> = { ...cur }
      for (const [k, v] of Object.entries(next)) {
        if (v === DELETE_FIELD) delete merged[k]
        else merged[k] = v
      }
      patchSupplierCache(id, merged as unknown as Supplier)
    }
  }
}

/**
 * Remove a supplier and everything pointing at it.
 *
 * The price rows go, because a `supplierItem` whose supplier is gone is unreachable from
 * every screen and would still be counted by anything that groups by product. So does the
 * `supplierId` on each of its products — left in place, the ordering screen would offer a
 * supplier that no longer exists. `products` is handed in from DataContext rather than read
 * here: it is already in memory, and re-reading the catalogue to delete one supplier would
 * cost more than the screen costs to open.
 */
export async function deleteSupplier(id: string, products: readonly Product[]): Promise<void> {
  const items = await backend.getAll<SupplierItem>(COL.supplierItems)
  await Promise.all(
    items.filter((i) => i.supplierId === id).map((i) => backend.remove(COL.supplierItems, i.id)),
  )
  for (const p of products) {
    if (p.supplierId === id) await updateProduct(p.id, { supplierId: undefined })
  }
  await backend.remove(COL.suppliers, id)
  patchSupplierCache(id, null)
}

// ---------------------------------------------------------------- product links ----

/**
 * Put a product under a supplier.
 *
 * The link is `supplierId` on the product: that is what the catalogue import writes, what
 * the ordering screen reads, and what the product editor shows. A `supplierItem` row is
 * written only when there is a price to keep, because that is the one thing it holds that
 * the product cannot — and an empty one would just be the same link stored twice.
 *
 * A product has one supplier. Linking it to another moves it: the old price row is
 * dropped, since a price from a company we no longer buy this from is not a price.
 *
 * `items` is the screen's copy of the price rows, passed in so this does not re-read the
 * collection on every click. Returns the price row as it now stands, or null when there
 * is none, so the screen can patch its copy instead of reading the collection again.
 */
export async function linkProduct(
  supplierId: string,
  productId: string,
  buyingPrice: number | undefined,
  items: readonly SupplierItem[],
  minOrderQty?: number,
): Promise<SupplierItem | null> {
  if (!supplierId) throw new AppError('ข้อมูลไม่ครบ: {what}', { what: 'supplierId' })
  if (!productId) throw new AppError('กรุณาเลือกสินค้า')
  if (buyingPrice !== undefined && (!Number.isFinite(buyingPrice) || buyingPrice < 0)) {
    throw new AppError('ราคาซื้อต้องไม่ติดลบ')
  }
  if (minOrderQty !== undefined && (!Number.isFinite(minOrderQty) || minOrderQty <= 0)) {
    throw new AppError('ขั้นต่ำในการสั่งต้องมากกว่า 0')
  }
  await updateProduct(productId, { supplierId })

  const mine = items.filter((i) => i.productId === productId)
  const stale = mine.filter((i) => i.supplierId !== supplierId)
  await Promise.all(stale.map((i) => backend.remove(COL.supplierItems, i.id)))

  const existing = mine.find((i) => i.supplierId === supplierId)
  if (buyingPrice === undefined && minOrderQty === undefined) return existing ?? null
  const now = Date.now()
  if (existing) {
    const patch = {
      ...(buyingPrice === undefined ? {} : { buyingPrice }),
      ...(minOrderQty === undefined ? {} : { minOrderQty }),
    }
    await updateSupplierItem(existing.id, patch)
    return { ...existing, ...patch, updatedAt: now }
  }
  const id = await addSupplierItem(supplierId, productId, buyingPrice, minOrderQty)
  return {
    id,
    supplierId,
    productId,
    ...(buyingPrice === undefined ? {} : { buyingPrice }),
    ...(minOrderQty === undefined ? {} : { minOrderQty }),
    active: true,
    createdAt: now,
    updatedAt: now,
  }
}

/** Take a product away from whoever supplies it, price row included. */
export async function unlinkProduct(
  productId: string,
  items: readonly SupplierItem[],
): Promise<void> {
  if (!productId) throw new AppError('กรุณาเลือกสินค้า')
  await updateProduct(productId, { supplierId: undefined })
  await Promise.all(
    items.filter((i) => i.productId === productId).map((i) => backend.remove(COL.supplierItems, i.id)),
  )
}

export async function addSupplierItem(
  supplierId: string,
  productId: string,
  buyingPrice?: number,
  minOrderQty?: number,
): Promise<string> {
  if (!supplierId) throw new AppError('ข้อมูลไม่ครบ: {what}', { what: 'supplierId' })
  if (!productId) throw new AppError('กรุณาเลือกสินค้า')
  if (buyingPrice !== undefined && (!Number.isFinite(buyingPrice) || buyingPrice < 0)) {
    throw new AppError('ราคาซื้อต้องไม่ติดลบ')
  }
  const now = Date.now()
  return backend.add(COL.supplierItems, {
    supplierId,
    productId,
    ...(buyingPrice === undefined ? {} : { buyingPrice }),
    ...(minOrderQty === undefined ? {} : { minOrderQty }),
    active: true,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateSupplierItem(
  id: string,
  patch: { productId?: string; buyingPrice?: number; minOrderQty?: number },
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() }
  // The least the supplier sells at once. Cleared by passing undefined explicitly.
  if ('minOrderQty' in patch) {
    const moq = patch.minOrderQty
    if (moq !== undefined && (!Number.isFinite(moq) || moq <= 0)) {
      throw new AppError('ขั้นต่ำในการสั่งต้องมากกว่า 0')
    }
    next.minOrderQty = moq === undefined ? DELETE_FIELD : moq
  }
  if (patch.productId !== undefined) {
    if (!patch.productId) throw new AppError('กรุณาเลือกสินค้า')
    next.productId = patch.productId
  }
  if (patch.buyingPrice !== undefined) {
    if (!Number.isFinite(patch.buyingPrice) || patch.buyingPrice < 0) {
      throw new AppError('ราคาซื้อต้องไม่ติดลบ')
    }
    next.buyingPrice = patch.buyingPrice
  }
  await backend.update(COL.supplierItems, id, next)
}

export async function removeSupplierItem(id: string): Promise<void> {
  await backend.remove(COL.supplierItems, id)
}

// ---------------------------------------------------------------- session cache ----

/**
 * The supplier list, read once per session.
 *
 * Roughly a hundred documents. The product editor needs them to offer a supplier, and the
 * ordering screens will too, so reading them on every dialog would be a hundred reads for a
 * list that changes a few times a year. Fetched the first time something asks, then held —
 * and deliberately not subscribed, for the same reason nothing else here is.
 */
let cached: Supplier[] | null = null
let inflight: Promise<Supplier[]> | null = null
const listeners = new Set<() => void>()
const NONE: Supplier[] = []

function announce(): void {
  for (const fn of listeners) fn()
}

/** Forgotten when the list is written to, so the next reader sees the change. */
export function invalidateSupplierCache(): void {
  cached = null
  inflight = null
  announce()
}

// The list is one brand's. Switching brands must drop it, or the other brand's product
// editor offers these names and files their ids onto its products.
onBrandChange(invalidateSupplierCache)

/**
 * Fold one written supplier into the held list, so the calendar and the product editor
 * see the change without the list being read again. A supplier not in the list yet (a
 * create) is added; `null` removes.
 */
export function patchSupplierCache(id: string, row: Supplier | null): void {
  if (!cached) return
  const without = cached.filter((s) => s.id !== id)
  cached = row ? [...without, row].sort((a, b) => a.name.localeCompare(b.name)) : without
  announce()
}

export async function loadSuppliers(): Promise<Supplier[]> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = listSuppliers()
    .then((rows) => {
      cached = rows
      announce()
      return rows
    })
    .catch(() => {
      // A denied or failed read must not stop someone editing a product; they simply do not
      // get to pick a supplier this time.
      cached = NONE
      announce()
      return NONE
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** The suppliers, fetching them the first time a screen asks. */
export function useSuppliers(): Supplier[] {
  const rows = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => cached,
    () => cached,
  )
  useEffect(() => {
    void loadSuppliers()
  }, [])
  return rows ?? NONE
}

/**
 * Give every supplier without one a code, oldest first (owner, 22 Sep 2026: retrospectively,
 * for all of them). Safe to press twice: a supplier that already has a code is skipped, and
 * the counter is floored past the highest code in use, so no number is handed out twice.
 */
export async function assignSupplierCodes(): Promise<{ issued: number; from?: string; to?: string }> {
  const all = (await backend.getAll<Supplier>(COL.suppliers)) ?? []
  const missing = all.filter((s) => !s.code).sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
  if (missing.length === 0) return { issued: 0 }
  let { seq } = await nextCode(all)
  const first = makeSupplierCode(seq)
  for (const s of missing) {
    const code = makeSupplierCode(seq)
    await backend.update(COL.suppliers, s.id, { code, updatedAt: Date.now() })
    patchSupplierCache(s.id, { ...s, code })
    seq++
  }
  await backend.set(COL.counters, CODE_COUNTER, { value: seq - 1 })
  return { issued: missing.length, from: first, to: makeSupplierCode(seq - 1) }
}
