export type HistoryStatus = 'idle' | 'loading' | 'complete' | 'empty' | 'error' | 'partial'
export interface HistoryResult<T> {
  key: string
  status: HistoryStatus
  rows: T[]
  error: string
  loadedAt: number | null
}

/** One complete scoped read. A response from an obsolete product/brand/request cannot publish. */
export function createHistoryRequest<T>(initialKey = '') {
  let sequence = 0
  let value: HistoryResult<T> = { key: initialKey, status: 'idle', rows: [], error: '', loadedAt: null }
  const listeners = new Set<() => void>()
  const publish = (next: HistoryResult<T>) => { value = next; for (const l of listeners) l() }
  return {
    get: () => value,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
    cancel() { sequence++ },
    async load(key: string, read: () => Promise<T[]>) {
      const mine = ++sequence
      publish({ key, status: 'loading', rows: [], error: '', loadedAt: null })
      try {
        const rows = await read()
        if (mine !== sequence) return
        publish({ key, status: rows.length ? 'complete' : 'empty', rows, error: '', loadedAt: Date.now() })
      } catch (e) {
        if (mine !== sequence) return
        publish({ key, status: 'error', rows: [], error: e instanceof Error ? e.message : String(e), loadedAt: null })
      }
    },
  }
}
