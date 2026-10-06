import { useCallback, useEffect, useRef, useState } from 'react'
import { backend } from '../backend'
import { retryDelayMs } from '../auth/profileError'
import { liveErrorKind, retriesBySelf, type LiveFailure } from './liveError'

/**
 * Subscribe to a collection in real time.
 *
 * `enabled: false` skips the subscription and reports an empty list — used for data the
 * signed-in role is not allowed to read, so the security rules never have to reject a
 * query the app should not have made.
 *
 * `sinceField`/`sinceValue` bound an ever-growing collection to a recent window. Changing
 * `sinceValue` re-subscribes, which is how the ledger window widens on demand.
 *
 * A listener the database ends (plan C1) is reported as `error`, and the last rows it
 * delivered stay — marked stale by the error, not replaced by an empty list that would
 * read as "nothing here". A dropped connection subscribes again by itself with backoff;
 * a refusal or a spent quota waits for `retry()`.
 */
export function useLive<T>(
  collection: string,
  {
    enabled = true,
    sinceField,
    sinceValue,
  }: { enabled?: boolean; sinceField?: string; sinceValue?: number } = {},
): { data: T[]; loading: boolean; error: LiveFailure | null; retry: () => void } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<LiveFailure | null>(null)
  const [attempt, setAttempt] = useState(0)
  const failures = useRef(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    if (!enabled) {
      setData([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    const since =
      sinceField !== undefined && sinceValue !== undefined
        ? { field: sinceField, value: sinceValue }
        : undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = backend.subscribe<T>(
      collection,
      (docs) => {
        failures.current = 0
        setData(docs)
        setLoading(false)
        setError(null)
      },
      since ? { since } : undefined,
      (err) => {
        const kind = liveErrorKind(err)
        setError({ collection, kind })
        setLoading(false)
        if (retriesBySelf(kind)) timer = setTimeout(() => setAttempt((n) => n + 1), retryDelayMs(++failures.current))
      },
    )
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
    // `attempt` only re-runs this effect: a retry is a new subscription.
  }, [collection, enabled, sinceField, sinceValue, attempt])

  return { data, loading, error, retry }
}
