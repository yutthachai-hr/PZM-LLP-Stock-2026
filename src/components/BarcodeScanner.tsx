import { useEffect, useRef, useState } from 'react'
import { brandEpoch, onBrandChange } from '../brand/brand'
import { useT } from '../i18n/I18nContext'
import { Button, Input, Modal } from './ui'
import { Icon } from './Icon'
import { CameraScanController, type DetectorCtor } from '../lib/cameraScan'
import { isImeComposing } from '../lib/barcodeSelection'

/**
 * Read a barcode with the device's camera (spec §3).
 *
 * Two readers, in order: the browser's own `BarcodeDetector` where it exists (Chrome and
 * Android, no download), and `@zxing/browser` — imported only when the first is missing, so
 * a phone that has the native one never pays for the library.
 *
 * The reading itself is the session-generation controller in lib/cameraScan.ts: every open is
 * a new generation, the stream is only shared once it belongs to the current one, and a close
 * or reopen stops the tracks, the reader and the polling timer. Whatever happens — no camera,
 * permission refused, a reader that cannot start — the sheet still offers a box to type the
 * number into, because the person is standing in front of the shelf either way.
 */
export function BarcodeScanner({ open, onClose, onRead, title }: { open: boolean; onClose: () => void; onRead: (code: string) => void; title?: string }) {
  const t = useT()
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')
  const session = useRef<CameraScanController | null>(null)
  const done = useRef(false)
  const epoch = useRef(0)

  const onReadRef = useRef(onRead)
  onReadRef.current = onRead
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  function finish(code: string) {
    const active = session.current
    if (!active || !active.isActive() || done.current) return
    if (brandEpoch() !== epoch.current) return
    const value = code.trim()
    if (!value) return
    done.current = true
    // Tear the camera down now, not on the next render: the read is complete.
    active.close()
    onCloseRef.current()
    onReadRef.current(value)
  }

  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    if (!open) return
    epoch.current = brandEpoch()
    done.current = false
    setError('')
    setTyped('')

    const ctrl = new CameraScanController({
      getVideo: () => video.current,
      getUserMedia: () => navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }),
      getDetector: () => (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector,
      startZxing: async (video, emit) => {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const zx = new BrowserMultiFormatReader()
        return zx.decodeFromVideoElement(video as unknown as HTMLVideoElement, (result) => {
          if (result) emit(result.getText())
        })
      },
      onCode: (code) => finishRef.current(code),
      onError: (kind) =>
        setError(
          kind === 'camera'
            ? t('เปิดกล้องไม่ได้ — พิมพ์เลขบาร์โค้ดแทนได้')
            : t('อ่านบาร์โค้ดจากกล้องไม่ได้บนเครื่องนี้ — พิมพ์เลขแทนได้'),
        ),
      onStream: () => {},
    })
    session.current = ctrl
    ctrl.open()

    const unsubBrand = onBrandChange(() => {
      ctrl.close()
      onCloseRef.current()
    })

    return () => {
      unsubBrand()
      ctrl.close()
      if (session.current === ctrl) session.current = null
    }
  }, [open, t])

  return (
    <Modal
      open={open}
      onClose={onClose}
      compact
      title={title ?? t('สแกนบาร์โค้ด')}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            {t('ยกเลิก')}
          </Button>
          <Button onClick={() => finish(typed)} disabled={!typed.trim()} className="flex-1">
            {t('ใช้เลขนี้')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-xl bg-ink/90">
          {/* muted + playsInline: iOS refuses to play an inline video without both. */}
          <video ref={video} muted playsInline className="h-56 w-full object-cover" />
          <span aria-hidden className="pointer-events-none absolute inset-6 rounded-lg border-2 border-white/80" />
        </div>
        {error ? (
          <p className="flex items-start gap-2 text-sm text-warn">
            <Icon name="warning" size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : (
          <p className="text-center text-sm text-ink-soft">{t('เล็งกล้องไปที่บาร์โค้ด ระบบจะอ่านให้อัตโนมัติ')}</p>
        )}
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return
            if (e.key === 'Enter' && typed.trim()) {
              e.preventDefault()
              finish(typed)
            }
          }}
          inputMode="text"
          placeholder={t('หรือพิมพ์เลขบาร์โค้ด')}
          aria-label={t('เลขบาร์โค้ด')}
        />
      </div>
    </Modal>
  )
}
