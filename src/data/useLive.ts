import { reportError } from '../services/errorReporter'
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
 * `sinceValue` re-subscribes. `label` names the listener for the read meter (data/readMeter).
 *
 * A listener the database ends (plan C1) is reported as `error`, and the last rows it
 * delivered stay — marked stale by the error, not replaced by an empty list that would
 * read as "nothing here". A dropped connection subscribes again by itself with backoff;
 * a refusal or a spent quota waits for `retry()`.
 *
 * The big sets kept on the device and refreshed by what changed use useSynced
 * (data/syncedCollection, perf/firestore-read-budget), which is built on this.
 */
export function useLive<T>(
  collection: string,
  {
    enabled = true,
    sinceField,
    sinceValue,
    label,
  }: { enabled?: boolean; sinceField?: string; sinceValue?: number; label?: string } = {},
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
    const startedAt = Date.now()
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
      {
        ...(since ? { since } : {}),
        ...(label ? { label } : {}),
        // A listener the rules refuse, or that cannot connect, used to leave the screen
        // loading forever. Stop waiting, keep the data, and say so (plan C1).
        onError: (err: unknown) => {
          const kind = liveErrorKind(err)
          // E4: a listener the database ended. Offline is the network, not a fault worth a report.
          if (kind !== 'offline') reportError(Object.assign(new Error(`listener ${collection}`), { name: `listener.${kind}` }), 'listener')
          setError({ collection, kind, startedAt })
          setLoading(false)
          if (retriesBySelf(kind)) timer = setTimeout(() => setAttempt((n) => n + 1), retryDelayMs(++failures.current))
        },
      },
    )
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
    // `attempt` only re-runs this effect: a retry is a new subscription.
  }, [collection, enabled, sinceField, sinceValue, label, attempt])

  return { data, loading, error, retry }
}
