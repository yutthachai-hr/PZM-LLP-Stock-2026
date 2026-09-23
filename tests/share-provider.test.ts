// What a share provider may claim, read off exactly what LINE reports.
//
//   npm test
//
// The owner's rule: never mark a sheet "sent" because somebody pressed a button. LINE's
// picker resolves with {status:'success'} when it sent, with nothing when the person closed
// it, and rejects on error — and those are the only three things the app knows.

import { beforeEach, describe, expect, test, vi } from 'vitest'

const sdk = {
  init: vi.fn(async () => {}),
  isInClient: vi.fn(() => false),
  isLoggedIn: vi.fn(() => true),
  login: vi.fn(),
  isApiAvailable: vi.fn(() => true),
  shareTargetPicker: vi.fn(async (): Promise<{ status: 'success' } | void> => ({ status: 'success' })),
}
vi.mock('@line/liff', () => ({ default: sdk }))
vi.stubEnv('VITE_LIFF_ID', '1234567890-abcdefgh')

const { lineLiffProvider } = await import('../src/share/lineLiffProvider')
const { statusFor } = await import('../src/share/PurchaseShareProvider')
const { RESUME_PARAM, resumeUrl, liffUrl, isStandalone, brandToResume } = await import('../src/share/liffResume')
const { setActiveBrand } = await import('../src/brand/brand')
import type { SharePayload } from '../src/share/PurchaseShareProvider'

const payload = (): SharePayload => ({
  order: {
    id: 'o1',
    docNo: 'PO-00001',
    supplierId: 's',
    supplierName: 'THAINAMTHIP',
    status: 'ordered',
    locationId: 'l',
    orderedAt: 0,
    lines: [],
    createdBy: 'u',
    createdByName: 'U',
    createdAt: 0,
    updatedAt: 0,
  },
  page: { n: 1, of: 1 },
  file: new File([new Uint8Array([1, 2, 3])], 'PO-00001.jpg', { type: 'image/jpeg' }),
  hosted: { url: 'https://x/po/a.jpg', previewUrl: 'https://x/po/b.jpg', version: 1, expiresAt: 1 },
  caption: 'ใบสั่งซื้อ PO-00001 — Pizza Mania',
})

beforeEach(() => {
  vi.clearAllMocks()
  sdk.isInClient.mockReturnValue(false)
  sdk.isLoggedIn.mockReturnValue(true)
  sdk.isApiAvailable.mockReturnValue(true)
})

