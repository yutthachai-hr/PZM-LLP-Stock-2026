import { useEffect, useRef } from 'react'
import { useAuth } from '../auth/AuthContext'
import { BACKEND_MODE } from '../backend'
import { brandEpoch, getBrand } from '../brand/brand'
import { runNotificationJobs, runOnOpen, shouldRunNotifications } from '../services/automation'
import type { Role } from '../types'
import { useData } from './DataContext'

/** Demo mode has no Worker at all, so it re-checks more often; live it is a fallback. */
const EVERY_MS = BACKEND_MODE === 'local' ? 5 * 60_000 : 30 * 60_000

/**
 * The background jobs, for as long as the app is open: today's stock counts once a day,
 * and what to announce every half hour — but live only when the cron Worker is late
 * (see services/automation.ts). Mounted once, in Layout. Failures are silent: the screens
 * show what exists either way, and the next run tries again.
 */
export function useAutomation(): void {
  const { user } = useAuth()
  const data = useData()
  const latest = useRef(data)
  latest.current = data
  const ready = !data.loading && !!user

  useEffect(() => {
    if (!ready || !user) return
    let stopped = false
    const actor = { id: user.id, name: user.name, role: user.role as Role }
    const tick = async () => {
      // The brand this run is for, and the brand epoch, taken once at the start of the tick
      // (services/automation.ts): `latest.current` is read after an await below, and any switch
      // in between — even A → B → A — makes the jobs stop rather than use it.
      const brand = getBrand()
      const epoch = brandEpoch()
      try {
        await runOnOpen(actor, undefined, brand, epoch)
        if (!stopped && (await shouldRunNotifications(actor.role, undefined, brand))) await runNotificationJobs(actor, latest.current, undefined, brand, epoch)
      } catch {
        // see above
      }
    }
    void tick()
    const id = setInterval(() => void tick(), EVERY_MS)
    return () => {
      stopped = true
      clearInterval(id)
    }
    // Keyed on the person, not the data: the ref hands each run the latest data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id])
}
