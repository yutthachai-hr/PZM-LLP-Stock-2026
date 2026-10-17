import { useCallback, useEffect, useRef } from 'react'
import { brandEpoch } from '../brand/brand'
import { decideScan, revalidateScan } from './barcodeSelection'
import type { Product } from '../types'
import type { TFn } from '../i18n/I18nContext'

/** The confirm dialog, structurally — the real `useConfirm()` result satisfies this. */
type ConfirmLike = (opts: { title?: string; message: string; confirmText?: string }) => Promise<boolean>
/** The toast API, structurally — the real `useToast()` result satisfies this. */
interface ToastLike {
  error: (msg: string) => void
}

export interface ScanGateOptions {
  /** The brand catalog as the screen last rendered it; the hook re-reads the latest. */
  products: readonly Product[]
  /** Add the resolved product (append its line / mark the transfer line received). */
  onAdd: (product: Product) => void
  confirm: ConfirmLike
  toast: ToastLike
  t: TFn
  /** The legacy-confirmation button's word (defaults to the dictionary's "add line"). */
  confirmText?: string
  /** The legacy-confirmation body, where a screen words it differently. */
  legacyMessage?: (product: Product, code: string) => string
}

/**
 * The single scan entry point the screens share (R4).
 *
 * It resolves the token exactly (never a fuzzy/SKU fallback), auto-adds only a verified exact
 * barcode, asks for confirmation on a legacy barcode and shows a terminal error otherwise.
 * The confirmation re-resolves the code against the catalog read at answer time, so a product
 * deactivated, rebound or duplicated while the dialog was open is refused rather than added
 * from the stale array (R3 C2). The brand epoch still fences a brand switch.
 *
 * `onAdd` is called with the freshly resolved product, so a line's unit is derived from the
 * current catalog row, never a stale one.
 */
export function useScanGate(opts: ScanGateOptions): (code: string) => void {
  const { confirm, toast, t } = opts
  const productsRef = useRef(opts.products)
  productsRef.current = opts.products
  const onAddRef = useRef(opts.onAdd)
  onAddRef.current = opts.onAdd
  const legacyMessage = opts.legacyMessage
  const confirmText = opts.confirmText

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  return useCallback(
    (code: string) => {
      const decision = decideScan(productsRef.current, code)

      if (decision.kind === 'verified') {
        onAddRef.current(decision.product)
        return
      }

      if (decision.kind === 'legacy') {
        const epochAtPrompt = brandEpoch()
        const expectedProductId = decision.product.id
        const theCode = decision.code
        const message = legacyMessage
          ? legacyMessage(decision.product, decision.code)
          : t('พบสินค้า "{name}" จากบาร์โค้ด {code} — ยืนยันเพิ่มรายการ?', {
              name: decision.product.name,
              code: decision.code,
            })
        void confirm({
          title: t('ยืนยันสินค้าจากบาร์โค้ด'),
          message,
          confirmText: confirmText ?? t('เพิ่มรายการ'),
        }).then((ok) => {
          if (!ok || !mounted.current || brandEpoch() !== epochAtPrompt) return
          const fresh = revalidateScan(productsRef.current, theCode, expectedProductId)
          if (fresh) onAddRef.current(fresh)
        })
        return
      }

      if (decision.reason === 'duplicate') {
        toast.error(
          t('บาร์โค้ด {code} ซ้ำกับสินค้า {n} รายการ — โปรดเลือกสินค้าด้วยตนเอง', {
            code: decision.code,
            n: decision.duplicateCount ?? 0,
          }),
        )
        return
      }
      if (decision.reason === 'inactive') {
        toast.error(t('สินค้าบาร์โค้ดนี้ถูกปิดใช้งานแล้ว: "{name}"', { name: decision.inactiveName ?? '' }))
        return
      }
      if (decision.reason === 'not_found') {
        toast.error(t('ไม่พบบาร์โค้ด {code} ในระบบ', { code: decision.code }))
      }
      // 'empty' — nothing to say.
    },
    [confirm, toast, t, legacyMessage, confirmText],
  )
}
