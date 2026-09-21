import { useEffect, useState } from 'react'

/**
 * The three shells of the interface (spec, 21 Sep 2026): a phone gets the bottom tab bar,
 * a tablet the left rail, a desktop the sidebar it has always had. The numbers are
 * Tailwind's `md` and `xl` breakpoints, so classes and code agree on where each begins.
 */
export type Viewport = 'phone' | 'tablet' | 'desktop'

export const PHONE_MAX = 767
export const TABLET_MAX = 1279

export function viewportFor(width: number): Viewport {
  if (width <= PHONE_MAX) return 'phone'
  if (width <= TABLET_MAX) return 'tablet'
  return 'desktop'
}

/** The current shell, following window resizes. Only for behaviour that differs; layout is CSS. */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => (typeof window === 'undefined' ? 'desktop' : viewportFor(window.innerWidth)))
  useEffect(() => {
    const mqPhone = window.matchMedia(`(max-width: ${PHONE_MAX}px)`)
    const mqTablet = window.matchMedia(`(max-width: ${TABLET_MAX}px)`)
    const update = () => setVp(viewportFor(window.innerWidth))
    mqPhone.addEventListener('change', update)
    mqTablet.addEventListener('change', update)
    update()
    return () => {
      mqPhone.removeEventListener('change', update)
      mqTablet.removeEventListener('change', update)
    }
  }, [])
  return vp
}
