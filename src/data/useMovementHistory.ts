import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useBrand } from '../brand/BrandContext'
import { brandEpoch, getBrand } from '../brand/brand'
import { readProductLedger, listMovementsInRange } from '../services/stock'
import type { StockMovement } from '../types'
import { createHistoryRequest, type HistoryResult } from './historyRequest'
import { subscribeRecentWrites } from './recentWrites'

/** Full product history OR an explicit business-date range. Never widens the live listener. */
export function useMovementHistory(productId: string, from?: number, to?: number) {
  const { brand } = useBrand()
  const key = `${brand}::${productId || `${from}:${to}`}`
  const request = useMemo(() => createHistoryRequest<StockMovement>(key), [key])
  const result = useSyncExternalStore(request.subscribe, request.get, request.get)
  const enabled = !!brand && (!!productId || (from !== undefined && to !== undefined && from < to))
  const refresh = useCallback((force = false) => {
    if (!enabled || !brand) return
    const epoch = brandEpoch()
    void request.load(key, async () => {
      const rows = productId
        ? await readProductLedger(productId, { force, brand })
        : await listMovementsInRange(from!, to! - 1, { brand, server: true })
      if (getBrand() !== brand || brandEpoch() !== epoch) throw new Error('History scope changed')
      return rows
    })
  }, [enabled, brand, key, productId, from, to, request])
  useEffect(() => {
    refresh()
    const noted = new Map<string, string>()
    const unsubscribe = subscribeRecentWrites((rows) => {
      if (!enabled) return
      let changed = false
      for (const row of rows) {
        if (productId && row.productId !== productId) continue
        const fingerprint = JSON.stringify(row)
        if (noted.get(row.id) !== fingerprint) { noted.set(row.id, fingerprint); changed = true }
      }
      // The recent-write sink includes earlier writes too. Unrelated writes must not cause
      // a repeated full product read just because this product is still in that sink.
      if (changed) refresh(true)
    })
    const onFocus = () => {
      const at = request.get().loadedAt
      if (!at || Date.now() - at >= 60_000) refresh(true)
    }
    window.addEventListener('focus', onFocus)
    return () => { unsubscribe(); window.removeEventListener('focus', onFocus); request.cancel() }
  }, [refresh, enabled, productId, request])
  const state: HistoryResult<StockMovement> = enabled && result.status === 'idle'
    ? { ...result, key, status: 'loading' }
    : result
  return { ...state, ready: state.status === 'complete' || state.status === 'empty', retry: () => refresh(true) }
}
