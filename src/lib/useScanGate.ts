import { useCallback, useEffect, useRef } from 'react'
import { brandEpoch, getBrand, type BrandId } from '../brand/brand'
import { decideScan, revalidateScan } from './barcodeSelection'
import { fetchScanCatalog } from './scanCatalog'
import type { Product } from '../types'
import type { TFn } from '../i18n/I18nContext'

/** The confirm dialog, structurally — the real `useConfirm()` result satisfies this. */
type ConfirmLike = (opts: { title?: string; message: string; confirmText?: string }) => Promise<boolean>
/** The toast API, structurally — the real `useToast()` result satisfies this. */
interface ToastLike {
  error: (msg: string) => void
  info?: (msg: string) => void
}

export interface ScanGateOptions {
  /** Initial or fallback catalog from render scope (superseded by authoritative server read). */
  products?: readonly Product[]
  /** Add the resolved product (append its line / mark the transfer line received). */
  onAdd: (product: Product) => void
  confirm: ConfirmLike
  toast: ToastLike
  t: TFn
  /** The legacy-confirmation button's word (defaults to the dictionary's "add line"). */
  confirmText?: string
  /** The legacy-confirmation body, where a screen words it differently. */
  legacyMessage?: (product: Product, code: string) => string
  /** Optional caller eligibility check, verified before prompting and rechecked at answer time. */
  isEligible?: (product: Product) => boolean
  /** Optional callback invoked when a product is resolved but fails caller eligibility. */
  onIneligible?: (product: Product) => void
  /** Authoritative catalog loader override (for testing or custom scoping). */
  loadCatalog?: (brand: BrandId) => Promise<readonly Product[]>
}

/**
 * The single scan entry point the screens share (R4/R2).
 *
 * Resolves the token against an authoritative server-acknowledged product catalog,
 * preventing cold-start false "not found" toasts. Deduplicates in-flight reads and
 * provides short-lived caching without session-long stale maps or brand leaks.
 *
 * Confirms legacy barcodes and revalidates against the server catalog at answer time.
 */
export function useScanGate(opts: ScanGateOptions): (code: string) => Promise<void> {
  const { confirm, toast, t } = opts
  const onAddRef = useRef(opts.onAdd)
  onAddRef.current = opts.onAdd
  const isEligibleRef = useRef(opts.isEligible)
  isEligibleRef.current = opts.isEligible
  const onIneligibleRef = useRef(opts.onIneligible)
  onIneligibleRef.current = opts.onIneligible
  const loadCatalogRef = useRef(opts.loadCatalog)
  loadCatalogRef.current = opts.loadCatalog
  const legacyMessage = opts.legacyMessage
  const confirmText = opts.confirmText

  const mounted = useRef(true)
  const isConfirmingRef = useRef(false)
  const scanScopeCounter = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  return useCallback(
    async (code: string): Promise<void> => {
      const theCode = code.trim()
      if (!theCode) return

      // Refuse safely while confirmation dialog is already pending
      if (isConfirmingRef.current) return

      const epochAtScan = brandEpoch()
      const brandAtScan = getBrand()
      const scanScopeId = ++scanScopeCounter.current

      let catalog: readonly Product[]
      try {
        catalog = await fetchScanCatalog(brandAtScan, { loader: loadCatalogRef.current })
      } catch {
        if (!mounted.current || brandEpoch() !== epochAtScan || getBrand() !== brandAtScan) return
        if (scanScopeId !== scanScopeCounter.current) return
        toast.error(t('เชื่อมต่อฐานข้อมูลไม่ได้ — กรุณาลองใหม่อีกครั้ง'))
        return
      }

      // Drop stale async resolution if scope changed (newer scan or brand change or unmounted)
      if (!mounted.current || brandEpoch() !== epochAtScan || getBrand() !== brandAtScan) return
      if (scanScopeId !== scanScopeCounter.current) return

      const decision = decideScan(catalog, theCode)

      if (decision.kind === 'legacy') {
        if (isEligibleRef.current && !isEligibleRef.current(decision.product)) {
          onIneligibleRef.current?.(decision.product)
          return
        }

        const expectedProductId = decision.product.id
        const message = legacyMessage
          ? legacyMessage(decision.product, decision.code)
          : t('พบสินค้า "{name}" จากบาร์โค้ด {code} — ยืนยันเพิ่มรายการ?', {
              name: decision.product.name,
              code: decision.code,
            })

        isConfirmingRef.current = true
        try {
          const ok = await confirm({
            title: t('ยืนยันสินค้าจากบาร์โค้ด'),
            message,
            confirmText: confirmText ?? t('เพิ่มรายการ'),
          })

          if (!ok || !mounted.current || brandEpoch() !== epochAtScan || getBrand() !== brandAtScan) return
          if (scanScopeId !== scanScopeCounter.current) return

          // Revalidate server catalog at answer time
          let freshCatalog: readonly Product[]
          try {
            freshCatalog = await fetchScanCatalog(brandAtScan, { force: true, loader: loadCatalogRef.current })
          } catch {
            toast.error(t('เชื่อมต่อฐานข้อมูลไม่ได้ — กรุณาลองใหม่อีกครั้ง'))
            return
          }

          if (!mounted.current || brandEpoch() !== epochAtScan || getBrand() !== brandAtScan) return
          if (scanScopeId !== scanScopeCounter.current) return

          const fresh = revalidateScan(freshCatalog, theCode, expectedProductId)
          if (!fresh) return
          if (isEligibleRef.current && !isEligibleRef.current(fresh)) {
            onIneligibleRef.current?.(fresh)
            return
          }
          onAddRef.current(fresh)
        } finally {
          isConfirmingRef.current = false
        }
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
