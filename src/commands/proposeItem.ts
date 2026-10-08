import { COL, type Product } from '../types'
import { itemKey, makeOtherSku } from '../lib/otherItem'
import { normaliseName } from '../lib/productMatch'
import { obj, only, optText, text } from './check'
import { BadInput, defineCommand } from './spec'
import { AppError } from '../i18n/AppError'

/**
 * Smart "Other" item (R&D, 8 Oct 2026): a new product proposed by whoever is asking for it,
 * without going to the catalogue screen — created PENDING review, with its own code.
 *
 * Runs on the server (products are admin-only under the rules; the service account writes
 * exactly what `writes` lists). In one transaction:
 *   - a claim on the item's key (normalised name | spec | unit), so two people proposing
 *     the same thing at the same moment get ONE product — the second is handed the first's;
 *   - the next number from `counters/otherSku`: RND-000001, … never reused, never skipped
 *     back to (a failed transaction takes no number; a committed one keeps it);
 *   - the product itself, `review: 'pending'`: its own id and its own stock, never mixed
 *     with an existing SKU's. An admin reviews it in the catalogue.
 *
 * It never edits an existing product, never touches stock, and never decides that a typed
 * name IS an existing product — that choice is the person's (lib/otherItem decides what to
 * offer them).
 */
export interface ProposeItemParams {
  name: string
  spec?: string
  /** The unit it is bought and counted in (its own unit). */
  unit: string
  /** The category's catch-all product the person started from ("VEGETABLE-(OTHER)"). */
  placeholderId: string
  supplierId?: string
}
export interface ProposeItemResult {
  productId: string
  sku: string
  created: boolean
}

export const COUNTER_ID = 'otherSku'
export const KEYS = 'productKeys'

/** A document id for a key of any text (Thai, slashes): SHA-256 hex. */
async function keyId(key: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const proposeItemCommand = defineCommand({
  name: 'proposeItem',
  roles: ['staff', 'manager', 'admin'],
  brands: ['rnd'],
  writes: { products: ['set'], [KEYS]: ['set'], counters: ['set'] },
  parse(raw): ProposeItemParams {
    const p = obj(raw)
    only(p, ['name', 'spec', 'unit', 'placeholderId', 'supplierId'])
    const name = text(p.name, 'name', 300).trim().replace(/\s+/g, ' ')
    if (normaliseName(name).length < 2) throw new BadInput('name')
    const unit = text(p.unit, 'unit', 60).trim()
    if (!unit) throw new BadInput('unit')
    const spec = optText(p.spec, 'spec')?.trim().replace(/\s+/g, ' ')
    if (spec !== undefined && spec.length > 300) throw new BadInput('spec')
    const placeholderId = text(p.placeholderId, 'placeholderId', 200).trim()
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(placeholderId)) throw new BadInput('placeholderId')
    const supplierId = optText(p.supplierId, 'supplierId')?.trim()
    if (supplierId !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(supplierId)) throw new BadInput('supplierId')
    return { name, unit, placeholderId, ...(spec ? { spec } : {}), ...(supplierId ? { supplierId } : {}) }
  },
  async run(tx, _file, params, actor): Promise<ProposeItemResult> {
    const key = itemKey(params)
    const claimId = await keyId(key)
    // The placeholder says which category the new item belongs to (and that it exists here).
    const placeholder = await tx.get<Product>(COL.products, params.placeholderId)
    // A refusal inside the transaction is the app's own words (422), as in the other commands.
    if (!placeholder) throw new AppError('ไม่พบหมวด "สินค้าอื่น ๆ" ที่เลือก — เปิดหน้าใหม่แล้วลองอีกครั้ง')
    const claim = await tx.get<{ productId: string; sku: string }>(KEYS, claimId)
    if (claim) return { productId: claim.productId, sku: claim.sku, created: false }
    const counter = await tx.get<{ value: number }>(COL.counters, COUNTER_ID)
    const seq = (counter?.value ?? 0) + 1
    const sku = makeOtherSku(seq)
    const productId = `rnd_other_${String(seq).padStart(6, '0')}`
    const now = Date.now()
    const product: Record<string, unknown> = {
      id: productId,
      sku,
      name: params.name,
      category: placeholder.category,
      unit: params.unit,
      unitType: params.unit,
      minStock: 0,
      hasImage: false,
      active: true,
      review: 'pending',
      nameKey: normaliseName(params.name),
      proposedBy: actor.id,
      proposedByName: actor.name,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }
    if (params.spec) product.spec = params.spec
    if (params.supplierId) product.supplierId = params.supplierId
    tx.set(COL.products, productId, product)
    tx.set(KEYS, claimId, { key, productId, sku, createdAt: now, by: actor.id })
    tx.set(COL.counters, COUNTER_ID, { value: seq })
    return { productId, sku, created: true }
  },
})
