import { useCallback, useEffect, useRef } from 'react'
import { brandEpoch, getBrand } from '../brand/brand'
import { decideScan } from './barcodeSelection'
import { normalizeScanToken } from './barcode'
import { backend as defaultBackend } from '../backend'
import type { Backend } from '../backend/types'
import { COL, type Product } from '../types'
import type { TFn } from '../i18n/I18nContext'

/** The confirm dialog, structurally — the real `useConfirm()` result satisfies this. */
type ConfirmLike = (opts: { title?: string; message: string; confirmText?: string }) => Promise<boolean>
/** The toast API, structurally — the real `useToast()` result satisfies this. */
interface ToastLike {
  error: (msg: string) => void
  info?: (msg: string) => void
}

export interface ScanGateOptions {
  /** The synced product catalog from DataContext / screen state. */
  products: readonly Product[]
  /** Whether the products collection has been server-synced in this session for the brand. */
  productsServerSynced?: boolean
  /** Listener error if products subscription failed. */
  productsListenerError?: unknown | null
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
  /** Optional backend override (for testing or custom scoping). */
  backend?: Backend
}

type VerifyResult =
  | { ok: true; product: Product }
  | {
      ok: false
      reason: 'read_error' | 'not_found' | 'inactive' | 'rebound' | 'duplicate'
      duplicateCount?: number
      inactiveName?: string
    }

/**
 * The single scan entry point the screens share (R4/R3).
 *
 * Resolves the token against the full synced product array once acknowledged by the server,
 * preventing cold-start false "not found" toasts with zero extra collection reads.
 *
 * For legacy exact matches, validates authoritatively against the server (getOne + getBy)
 * before prompting AND again at answer time before onAdd, guarding against remote duplicates,
 * hard-deletions, deactivations, and rebinds without reading the full catalog.
 */
export function useScanGate(opts: ScanGateOptions): (code: string) => Promise<void> {
  const { confirm, toast, t } = opts
  const productsRef = useRef(opts.products)
  productsRef.current = opts.products
  const serverSyncedRef = useRef(opts.productsServerSynced)
  serverSyncedRef.current = opts.productsServerSynced
  const listenerErrorRef = useRef(opts.productsListenerError)
  listenerErrorRef.current = opts.productsListenerError
  const backendRef = useRef(opts.backend)
  backendRef.current = opts.backend

  const onAddRef = useRef(opts.onAdd)
  onAddRef.current = opts.onAdd
  const isEligibleRef = useRef(opts.isEligible)
  isEligibleRef.current = opts.isEligible
  const onIneligibleRef = useRef(opts.onIneligible)
  onIneligibleRef.current = opts.onIneligible
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
      const theCode = normalizeScanToken(code)
      if (!theCode) return

      // Refuse safely while confirmation dialog is already pending (I1)
      if (isConfirmingRef.current) {
        const msg = t('กำลังรอยืนยันรายการก่อนหน้า — กรุณาสแกนใหม่หลังยืนยัน')
        if (toast.info) toast.info(msg)
        else toast.error(msg)
        return
      }

      // Check listener error or cold catalog loading readiness (C1)
      if (listenerErrorRef.current) {
        toast.error(t('เชื่อมต่อฐานข้อมูลไม่ได้ — กรุณาลองใหม่อีกครั้ง'))
        return
      }
      if (!serverSyncedRef.current) {
        toast.error(t('กำลังโหลดข้อมูลสินค้า — กรุณาสแกนอีกครั้ง'))
        return
      }

      const epochAtScan = brandEpoch()
      const brandAtScan = getBrand()
      const scanScopeId = ++scanScopeCounter.current
      const be = (backendRef.current ?? defaultBackend).forBrand(brandAtScan)

      const decision = decideScan(productsRef.current, theCode)

      if (decision.kind === 'legacy') {
        if (isEligibleRef.current && !isEligibleRef.current(decision.product)) {
          onIneligibleRef.current?.(decision.product)
          return
        }

        const verifyServer = async (productId: string, needle: string): Promise<VerifyResult> => {
          try {
            const [targetDoc, matches] = await Promise.all([
              be.getOne<Product>(COL.products, productId, { server: true }),
              be.getBy<Product>(COL.products, 'barcode', needle, { server: true }),
            ])

            if (!targetDoc) {
              return { ok: false, reason: 'not_found' }
            }
            if (targetDoc.active === false) {
              return { ok: false, reason: 'inactive', inactiveName: targetDoc.name }
            }
            if ((targetDoc.barcode ?? '').trim() !== needle) {
              return { ok: false, reason: 'rebound' }
            }
            const otherMatches = (matches ?? []).filter((p) => p.id !== productId)
            if (otherMatches.length > 0) {
              return { ok: false, reason: 'duplicate', duplicateCount: otherMatches.length + 1 }
            }
            return { ok: true, product: targetDoc }
          } catch {
            return { ok: false, reason: 'read_error' }
          }
        }

        const notifyFailure = (res: VerifyResult) => {
          if (res.ok) return
          if (res.reason === 'read_error') {
            toast.error(t('เชื่อมต่อฐานข้อมูลไม่ได้ — กรุณาลองใหม่อีกครั้ง'))
          } else if (res.reason === 'not_found' || res.reason === 'rebound') {
            toast.error(t('ไม่พบบาร์โค้ด {code} ในระบบ', { code: theCode }))
          } else if (res.reason === 'inactive') {
            toast.error(t('สินค้าบาร์โค้ดนี้ถูกปิดใช้งานแล้ว: "{name}"', { name: res.inactiveName ?? '' }))
          } else if (res.reason === 'duplicate') {
            toast.error(
              t('บาร์โค้ด {code} ซ้ำกับสินค้า {n} รายการ — โปรดเลือกสินค้าด้วยตนเอง', {
                code: theCode,
                n: res.duplicateCount ?? 0,
              }),
            )
          }
        }

        // Authoritative verification before prompt
        const verifiedBeforePrompt = await verifyServer(decision.product.id, theCode)

        if (!mounted.current || brandEpoch() !== epochAtScan || getBrand() !== brandAtScan) return
        if (scanScopeId !== scanScopeCounter.current) return

        if (!verifiedBeforePrompt.ok) {
          notifyFailure(verifiedBeforePrompt)
          return
        }

        const verifiedProduct = verifiedBeforePrompt.product

        const message = legacyMessage
          ? legacyMessage(verifiedProduct, decision.code)
          : t('พบสินค้า "{name}" จากบาร์โค้ด {code} — ยืนยันเพิ่มรายการ?', {
              name: verifiedProduct.name,
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

          // Authoritative verification re-checked at answer time
          const verifiedAtAnswer = await verifyServer(decision.product.id, theCode)

          if (!mounted.current || brandEpoch() !== epochAtScan || getBrand() !== brandAtScan) return
          if (scanScopeId !== scanScopeCounter.current) return

          if (!verifiedAtAnswer.ok) {
            notifyFailure(verifiedAtAnswer)
            return
          }

          const freshProduct = verifiedAtAnswer.product
          if (isEligibleRef.current && !isEligibleRef.current(freshProduct)) {
            onIneligibleRef.current?.(freshProduct)
            return
          }

          onAddRef.current(freshProduct)
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
