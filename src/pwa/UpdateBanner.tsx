import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { useT } from '../i18n/I18nContext'

/**
 * Tells people a new version is ready, and applies it when they say so.
 *
 * This app is a PWA, so a service worker serves it from a local cache. Publishing a new
 * build does NOT reach anyone already running the old one: their browser keeps serving the
 * cached app until the worker happens to update, which can be the next day. That is not a
 * cosmetic problem — the release that added `updatedBy` to balance writes went out with the
 * security rules that require it, and every device still on the old build could not record
 * stock at all until it reloaded twice.
 *
 * Deliberately a prompt rather than an automatic reload: staff key in a receipt one line at
 * a time, and reloading under them would throw the form away. So the app asks, and keeps
 * asking, until someone is at a good moment to say yes.
 */
const CHECK_EVERY_MS = 15 * 60 * 1000

export function UpdateBanner() {
  const t = useT()
  const [ready, setReady] = useState(false)
  const [apply, setApply] = useState<(() => void) | null>(null)

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setReady(true)
        // Store it wrapped: a bare function in setState would be called, not stored.
        setApply(() => () => updateSW(true))
      },
      onRegisteredSW(_url, registration) {
        if (!registration) return
        // Ask the server whether there is a newer worker. Without this the browser only
        // checks on navigation, so a device left open on one screen never finds out.
        const tick = () => {
          if (document.visibilityState === 'visible') void registration.update()
        }
        const timer = setInterval(tick, CHECK_EVERY_MS)
        document.addEventListener('visibilitychange', tick)
        return () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', tick)
        }
      },
    })
  }, [])

  if (!ready) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center justify-center gap-3 bg-ink px-4 py-3 text-sm text-white shadow-lg">
      <span>{t('มีเวอร์ชันใหม่ของระบบพร้อมใช้งานแล้ว')}</span>
      <button
        onClick={() => apply?.()}
        className="min-h-11 cursor-pointer rounded-lg bg-surface px-4 py-2 font-semibold text-ink hover:bg-sunken"
      >
        {t('อัปเดตตอนนี้')}
      </button>
      <button
        onClick={() => setReady(false)}
        className="min-h-11 cursor-pointer rounded-lg px-3 py-2 text-ink-faint hover:text-white"
      >
        {t('ไว้ทีหลัง')}
      </button>
    </div>
  )
}
