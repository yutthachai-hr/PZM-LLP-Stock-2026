import { useEffect, useState } from 'react'
import { backend } from '../backend'

/**
 * Subscribe to a collection in real time.
 *
 * `enabled: false` skips the subscription and reports an empty list — used for data the
 * signed-in role is not allowed to read, so the security rules never have to reject a
 * query the app should not have made.
 *
 * `sinceField`/`sinceValue` bound an ever-growing collection to a recent window. Changing
 * `sinceValue` re-subscribes, which is how the ledger window widens on demand.
 */
export function useLive<T>(
  collection: string,
  {
    enabled = true,
    sinceField,
    sinceValue,
  }: { enabled?: boolean; sinceField?: string; sinceValue?: number } = {},
): { data: T[]; loading: boolean } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!enabled) {
      setData([])
      setLoading(false)
      return
    }
    setLoading(true)
    const since =
      sinceField !== undefined && sinceValue !== undefined
        ? { field: sinceField, value: sinceValue }
        : undefined
    const unsub = backend.subscribe<T>(
      collection,
      (docs) => {
        setData(docs)
        setLoading(false)
      },
      since ? { since } : undefined,
    )
    return unsub
  }, [collection, enabled, sinceField, sinceValue])

  return { data, loading }
}
