import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'

/**
 * What is half-keyed on a screen survives leaving it.
 *
 * A delivery note takes a while to key; someone opens the history to check a figure,
 * or the tablet is picked up by the next person, and the lines were gone (owner,
 * 21 Sep 2026). So the form's state is kept in this browser, per screen, per brand,
 * per person, and put back when the screen opens again — with a note saying so, and a
 * way to throw it away. It is cleared the moment the form is filed.
 *
 * Only this device: a draft is not a record, nothing is written to the database, and
 * pictures (a data URL can be megabytes) are never kept. Storage can be missing or full
 * — a private window, a wiped tablet — and then the form simply behaves as before.
 */
export function useDraft<T extends object>(
  screen: string,
  value: T,
  restore: (saved: T) => void,
  /** Whether there is anything worth keeping — an untouched form is not a draft. */
  isEmpty: (v: T) => boolean,
): { restored: boolean; clear: () => void } {
  const { user } = useAuth()
  const { brand } = useBrand()
  const key = `draft:${brand ?? ''}:${user?.id ?? ''}:${screen}`
  const [restored, setRestored] = useState(false)
  // The first render must not overwrite the saved draft with the empty form.
  const loaded = useRef(false)
  const restoreRef = useRef(restore)
  restoreRef.current = restore

  useEffect(() => {
    loaded.current = false
    setRestored(false)
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const saved = JSON.parse(raw) as T
        if (!isEmpty(saved)) {
          restoreRef.current(saved)
          setRestored(true)
        }
      }
    } catch {
      /* unreadable or missing storage: start clean */
    }
    loaded.current = true
    // Re-run only when the person or brand changes; the form's own state must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!loaded.current) return
    const h = setTimeout(() => {
      try {
        if (isEmpty(value)) localStorage.removeItem(key)
        else localStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* full or blocked storage: the form still works, it just is not kept */
      }
    }, 300)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value])

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* nothing to clear */
    }
    setRestored(false)
  }, [key])

  return { restored, clear }
}
