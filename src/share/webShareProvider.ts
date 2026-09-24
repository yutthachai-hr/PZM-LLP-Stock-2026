import type { PurchaseShareProvider, SharePayload, ShareOutcome } from './PurchaseShareProvider'

/**
 * The phone's own share sheet, or a download where there is none.
 *
 * This is what the share button did before LIFF existed here, and what it still does on a
 * device with no LIFF id (the localhost demo, mostly). The picture is handed over as a file;
 * from there the person picks LINE and the chat themselves. The app learns only that the
 * sheet was opened — a share sheet does not report what was chosen — so the outcome is
 * `shareOpened`, and the person confirms the rest.
 */
export const webShareProvider: PurchaseShareProvider = {
  id: 'web-share',
  label: 'แชร์รูป', // i18n-key
  needsHosting: false,

  async isAvailable() {
    return true
  },

  async share(payload: SharePayload): Promise<ShareOutcome> {
    const { file } = payload
    if (!file) {
      // Text alone (an announcement in TEXT form): the share sheet takes text too; where
      // there is none, the clipboard is the hand-over and the person pastes it into LINE.
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ text: payload.caption })
          return 'shareOpened'
        } catch (e) {
          if ((e as { name?: string }).name === 'AbortError') return 'cancelled'
          throw e
        }
      }
      await navigator.clipboard.writeText(payload.caption)
      return 'shareOpened'
    }
    if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: payload.caption, text: payload.caption })
        return 'shareOpened'
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return 'cancelled'
        throw e
      }
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return 'shareOpened'
  },
}
