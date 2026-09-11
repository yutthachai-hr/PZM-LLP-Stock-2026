import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { useT } from '../i18n/I18nContext'

/**
 * Offers to put the app on the phone's home screen.
 *
 * The branches run this on a shared tablet. Opened from a browser tab it is one of
 * twenty tabs, behind an address bar, and whoever picks the device up next has to find
 * it again; installed it is an icon, full height, and it reopens where it was. The
 * difference is large enough that it should be offered rather than left to whoever knows
 * the browser menu.
 *
 * Two paths, because the platforms do not agree:
 *
 * - Chrome fires `beforeinstallprompt` and will install on a tap, so this is a button.
 * - iOS Safari has no such event and never will. It can only be told where the button is
 *   — Share, then Add to Home Screen — so on iOS this is a sentence, not a control.
 *
 * Dismissal is remembered. Someone who has said no, or who reads this on a desktop they
 * do not want it on, should not be asked again on every visit.
 */

const DISMISSED = 'pmstock:installHintDismissed'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS predates display-mode and reports this instead.
  return (window.navigator as { standalone?: boolean }).standalone === true
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  // Chrome and Firefox on iOS cannot install either, and their menus differ, so the
  // instruction is only shown where it is true.
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}

export function InstallHint() {
  const t = useT()
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [ios, setIos] = useState(false)
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = localStorage.getItem(DISMISSED) === '1'
    } catch {
      /* private mode — treat as not dismissed */
    }
    if (dismissed || isStandalone()) return

    if (isIosSafari()) {
      setIos(true)
      setHidden(false)
      return
    }

    function onPrompt(e: Event) {
      // Keeping the event is what allows install() to be OUR button rather than the
      // browser's own bar, which Chrome only shows on its own terms.
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
      setHidden(false)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', dismiss)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', dismiss)
    }
  }, [])

  function dismiss() {
    setHidden(true)
    try {
      localStorage.setItem(DISMISSED, '1')
    } catch {
      /* nothing to remember it in; it will ask again */
    }
  }

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    await prompt.userChoice
    dismiss()
  }

  if (hidden || (!ios && !prompt)) return null

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand/20 bg-brand-soft px-4 py-3">
      <img src="/pwa-192.png" alt="" width={36} height={36} className="rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">{t('ติดตั้งลงหน้าจอโฮม')}</div>
        <div className="text-xs text-ink-soft">
          {ios
            ? t('กดปุ่มแชร์ในแถบล่าง แล้วเลือก "เพิ่มไปยังหน้าจอโฮม"')
            : t('เปิดเร็วกว่า เต็มจอ และไม่ต้องหาแท็บ')}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!ios && (
          <button
            onClick={install}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Icon name="download" size={16} />
            {t('ติดตั้ง')}
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label={t('ปิด')}
          className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-ink-soft outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <Icon name="x" size={18} />
        </button>
      </div>
    </div>
  )
}
