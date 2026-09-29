import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { useData } from '../data/DataContext'
import { useT } from '../i18n/I18nContext'
import { fmtQty } from '../lib/format'
import { TRANSIT_LOCATION_ID } from '../types'

/**
 * A product's photo, large (owner, 26 Sep 2026): tap a thumbnail and it fills the screen;
 * tap anywhere — or press Esc — and it is gone. No close button to aim for. Under the photo,
 * what it is and how much of it there is, so nobody has to open the product to check.
 *
 * It costs no read: the thumbnail already holds the whole 800px photo.
 */
export function ImageViewer({ src, productId, onClose }: { src: string; productId: string; onClose: () => void }) {
  const t = useT()
  const { productById, levels } = useData()
  const product = productById(productId)
  const [shown, setShown] = useState(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    // Capture on window runs before a dialog underneath (the quantity sheet) sees Esc, so
    // Esc closes the photo and leaves the sheet open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
    }
  }, [])

  // On hand across every site, one figure per unit it is kept in; goods on the road are not
  // on hand anywhere yet.
  const onHand = useMemo(() => {
    if (!product) return ''
    const byUnit = new Map<string, number>()
    for (const l of levels) {
      if (l.productId !== productId || l.locationId === TRANSIT_LOCATION_ID || !l.qty) continue
      const unit = l.unit ?? product.unitType
      byUnit.set(unit, (byUnit.get(unit) ?? 0) + l.qty)
    }
    return [...byUnit].map(([unit, qty]) => `${fmtQty(qty)} ${unit}`).join(' + ')
  }, [levels, product, productId])

  // A portal is still inside its parent in React's tree: without this, the tap that closes
  // the photo would also reach the table row or link the thumbnail sits in.
  const swallow = (e: SyntheticEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={product?.name ?? t('รูปสินค้า')}
      onClick={(e) => {
        swallow(e)
        onClose()
      }}
      onMouseDown={swallow}
      className={`fixed inset-0 z-[100] flex cursor-zoom-out flex-col items-center justify-center gap-4 bg-black/80 p-4 backdrop-blur-sm transition-opacity duration-200 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <img
        src={src}
        alt={product?.name ?? ''}
        className={`max-h-[72vh] max-w-full rounded-2xl bg-white object-contain shadow-2xl transition-transform duration-200 ${
          shown ? 'scale-100' : 'scale-95'
        }`}
      />
      {product && (
        <div className="max-w-md text-center text-white">
          <div className="text-base font-semibold leading-snug">{product.name}</div>
          <div className="mt-0.5 text-sm text-white/70">
            {[product.sku, product.category, product.unit].filter(Boolean).join(' · ')}
          </div>
          {onHand && <div className="mt-1.5 text-sm font-medium">{t('คงเหลือรวม {qty}', { qty: onHand })}</div>}
        </div>
      )}
      <div className="text-xs text-white/60">{t('แตะที่ใดก็ได้เพื่อปิด')}</div>
    </div>,
    document.body,
  )
}
