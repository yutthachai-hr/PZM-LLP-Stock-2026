import { useEffect, useRef } from 'react'

/**
 * Sign out after a stretch of no activity.
 *
 * The branches share a tablet, so "signed in" is not the same as "the person who signed in
 * is standing there". Without this, whoever picks the device up next is whoever last used
 * it, as far as the ledger is concerned — and every movement is recorded under that name.
 *
 * Deliberately generous: staff put the device down mid-count, and being logged out while
 * counting a shelf would be worse than the risk this closes. Any real interaction resets
 * the clock, and a timer that fires while the tab is in the background still counts, which
 * is the case that matters — a device left on a counter overnight.
 */
const IDLE_MS = 20 * 60 * 1000

/** Things that mean a person is actually there. */
const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const

export function useIdleLogout(active: boolean, onIdle: () => void): void {
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
    if (!active) return

    let timer: ReturnType<typeof setTimeout>
    // Wall-clock, not the timer, decides: a suspended laptop or a throttled background tab
    // does not fire setTimeout on schedule, and coming back after two hours should not
    // count as two minutes.
    let lastSeen = Date.now()

    const check = () => {
      const idleFor = Date.now() - lastSeen
      if (idleFor >= IDLE_MS) {
        onIdleRef.current()
        return
      }
      timer = setTimeout(check, IDLE_MS - idleFor)
    }

    const touch = () => {
      lastSeen = Date.now()
    }

    for (const event of ACTIVITY) {
      window.addEventListener(event, touch, { passive: true })
    }
    // Returning to the tab is not activity, but it is the moment to notice how long it has
    // been — otherwise a background tab's throttled timer hides an overnight gap.
    document.addEventListener('visibilitychange', check)
    timer = setTimeout(check, IDLE_MS)

    return () => {
      clearTimeout(timer)
      for (const event of ACTIVITY) window.removeEventListener(event, touch)
      document.removeEventListener('visibilitychange', check)
    }
  }, [active])
}

export const IDLE_MINUTES = IDLE_MS / 60000