describe('the LINE (LIFF) provider', () => {
  test('sends the caption and then the picture, to one or many recipients', async () => {
    // The phone's share sheet carries the title itself; the picker has to say it as a
    // message, or the supplier gets a bare picture (owner, 21 Sep 2026).
    const out = await lineLiffProvider.share(payload())
    expect(out).toBe('sent')
    expect(sdk.shareTargetPicker).toHaveBeenCalledWith(
      [
        { type: 'text', text: 'ใบสั่งซื้อ PO-00001 — Pizza Mania' },
        { type: 'image', originalContentUrl: 'https://x/po/a.jpg', previewImageUrl: 'https://x/po/b.jpg' },
      ],
      { isMultiple: true },
    )
    expect(statusFor(out)).toBe('sent')
  })

  test('a closed picker is cancelled, and records nothing', async () => {
    sdk.shareTargetPicker.mockResolvedValueOnce(undefined)
    const out = await lineLiffProvider.share(payload())
    expect(out).toBe('cancelled')
    expect(statusFor(out)).toBeNull()
  })

  test('a picker error is an error, not a quiet cancel', async () => {
    sdk.shareTargetPicker.mockRejectedValueOnce(new Error('FORBIDDEN'))
    await expect(lineLiffProvider.share(payload())).rejects.toThrow('FORBIDDEN')
  })

  test('not logged in: off to LINE Login, nothing sent', async () => {
    sdk.isLoggedIn.mockReturnValue(false)
    expect(await lineLiffProvider.share(payload())).toBe('cancelled')
    expect(sdk.login).toHaveBeenCalledTimes(1)
    expect(sdk.shareTargetPicker).not.toHaveBeenCalled()
  })

  // 22 Sep 2026: on a phone the first tap went to LINE Login and came back to the orders
  // list with the wizard gone ("เด้งกลับมาหน้าเดิม"). The order rides along in the URL so the
  // page can reopen the wizard on it; a home-screen app, which cannot finish the round trip,
  // is sent to the same page inside LINE instead.
  describe('coming back to the sheet after LINE Login', () => {

    test('the login redirect carries ?send=<order> on the same page', async () => {
      vi.stubGlobal('location', { href: 'https://pzmstock.pages.dev/orders?tab=open', pathname: '/orders', hostname: 'pzmstock.pages.dev' })
      sdk.isLoggedIn.mockReturnValue(false)
      await lineLiffProvider.share(payload())
      const { redirectUri } = sdk.login.mock.calls[0][0] as { redirectUri: string }
      expect(redirectUri).toBe(`https://pzmstock.pages.dev/orders?tab=open&${RESUME_PARAM}=o1&brand=pizza`)
      vi.unstubAllGlobals()
    })

    test('a home-screen app goes to the LIFF address of the same page, not to LINE Login', async () => {
      const here = { href: 'https://pzmstock.pages.dev/orders', pathname: '/orders', hostname: 'pzmstock.pages.dev' }
      vi.stubGlobal('location', here)
      vi.stubGlobal('navigator', { standalone: true })
      vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
      expect(isStandalone()).toBe(true)
      sdk.isLoggedIn.mockReturnValue(false)
      expect(await lineLiffProvider.share(payload())).toBe('cancelled')
      expect(sdk.login).not.toHaveBeenCalled()
      expect(here.href).toBe(liffUrl('o1'))
      expect(here.href).toBe('https://liff.line.me/1234567890-abcdefgh/orders?send=o1&brand=pizza')
      vi.unstubAllGlobals()
    })

    test('outside a browser there is no address to come back to, and nothing throws', () => {
      expect(resumeUrl('o1')).toBeUndefined()
      expect(isStandalone()).toBe(false)
    })

    // The brand is chosen once per visit and kept in React state, so coming back from LINE
    // used to land on the brand picker with no way to tell which brand the order was in.
    test('the way back names the brand, so the sheet opens instead of the brand picker', async () => {
      setActiveBrand('lelapin')
      vi.stubGlobal('location', { href: 'https://pzmstock.pages.dev/orders', pathname: '/orders', hostname: 'pzmstock.pages.dev', search: '' })
      expect(resumeUrl('o1')).toBe('https://pzmstock.pages.dev/orders?send=o1&brand=lelapin')
      expect(liffUrl('o1')).toBe('https://liff.line.me/1234567890-abcdefgh/orders?send=o1&brand=lelapin')

      vi.stubGlobal('location', { search: '?send=o1&brand=lelapin' })
      expect(brandToResume()).toBe('lelapin')
      // An ordinary visit, and a made-up brand, still start at the picker.
      vi.stubGlobal('location', { search: '?brand=lelapin' })
      expect(brandToResume()).toBeNull()
      vi.stubGlobal('location', { search: '?send=o1&brand=nonsense' })
      expect(brandToResume()).toBeNull()
      vi.unstubAllGlobals()
      setActiveBrand('pizza')
    })
  })

  // 23 Sep 2026: the owner filmed "ส่ง LINE" doing nothing but reload, over and over. An
  // iOS webview inside another app reports `navigator.standalone === true` just as a
  // home-screen app does, so inside LINE's own in-app browser the code took the "hand this
  // over to LINE" branch — which re-opened the very page it was already on. Nothing could
  // ever make progress, and there was no limit on how often it tried.
  describe('the hand-over to LINE cannot loop', () => {
    const inApp = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Line/14.9.0'
    const homeScreen = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
    const at = (userAgent: string) => {
      const here = { href: 'https://pzmstock.pages.dev/orders', pathname: '/orders', hostname: 'pzmstock.pages.dev' }
      const store = new Map<string, string>()
      vi.stubGlobal('location', here)
      vi.stubGlobal('navigator', { standalone: true, userAgent })
      vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
      vi.stubGlobal('sessionStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      })
      return here
    }

    test("LINE's own browser is not a home-screen app: sign in there, do not hand over again", async () => {
      const here = at(inApp)
      expect(isStandalone()).toBe(false)
      sdk.isLoggedIn.mockReturnValue(false)
      expect(await lineLiffProvider.share(payload())).toBe('cancelled')
      expect(here.href).toBe('https://pzmstock.pages.dev/orders')
      expect(sdk.login).toHaveBeenCalledTimes(1)
      vi.unstubAllGlobals()
    })

    test('a home-screen app hands over once; a second tap goes through LINE Login instead', async () => {
      const here = at(homeScreen)
      sdk.isLoggedIn.mockReturnValue(false)

      await lineLiffProvider.share(payload())
      expect(here.href).toBe(liffUrl('o1'))
      expect(sdk.login).not.toHaveBeenCalled()

      here.href = 'https://pzmstock.pages.dev/orders'
      await lineLiffProvider.share(payload())
      expect(here.href).toBe('https://pzmstock.pages.dev/orders')
      expect(sdk.login).toHaveBeenCalledTimes(1)
      vi.unstubAllGlobals()
    })

    test('inside a LIFF view the picker is used, never a hand-over', async () => {
      const here = at(inApp)
      sdk.isInClient.mockReturnValue(true)
      sdk.isLoggedIn.mockReturnValue(false)
      await lineLiffProvider.share(payload())
      expect(here.href).toBe('https://pzmstock.pages.dev/orders')
      vi.unstubAllGlobals()
    })
  })

  test('is available before login (login comes first), and only with the picker after', async () => {
    expect(await lineLiffProvider.isAvailable()).toBe(true)
    sdk.isApiAvailable.mockReturnValue(false)
    expect(await lineLiffProvider.isAvailable()).toBe(false)
    // Not signed in yet: the SDK cannot know about the picker, so this is not a "no".
    sdk.isLoggedIn.mockReturnValue(false)
    expect(await lineLiffProvider.isAvailable()).toBe(true)
    // Inside the LINE app the picker is LINE's own; the SDK answer is trusted as is.
    sdk.isLoggedIn.mockReturnValue(true)
    sdk.isInClient.mockReturnValue(true)
    expect(await lineLiffProvider.isAvailable()).toBe(true)
    sdk.isInClient.mockReturnValue(false)
  })

  test('needs the picture hosted first', async () => {
    await expect(lineLiffProvider.share({ ...payload(), hosted: undefined })).rejects.toThrow()
    expect(lineLiffProvider.needsHosting).toBe(true)
  })
})
