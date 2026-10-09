import { useSyncExternalStore } from 'react'

/**
 * Whether the browser says it is online (plan C4). Every stock write is a transaction and
 * needs the network; before this nothing on screen said it was gone, and a save simply
 * spun or failed with a generic error.
 */
function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}
