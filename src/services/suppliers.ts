import { useEffect, useSyncExternalStore } from 'react'
import { backend } from '../backend'
import { AppError } from '../i18n/AppError'
import { COL, type Supplier, type SupplierItem, type SupplierType } from '../types'

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

export async function updateSupplier(id: string, patch: Partial<SupplierInput>): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() }
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
 * Remove a supplier and the products attached to it.
 *
 * The links go too, because a `supplierItem` whose supplier is gone is unreachable from
 * every screen and would still be counted by anything that groups by product. This mirrors
 * `deleteLocation`, which clears the balances belonging to the location it removes.
 */
export async function deleteSupplier(id: string): Promise<void> {
  const items = await backend.getAll<SupplierItem>(COL.supplierItems)
  await Promise.all(
    items.filter((i) => i.supplierId === id).map((i) => backend.remove(COL.supplierItems, i.id)),
  )
  await backend.remove(COL.suppliers, id)
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
