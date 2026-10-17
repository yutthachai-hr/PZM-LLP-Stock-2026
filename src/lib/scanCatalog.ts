import { backend } from '../backend'
import { brandEpoch, onBrandChange, type BrandId } from '../brand/brand'
import { COL, type Product } from '../types'

export const SCAN_CATALOG_TTL_MS = 3000

interface CachedCatalog {
  brand: BrandId
  epoch: number
  fetchedAt: number
  products: readonly Product[]
}

let activeCache: CachedCatalog | null = null
let inFlightPromise: Promise<readonly Product[]> | null = null
let inFlightBrand: BrandId | null = null
let inFlightEpoch = -1

// Discard cached catalog on brand change
onBrandChange(() => {
  clearScanCatalog()
})

/**
 * Obtain server-acknowledged product catalog for the captured brand.
 * Bounded one-shot, deduplicated in-flight, short-lived (3s TTL).
 * Rejects cleanly on failure without caching bad state or falling back to cache.
 */
export async function fetchScanCatalog(
  brand: BrandId,
  opts?: {
    force?: boolean
    loader?: (brand: BrandId) => Promise<readonly Product[]>
  },
): Promise<readonly Product[]> {
  const currentEpoch = brandEpoch()

  if (activeCache && (activeCache.brand !== brand || activeCache.epoch !== currentEpoch)) {
    activeCache = null
  }

  const now = Date.now()
  if (!opts?.force && activeCache && activeCache.brand === brand && activeCache.epoch === currentEpoch) {
    if (now - activeCache.fetchedAt < SCAN_CATALOG_TTL_MS) {
      return activeCache.products
    }
    activeCache = null
  }

  if (inFlightPromise && inFlightBrand === brand && inFlightEpoch === currentEpoch && !opts?.force) {
    return inFlightPromise
  }

  inFlightBrand = brand
  inFlightEpoch = currentEpoch

  const execute = async (): Promise<readonly Product[]> => {
    try {
      const products = opts?.loader
        ? await opts.loader(brand)
        : await backend.forBrand(brand).getAll<Product>(COL.products, { server: true, label: 'products.scan' })

      if (brandEpoch() === currentEpoch) {
        activeCache = {
          brand,
          epoch: currentEpoch,
          fetchedAt: Date.now(),
          products,
        }
      }
      return products
    } finally {
      inFlightPromise = null
      inFlightBrand = null
      inFlightEpoch = -1
    }
  }

  inFlightPromise = execute()
  return inFlightPromise
}

export function clearScanCatalog(): void {
  activeCache = null
  inFlightPromise = null
  inFlightBrand = null
  inFlightEpoch = -1
}
