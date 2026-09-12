import { backend } from '../backend'
import { AppError } from '../i18n/AppError'
import {
  SUPPLIER_NOTES,
  mergeKey,
  proposeMerges,
  renameInProductName,
  settleSupplier,
  supplierFromName,
} from '../lib/supplierName'
import { COL, type Product, type Supplier } from '../types'
import { invalidateSupplierCache } from './suppliers'

/**
 * Turning the supplier names hidden in product names into records people can work with.
 *
 * ## Why a proposal, and not just an import
 *
 * The catalogue's brackets are a habit, not a field. 126 distinct values come out of 454
 * names, and among them are one company spelled three ways, a branch, and a shop that reads
 * as a measurement. Writing all of that straight into the database would produce a supplier
 * list nobody could order from, and undoing it would mean unpicking 454 products.
 *
 * So this proposes, and a person accepts. The proposal shows what was rejected as well as
 * what was kept, because the rules are wrong about at least one real shop and only the owner
 * knows which.
 *
 * ## Why the link is on the product
 *
 * `supplierItems` already exists and could hold it, but that is one document per product —
 * 454 reads every time an ordering screen asks "what does this supplier sell?". Products are
 * already subscribed in DataContext, so a field on the product answers the same question for
 * nothing. supplierItems stays for what it is good at: the price we pay.
 */

export interface ProposedSupplier {
  /** The name this supplier will be created under. */
  name: string
  /** Every spelling found in the catalogue that will point at it. */
  spellings: string[]
  productIds: string[]
  /** True when more than one spelling was folded together, so the owner can check it. */
  merged: boolean
  note?: string
}

export interface SupplierProposal {
  suppliers: ProposedSupplier[]
  /** Products whose name gives no supplier. The owner said they would fill these in later. */
  withoutSupplier: Product[]
  /** How many products the proposal would link, for a sanity check before applying. */
  linked: number
}

/**
 * Read the catalogue and work out the supplier list, without writing anything.
 *
 * Pure over the products handed to it, so the screen can show exactly what applying would do
 * and a test can check the real catalogue without a database.
 */
export function buildSupplierProposal(products: readonly Product[]): SupplierProposal {
  const byName = new Map<string, { spellings: Set<string>; productIds: string[] }>()
  const withoutSupplier: Product[] = []

  for (const p of products) {
    const raw = supplierFromName(p.name)
    if (!raw) {
      withoutSupplier.push(p)
      continue
    }
    const settled = settleSupplier(raw)
    let entry = byName.get(settled)
    if (!entry) {
      entry = { spellings: new Set(), productIds: [] }
      byName.set(settled, entry)
    }
    entry.spellings.add(raw)
    entry.productIds.push(p.id)
  }

  // Spellings the owner has not already ruled on: propose folding them together, but keep
  // them as a proposal rather than doing it silently.
  const groups = proposeMerges([...byName.keys()])
  const intoGroup = new Map<string, string>()
  for (const group of groups) {
    // The spelling carrying the most products wins, which is the closest thing to evidence
    // available without asking.
    const best = [...group].sort(
      (a, b) => (byName.get(b)?.productIds.length ?? 0) - (byName.get(a)?.productIds.length ?? 0),
    )[0]
    for (const name of group) intoGroup.set(name, best)
  }

  const merged = new Map<string, ProposedSupplier>()
  for (const [name, entry] of byName) {
    const target = intoGroup.get(name) ?? name
    let row = merged.get(target)
    if (!row) {
      row = { name: target, spellings: [], productIds: [], merged: false }
      merged.set(target, row)
    }
    row.spellings.push(...entry.spellings)
    row.productIds.push(...entry.productIds)
    if (target !== name) row.merged = true
  }

  const suppliers = [...merged.values()]
    .map((row) => ({
      ...row,
      spellings: [...new Set(row.spellings)].sort(),
      ...(SUPPLIER_NOTES[row.name] ? { note: SUPPLIER_NOTES[row.name] } : {}),
    }))
    .sort((a, b) => b.productIds.length - a.productIds.length || a.name.localeCompare(b.name))

  return {
    suppliers,
    withoutSupplier,
    linked: suppliers.reduce((n, s) => n + s.productIds.length, 0),
  }
}

/**
 * Write an accepted proposal: create the suppliers, and point their products at them.
 *
 * Suppliers first, so a failure part-way leaves records that simply have nothing attached
 * yet rather than products pointing at a supplier that does not exist. Re-running it is
 * safe: a supplier that is already there is reused, and a product already pointing at the
 * right one is skipped.
 */
export async function applySupplierProposal(
  accepted: readonly ProposedSupplier[],
): Promise<{ suppliers: number; products: number }> {
  if (accepted.length === 0) throw new AppError('ยังไม่ได้เลือกผู้ขาย')
  const now = Date.now()
  const existing = await backend.getAll<Supplier>(COL.suppliers)
  const byKey = new Map(existing.map((s) => [mergeKey(s.name), s]))

  let created = 0
  let linked = 0
  for (const row of accepted) {
    let supplier = byKey.get(mergeKey(row.name))
    if (!supplier) {
      const id = await backend.add(COL.suppliers, {
        name: row.name,
        contactNumber: '',
        email: '',
        type: 'general',
        ...(row.note ? { note: row.note } : {}),
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      supplier = { id, name: row.name } as Supplier
      byKey.set(mergeKey(row.name), supplier)
      created++
    }
    for (const productId of row.productIds) {
      await backend.update(COL.products, productId, { supplierId: supplier.id, updatedAt: now })
      linked++
    }
  }
  invalidateSupplierCache()
  return { suppliers: created, products: linked }
}

/**
 * Rename a supplier, and rewrite the bracket in every product name that carries it.
 *
 * The owner asked for exactly this: change (KT) to (Klongtoei) and have it read that way
 * everywhere, not only in a field. The products are found by their link rather than by
 * re-reading their names, so a product whose name was edited by hand still follows its
 * supplier, and a name that happens to look similar is never touched.
 */
export async function renameSupplier(
  supplierId: string,
  newName: string,
  products: readonly Product[],
): Promise<number> {
  const name = newName.trim()
  if (!name) throw new AppError('กรุณากรอกชื่อผู้ขาย')
  const supplier = await backend.getOne<Supplier>(COL.suppliers, supplierId)
  if (!supplier) throw new AppError('ไม่พบผู้ขาย')

  const mine = products.filter((p) => p.supplierId === supplierId)
  // Every spelling these products actually use, so a merged supplier renames all of them.
  const spellings = [...new Set(mine.map((p) => supplierFromName(p.name)).filter((s): s is string => !!s))]

  const now = Date.now()
  let renamed = 0
  for (const p of mine) {
    const next = renameInProductName(p.name, spellings, name)
    if (next === p.name) continue
    await backend.update(COL.products, p.id, { name: next, updatedAt: now })
    renamed++
  }
  await backend.update(COL.suppliers, supplierId, { name, updatedAt: now })
  invalidateSupplierCache()
  return renamed
}
