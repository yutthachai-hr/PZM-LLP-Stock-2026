import { liffId } from './lineLiffProvider'

/**
 * Finish a LINE Login round trip before the app draws anything.
 *
 * In an ordinary browser, `liff.login()` sends the person to LINE and LINE sends them back
 * to the LIFF endpoint — the site root — with `code`, `state` and `liff.state` (the page
 * they were on) in the URL. Only `liff.init()` knows what to do with those: it swaps the
 * code for a token and moves the browser on to `liff.state`. The SDK is loaded lazily, on
 * the send screen, so without this the person landed on the brand picker at `/?code=…`
 * with the login half-done and the order screen nowhere in sight (seen on the demo deploy,
 * 15 Sep 2026).
 *
 * Runs only when the URL carries those parameters, so the SDK costs nothing on any other
 * load. If the SDK's own redirect does not happen, the page moves itself to `liff.state`.
 */
export async function completeLiffLoginIfReturning(): Promise<void> {
  if (typeof location === 'undefined' || !liffId()) return
  const params = new URLSearchParams(location.search)
  const target = params.get('liff.state')
  if (!params.has('code') && !target) return
  try {
    const { default: sdk } = await import('@line/liff')
    await sdk.init({ liffId: liffId() })
  } catch {
    // A failed exchange is reported when the person next presses "send"; the page they
    // wanted is still the right place to put them.
  }
  if (target && target.startsWith('/') && location.pathname + location.search !== target) {
    history.replaceState(null, '', target)
  }
}
