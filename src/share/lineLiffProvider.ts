import { AppError } from '../i18n/AppError'
import type { PurchaseShareProvider, SharePayload, ShareOutcome } from './PurchaseShareProvider'

/**
 * Sending the sheet from the person's own LINE account, through LIFF's share target picker.
 *
 * This is the official way for a web page to send a message as the person using it: LINE
 * opens its own friend-and-group picker, the person picks the supplier, LINE sends. No
 * Official Account, no bot, nothing running in the background — the same as tapping
 * "share to LINE" by hand, with the picker opened for them.
 *
 * What it needs, all set up once by the owner in the LINE Developers console: a LINE Login
 * channel with a LIFF app whose endpoint is this site, and "share target picker" switched on
 * for that LIFF app. The id goes in VITE_LIFF_ID. In an ordinary browser the person is
 * taken through LINE Login the first time; inside the LINE app they already are.
 *
 * An image message is two public URLs, not a file — LINE fetches them — so the sheet is
 * hosted first (services/poImages) and this provider is told where.
 *
 * The result is read exactly as LINE reports it: `{status: 'success'}` means LINE sent the
 * message; the promise resolving with nothing means the person closed the picker; a
 * rejection is an error. Nothing here claims more than that.
 */

/**
 * The LIFF apps the owner registered, by the host they point at. A LIFF app has exactly
 * one Endpoint URL, so an id only works on the host LINE was told about; listing them by
 * host means a deploy on either platform finds its own without a build variable — which
 * Cloudflare Pages will not take from its dashboard once a wrangler.toml exists. Ids are
 * public (they ship in the client bundle). VITE_LIFF_ID still overrides, for the demo
 * branch and for trying a new app before it is listed here.
 */
const LIFF_BY_HOST: Record<string, string> = {
  'pzmstock.netlify.app': '2011602857-k9K8Zplx',
  'pzmstock.pages.dev': '2011602857-k9K8Zplx',
}

/** The LIFF app id for this deployment, or '' when it has none. */
export function liffId(): string {
  const fromEnv = (import.meta.env.VITE_LIFF_ID ?? '').trim()
  if (fromEnv) return fromEnv
  if (typeof location === 'undefined') return ''
  return LIFF_BY_HOST[location.hostname] ?? ''
}

type Liff = typeof import('@line/liff').default

let ready: Promise<Liff> | null = null

async function liff(): Promise<Liff> {
  if (!ready) {
    ready = (async () => {
      const id = liffId()
      if (!id) throw new AppError('เครื่องนี้ยังไม่ได้ตั้งค่า LINE (LIFF)')
      const { default: sdk } = await import('@line/liff')
      await sdk.init({ liffId: id })
      return sdk
    })().catch((e) => {
      ready = null
      throw e
    })
  }
  return ready
}

export const lineLiffProvider: PurchaseShareProvider = {
  id: 'line-liff',
  label: 'ส่ง LINE', // i18n-key
  needsHosting: true,

  async isAvailable() {
    if (!liffId()) return false
    try {
      const sdk = await liff()
      // In an ordinary browser the SDK reports the picker unavailable until the person has
      // been through LINE Login (seen on the demo deploy: init fine, picker false, not
      // logged in). That is not "no LINE here" — it is "not yet signed in", and share()
      // takes them through login. Only a signed-in SDK that still says no means no.
      if (sdk.isInClient() || !sdk.isLoggedIn()) return true
      return sdk.isApiAvailable('shareTargetPicker')
    } catch {
      return false
    }
  },

  async share(payload: SharePayload): Promise<ShareOutcome> {
    const sdk = await liff()
    if (!sdk.isLoggedIn()) {
      // Off to LINE Login and back to this very page; the wizard resumes from the order's
      // recorded status, so nothing is lost across the round trip.
      sdk.login({ redirectUri: typeof location === 'undefined' ? undefined : location.href })
      return 'cancelled'
    }
    if (!sdk.isApiAvailable('shareTargetPicker')) {
      throw new AppError('LINE รุ่นนี้หรือการตั้งค่า LIFF ยังไม่รองรับการเลือกผู้รับ')
    }
    if (!payload.hosted) throw new AppError('ยังไม่มีรูปสำหรับส่ง')
    const result = await sdk.shareTargetPicker(
      [
        {
          type: 'image',
          originalContentUrl: payload.hosted.url,
          previewImageUrl: payload.hosted.previewUrl,
        },
      ],
      { isMultiple: true },
    )
    return result && result.status === 'success' ? 'sent' : 'cancelled'
  },
}
