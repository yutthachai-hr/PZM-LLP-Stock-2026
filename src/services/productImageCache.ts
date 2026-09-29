import { forgetStoredImage, readStoredImage, storeImage } from '../lib/imageStore'
import { getProductImage } from './products'

/** Where a product's photo is kept on the device: per brand, since both number products from 1. */
export function photoKey(brand: string | null | undefined, productId: string): string {
  return `${brand ?? '-'}::${productId}`
}

/**
 * A product's photo from this device, or — only when the device does not have this version —
 * one read from Firestore, which is then kept on the device (owner, 26 Sep 2026: the free
 * tier's 50,000 reads a day). The version is the product's `updatedAt`; without one the
 * photo is fetched and not kept, since there would be no telling when it went stale.
 */
export async function loadProductImage(
  brand: string | null | undefined,
  productId: string,
  version: number | undefined,
): Promise<string | null> {
  const key = photoKey(brand, productId)
  if (version !== undefined) {
    const kept = await readStoredImage(key, version)
    if (kept) return kept
  }
  const url = await getProductImage(productId)
  if (url && version !== undefined) void storeImage(key, version, url)
  return url
}

/** Drop a product's photo from the device, for every brand, after it changed. */
export function forgetProductImage(productId: string, brands: readonly string[]): void {
  for (const b of brands) void forgetStoredImage(photoKey(b, productId))
}
