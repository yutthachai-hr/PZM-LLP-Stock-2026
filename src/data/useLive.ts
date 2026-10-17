import { useEffect, useState } from 'react'
import { backend } from '../backend'

/** Whether the held copy is known current with the server, and the last failure if not. */
export interface SyncStatus {
  serverSynced: boolean
  error: unknown | null
}

export const SYNC_INITIAL: SyncStatus = { serverSynced: false, error: null }

/**
 * A server acknowledgement clears any earlier failure: a cold start that was offline and
 * then reconnected has a current copy, and refusing scans for the rest of the session would
 * be wrong. A failure keeps blocking until the next acknowledgement, because a listener that
 * errored has stopped delivering changes.
 */
export function syncStatusAfter(s: SyncStatus, e: { kind: 'synced' } | { kind: 'failed'; error: unknown }): SyncStatus {
  return e.kind === 'synced' ? { serverSynced: true, error: null } : { ...s, error: e.error }
}

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
    label,
  }: { enabled?: boolean; sinceField?: string; sinceValue?: number; label?: string } = {},
): { data: T[]; loading: boolean; serverSynced: boolean; error: unknown | null } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [sync, setSync] = useState<SyncStatus>(SYNC_INITIAL)

  useEffect(() => {
    if (!enabled) {
      setData([])
      setLoading(false)
      setSync(SYNC_INITIAL)
      return
    }
    setLoading(true)
    setSync(SYNC_INITIAL)
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
      {
        ...(since ? { since } : {}),
        ...(label ? { label } : {}),
        onServerSync: () => setSync((cur) => syncStatusAfter(cur, { kind: 'synced' })),
        // A listener the rules refuse, or that cannot connect, used to leave the screen
        // loading forever. Stop waiting; the data stays whatever it was.
        onError: (err) => {
          setSync((cur) => syncStatusAfter(cur, { kind: 'failed', error: err }))
          setLoading(false)
        },
      },
    )
    return unsub
  }, [collection, enabled, sinceField, sinceValue, label])

  return { data, loading, serverSynced: sync.serverSynced, error: sync.error }
}
