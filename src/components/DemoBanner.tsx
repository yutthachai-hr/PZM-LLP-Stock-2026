import { BACKEND_MODE } from '../backend'
import { isDemoMode } from '../firebase/config'
import { useT } from '../i18n/I18nContext'
import { Icon } from './Icon'

/**
 * Says, on every screen, that this build is not the real warehouse.
 *
 * A demo is shown to people who cannot tell it apart from production by looking — the
 * screens are identical and the product names are the company's own. Whoever is being
 * shown it has to be able to see, whenever they glance down, that these are not the
 * numbers the branches count against.
 *
 * Fixed rather than a strip across the top: the mobile header and every table head are
 * `sticky top-0`, and a bar occupying the top of the viewport either covers them or
 * pushes the document past 100vh. Bottom-left is the one corner nothing else claims —
 * Toast sits bottom-right and UpdateBanner spans the bottom edge only when an update is
 * actually waiting, which a demo build never has.
 *
 * It sits below the drawer and the modals rather than above them. Being permanently on
 * screen is the point, but not at the cost of covering the sign-out button in an open
 * menu — and anything that covers the page is itself transient.
 */
export function DemoBanner() {
  const t = useT()
  if (!isDemoMode()) return <LiveDataOnLocalhostWarning />
  return (
    <div
      role="status"
      className="fixed bottom-3 left-3 z-[35] flex items-center gap-1.5 rounded-full bg-danger px-3 py-1.5 text-xs font-semibold text-white shadow-lg [margin-bottom:env(safe-area-inset-bottom)]"
    >
      <Icon name="warning" size={13} />
      <span>{t('โหมดสาธิต — ไม่ใช่สต๊อกจริง')}</span>
    </div>
  )
}

/**
 * Says when a development server is pointed at the real warehouse.
 *
 * `npm run demo` sets VITE_DEMO_MODE through .env.demo, and the flag is read at build time.
 * On 2026-09-11 a merge rewrote vite.config.ts and .env.demo at once; Vite auto-restarted
 * on the config change and came back **without the mode flag**. The dev server was then in
 * Cloud mode against pzm-stock-x5, and the only sign was the absence of the demo pill —
 * the absence of a thing, which is not something anyone notices.
 *
 * A missing flag must not fail silently in the direction of production, so the check is
 * inverted here: localhost plus cloud mode is stated loudly, whatever the reason. In a real
 * deployment the hostname is not localhost and nothing renders.
 */
function LiveDataOnLocalhostWarning() {
  const t = useT()
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
  if (!local || BACKEND_MODE !== 'cloud') return null
  return (
    <div
      role="alert"
      className="fixed bottom-3 left-3 z-[35] flex items-center gap-1.5 rounded-full bg-danger px-3 py-1.5 text-xs font-semibold text-white shadow-lg [margin-bottom:env(safe-area-inset-bottom)]"
    >
      <Icon name="warning" size={13} />
      <span>{t('เซิร์ฟเวอร์ทดสอบนี้ต่อกับข้อมูลจริง — ใช้ npm run demo')}</span>
    </div>
  )
}
