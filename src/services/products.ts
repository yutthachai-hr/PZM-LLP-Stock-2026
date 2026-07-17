import { backend } from '../backend'
import { COL, type ProductImage, type StockLevel } from '../types'

export interface ProductInput {
  sku: string
  name: string
  category: string
  unit: string
  unitType: string
  minStock: number
  cost?: number
}

export async function createProduct(input: ProductInput): Promise<string> {
  const now = Date.now()
  return backend.add(COL.products, {
    ...input,
    hasImage: false,
    active: true,
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateProduct(
  id: string,
  patch: Partial<ProductInput> & { active?: boolean },
): Promise<void> {
  await backend.update(COL.products, id, { ...patch, updatedAt: Date.now() })
}

export async function deleteProduct(id: string): Promise<void> {
  // Remove product + image + cached balances. Movements keep denormalised names for history.
  const levels = await backend.getAll<StockLevel>(COL.stockLevels)
  await Promise.all(
    levels.filter((l) => l.productId === id).map((l) => backend.remove(COL.stockLevels, l.id)),
  )
  await backend.remove(COL.productImages, id).catch(() => {})
  await backend.remove(COL.products, id)
}

export async function setProductImage(id: string, dataUrl: string): Promise<void> {
  await backend.set(COL.productImages, id, { dataUrl })
  await backend.update(COL.products, id, { hasImage: true, updatedAt: Date.now() })
}

export async function removeProductImage(id: string): Promise<void> {
  await backend.remove(COL.productImages, id).catch(() => {})
  await backend.update(COL.products, id, { hasImage: false, updatedAt: Date.now() })
}

export async function getProductImage(id: string): Promise<string | null> {
  const img = await backend.getOne<ProductImage>(COL.productImages, id)
  return img?.dataUrl ?? null
}
