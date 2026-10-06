import { useEffect, useState } from 'react'
import { backend } from '../backend'
import { getBrand } from '../brand/brand'
import { COL } from '../types'
import { cacheEpochId } from '../services/cacheEpoch'

/**
 * The brand's cache epoch (services/cacheEpoch), live: undefined until it has answered.
 * A missing document, or one the rules will not show yet (rules deployed after the app),
 * reads as all-zero — the caches then rebuild weekly instead of on an admin's signal.
 */
export function useCacheEpoch(enabled: boolean): Record<string, number> | undefined {
  const [epoch, setEpoch] = useState<Record<string, number> | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    setEpoch(undefined)
    return backend.subscribeOne<Record<string, number>>(
      COL.meta,
      cacheEpochId(getBrand()),
      (doc) => setEpoch(doc ? Object.fromEntries(Object.entries(doc).filter(([, v]) => typeof v === 'number')) : {}),
      () => setEpoch({}),
    )
  }, [enabled])
  return epoch
}
