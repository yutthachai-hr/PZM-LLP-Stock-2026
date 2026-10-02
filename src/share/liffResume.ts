import { getBrand, type BrandId } from '../brand/brand'
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

/** The same, for a company announcement (24 Sep 2026): its page reopens the send on it. */
export const ANNOUNCE_PARAM = 'announce'

/** The same, for the dashboard's daily digest (25 Sep 2026): the dashboard reopens the share. */
export const DIGEST_PARAM = 'digest'

export type ResumeParam = typeof RESUME_PARAM | typeof ANNOUNCE_PARAM | typeof DIGEST_PARAM

/**
 * Which brand the order belongs to, carried alongside it.
 *
 * The brand is picked once per visit and lives in React state, so every trip through LINE
 * comes back to the brand picker — and the order in `?send=` belongs to one brand, which
 * the person then has to guess at (owner's recording, 23 Sep 2026). Naming it here means
 * the resumed page opens the right brand and goes straight to the sheet.
 */
export const RESUME_BRAND_PARAM = 'brand'

/** The same page with `?send=<orderId>`, as an absolute URL (none outside a browser). */
export function resumeUrl(orderId: string, param: ResumeParam = RESUME_PARAM): string | undefined {
  if (typeof location === 'undefined') return undefined
  const u = new URL(location.href)
  u.searchParams.set(param, orderId)
  u.searchParams.set(RESUME_BRAND_PARAM, getBrand())
  return u.toString()
}

/** The LIFF address of the same page — opens it inside the LINE app, already signed in. */
export function liffUrl(orderId: string, param: ResumeParam = RESUME_PARAM): string {
  const path = typeof location === 'undefined' ? '' : location.pathname.replace(/^\//, '')
  const q = `${param}=${encodeURIComponent(orderId)}&${RESUME_BRAND_PARAM}=${getBrand()}`
  return `https://liff.line.me/${liffId()}/${path}?${q}`
}

/**
 * The brand a resumed send belongs to, when this page is one — nothing otherwise, so an
 * ordinary visit still starts at the picker, which is the owner's design.
 */
export function brandToResume(): BrandId | null {
  if (typeof location === 'undefined') return null
  const p = new URLSearchParams(location.search)
  if (!p.get(RESUME_PARAM) && !p.get(ANNOUNCE_PARAM) && !p.get(DIGEST_PARAM)) return null
  const b = p.get(RESUME_BRAND_PARAM)
  return b === 'pizza' || b === 'lelapin' ? b : null
}

/**
 * A page inside another app's own browser — LINE's, Facebook's, Instagram's.
 *
 * iOS gives such a webview the same `navigator.standalone === true` and the same
 * `display-mode: standalone` as a home-screen app, so those two cannot tell them apart;
 * the user agent can, and it is the only thing that can (23 Sep 2026).
 */
export function isInAppBrowser(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : (navigator.userAgent ?? '')
  return / Line\/|FBAN|FBAV|Instagram/i.test(ua)
}

/**
 * A page opened from the home screen rather than in a browser tab.
 *
 * Another app's in-app browser looks exactly like this to every API except the user agent,
 * and calling one a home-screen app is what made "ส่ง LINE" loop: inside LINE the page
 * handed itself back to LINE, which opened the same page again, forever (owner's recording,
 * 23 Sep 2026).
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (isInAppBrowser()) return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

/**
 * Whether this page has already sent itself to LINE for this order.
 *
 * The hand-over is a one-way trip: if the person is back here and still not signed in, it
 * did not work, and doing it again would only reload the page. Session storage, because the
 * question is about this visit — a later one starts fresh and may well succeed.
 */
const HANDOFF_KEY = 'pmstock:v1:liff-handoff'

export function handedOverToLine(orderId: string): boolean {
  try {
    return sessionStorage.getItem(HANDOFF_KEY) === orderId
  } catch {
    return false // private mode; one wasted hop is better than refusing to try at all
  }
}

export function rememberHandOver(orderId: string): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, orderId)
  } catch {
    /* nothing to remember it in */
  }
}
