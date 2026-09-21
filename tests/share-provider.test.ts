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
