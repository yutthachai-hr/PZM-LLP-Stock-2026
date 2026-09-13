import { useEffect, useSyncExternalStore } from 'react'
import { backend } from '../backend'
import { AppError } from '../i18n/AppError'
import { COL, type Product, type Supplier, type SupplierItem, type SupplierType } from '../types'
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
  const now = Date.now()
  return backend.add(COL.suppliers, {
    name,
    contactNumber: clean(input.contactNumber),
    email: clean(input.email),
    type: input.type,
    ...(input.note?.trim() ? { note: clean(input.note) } : {}),
    active: true,
    createdAt: now,
    updatedAt: now,
  })
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
  await backend.update(COL.suppliers, id, next)
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
): Promise<SupplierItem | null> {
  if (!supplierId) throw new AppError('ข้อมูลไม่ครบ: {what}', { what: 'supplierId' })
  if (!productId) throw new AppError('กรุณาเลือกสินค้า')
  if (buyingPrice !== undefined && (!Number.isFinite(buyingPrice) || buyingPrice < 0)) {
    throw new AppError('ราคาซื้อต้องไม่ติดลบ')
  }
  await updateProduct(productId, { supplierId })

  const mine = items.filter((i) => i.productId === productId)
  const stale = mine.filter((i) => i.supplierId !== supplierId)
  await Promise.all(stale.map((i) => backend.remove(COL.supplierItems, i.id)))

  const existing = mine.find((i) => i.supplierId === supplierId)
  if (buyingPrice === undefined) return existing ?? null
  const now = Date.now()
  if (existing) {
    await updateSupplierItem(existing.id, { buyingPrice })
    return { ...existing, buyingPrice, updatedAt: now }
  }
  const id = await addSupplierItem(supplierId, productId, buyingPrice)
  return { id, supplierId, productId, buyingPrice, active: true, createdAt: now, updatedAt: now }
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
    active: true,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateSupplierItem(
  id: string,
  patch: { productId?: string; buyingPrice?: number },
): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() }
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
