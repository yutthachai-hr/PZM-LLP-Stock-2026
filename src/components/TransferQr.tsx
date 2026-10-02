import { useEffect, useState } from 'react'
import { Button, Modal } from './ui'
import { Icon } from './Icon'
import { useT } from '../i18n/I18nContext'
import { formatThaiDate } from '../lib/format'
import { transferReceiveUrl } from '../lib/transferQr'
import type { Transfer } from '../types'

/**
 * The Master QR of a transfer (Automation Plan Phase 2): shown on the dispatcher's phone
 * or printed and taped to the box. The branch scans it once on ใบรายการส่งสินค้า and lands
 * on the receiving page with every line already there.
 *
 * The QR writer comes with the barcode reader already in the bundle (@zxing/browser) and
 * is loaded only when the code is opened.
 */
export function TransferQr({
  transfer,
  fromName,
  toName,
  onClose,
}: {
  transfer: Transfer
  fromName: string
  toName: string
  onClose: () => void
}) {
  const t = useT()
  const [svg, setSvg] = useState('')
  const url = transferReceiveUrl(window.location.origin, transfer.id)

  useEffect(() => {
    let live = true
    import('@zxing/browser')
      .then(({ BrowserQRCodeSvgWriter }) => {
        const el = new BrowserQRCodeSvgWriter().write(url, 260, 260)
        if (live) setSvg(el.outerHTML)
      })
      .catch(() => live && setSvg(''))
    return () => {
      live = false
    }
  }, [url])

  const lines = transfer.items.filter((i) => !i.removed).length

  function print() {
    const w = window.open('', '_blank', 'width=420,height=560')
    if (!w) return
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${transfer.docNo}</title>` +
        `<style>body{font-family:sans-serif;text-align:center;padding:16px}h1{font-size:28px;margin:8px 0}p{margin:4px 0;font-size:16px}</style>` +
        `</head><body><h1>${transfer.docNo}</h1><p>${fromName} → ${toName}</p><p>${formatThaiDate(transfer.dispatchDate)} · ${lines} ${t('รายการ')}</p>${svg}` +
        `<p style="font-size:12px;color:#555">${t('สแกนเพื่อตรวจรับสินค้า')}</p></body></html>`,
    )
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <Modal open onClose={onClose} title={t('QR ใบโอน {docNo}', { docNo: transfer.docNo })} compact>
      <div className="space-y-3 text-center">
        <div className="text-sm text-ink-soft">
          {fromName} → {toName} · {formatThaiDate(transfer.dispatchDate)} · {t('{n} รายการ', { n: lines })}
        </div>
        <div className="mx-auto flex h-[260px] w-[260px] items-center justify-center rounded-xl bg-white p-1">
          {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="text-sm text-ink-faint">{t('กำลังสร้าง QR...')}</span>}
        </div>
        <p className="text-xs text-ink-soft">{t('ให้สาขาปลายทางสแกนที่หน้า "ใบรายการส่งสินค้า" — เปิดหน้าตรวจรับของใบนี้ทันที')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={print} disabled={!svg}>
            <Icon name="download" size={16} />
            {t('พิมพ์ QR')}
          </Button>
          <Button onClick={onClose}>{t('ปิด')}</Button>
        </div>
      </div>
    </Modal>
  )
}
