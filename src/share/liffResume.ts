import { liffId } from './lineLiffProvider'

/**
 * Picking the send screen back up after LINE Login has taken the person away.
 *
 * In an ordinary phone browser the first "ส่ง LINE" goes to LINE Login and comes back to
 * the page — and the wizard, which was component state, was gone: the person landed on
 * the orders list with nothing to show for the tap (owner, 22 Sep 2026: "เด้งกลับมา
 * หน้าเดิม"). The order to resume travels in the URL (`?send=<orderId>`) rather than in
 * storage, because on an iPhone a home-screen app and Safari do not share storage and the
 * login round trip can land in either. The page that owns the wizard reads it once, opens
 * the wizard on that order, and clears it.
 *
 * Inside the LINE app itself none of this is needed — LIFF is signed in already — so a
 * home-screen app, which cannot complete a login round trip at all, is sent there instead:
 * the LIFF URL opens the same page in LINE with the same `?send=` parameter.
 */
export const RESUME_PARAM = 'send'

/** The same page with `?send=<orderId>`, as an absolute URL (none outside a browser). */
export function resumeUrl(orderId: string): string | undefined {
  if (typeof location === 'undefined') return undefined
  const u = new URL(location.href)
  u.searchParams.set(RESUME_PARAM, orderId)
  return u.toString()
}

/** The LIFF address of the same page — opens it inside the LINE app, already signed in. */
export function liffUrl(orderId: string): string {
  const path = typeof location === 'undefined' ? '' : location.pathname.replace(/^\//, '')
  return `https://liff.line.me/${liffId()}/${path}?${RESUME_PARAM}=${encodeURIComponent(orderId)}`
}

/** A page opened from the home screen rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}
