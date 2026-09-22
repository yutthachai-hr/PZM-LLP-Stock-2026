import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/I18nContext'
import { Button, Input, Modal } from './ui'
import { Icon } from './Icon'

/**
 * Read a barcode with the device's camera (spec §3).
 *
 * Two readers, in order: the browser's own `BarcodeDetector` where it exists (Chrome and
 * Android, no download), and `@zxing/browser` — imported only when the first is missing, so
 * a phone that has the native one never pays for the library.
 *
 * Whatever happens — no camera, permission refused, a reader that cannot start — the sheet
 * still offers a box to type the number into, because the person is standing in front of
 * the shelf either way. The camera is stopped on every exit path; a stream left running
 * keeps the lamp on and drains the tablet.
 */
type Reader = { stop: () => void }

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']

export function BarcodeScanner({ open, onClose, onRead, title }: { open: boolean; onClose: () => void; onRead: (code: string) => void; title?: string }) {
  const t = useT()
  const video = useRef<HTMLVideoElement>(null)
  const reader = useRef<Reader | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')
  const done = useRef(false)

  useEffect(() => {
    if (!open) return
    done.current = false
    setError('')
    setTyped('')
    let cancelled = false

    function finish(code: string) {
      const value = code.trim()
      if (!value || done.current) return
      done.current = true
      onRead(value)
    }

    async function start() {
      const el = video.current
      if (!el) return
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) return
        el.srcObject = stream.current
        await el.play()
      } catch {
        setError(t('เปิดกล้องไม่ได้ — พิมพ์เลขบาร์โค้ดแทนได้'))
        return
      }
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
      if (Detector) {
        const detector = new Detector({ formats: FORMATS })
        let timer = 0
        const tick = async () => {
          if (cancelled || done.current) return
          try {
            const hits = await detector.detect(el)
            if (hits[0]?.rawValue) finish(hits[0].rawValue)
          } catch {
            /* a frame that cannot be read is not an error worth showing */
          }
          timer = window.setTimeout(() => void tick(), 250)
        }
        void tick()
        reader.current = { stop: () => window.clearTimeout(timer) }
        return
      }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (cancelled) return
        const zx = new BrowserMultiFormatReader()
        const controls = await zx.decodeFromVideoElement(el, (result) => {
          if (result) finish(result.getText())
        })
        reader.current = { stop: () => controls.stop() }
      } catch {
        setError(t('อ่านบาร์โค้ดจากกล้องไม่ได้บนเครื่องนี้ — พิมพ์เลขแทนได้'))
      }
    }

    void start()
    return () => {
      cancelled = true
      reader.current?.stop()
      reader.current = null
      for (const track of stream.current?.getTracks() ?? []) track.stop()
      stream.current = null
    }
  }, [open, onRead, t])

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
          <Button onClick={() => onRead(typed.trim())} disabled={!typed.trim()} className="flex-1">
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
            if (e.key === 'Enter' && typed.trim()) onRead(typed.trim())
          }}
          inputMode="numeric"
          placeholder={t('หรือพิมพ์เลขบาร์โค้ด')}
          aria-label={t('เลขบาร์โค้ด')}
        />
      </div>
    </Modal>
  )
}
