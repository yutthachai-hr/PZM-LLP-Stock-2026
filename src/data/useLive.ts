import { useEffect, useState } from 'react'
import { backend } from '../backend'

/** Subscribe to a whole collection in real time. */
export function useLive<T>(collection: string): { data: T[]; loading: boolean } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const unsub = backend.subscribe<T>(collection, (docs) => {
      setData(docs)
      setLoading(false)
    })
    return unsub
  }, [collection])

  return { data, loading }
}
