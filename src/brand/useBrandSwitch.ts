import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfirm } from '../components/Confirm'
import { useToast } from '../components/Toast'
import { pendingWriteCount, whenWritesSettle } from '../backend/pendingWrites'
import { useT } from '../i18n/I18nContext'
import { useBrand } from './BrandContext'
import { brandDef, type BrandId } from './brand'
import { flushUnsaved, unsavedWork } from './unsavedWork'

/** The page a draft belongs to, as the menu names it (draft ids are useDraft's screen names). */
const SCREEN_LABEL: [RegExp, string][] = [
  [/^receive/, 'รับสินค้าเข้า'], // i18n-key
  [/^issue-transfer/, 'โอนไปสาขา (เก็บสต๊อก)'], // i18n-key
  [/^issue-consume/, 'เบิกใช้ / ตัดออก (หน้าร้าน)'], // i18n-key
  [/^adjust/, 'ปรับสต๊อก'], // i18n-key
  [/^(monthly-count|count-import)/, 'นับสต๊อกประจำเดือน'], // i18n-key
  [/order/, 'สั่งซื้อ'], // i18n-key
]

/** How long a switch waits for writes already on their way before it gives up. */
const WRITE_WAIT_MS = 15_000

/**
 * Change brand from inside the app (owner, 9 Oct 2026), without the full-screen picker and
 * without leaving the session.
 *
 * In order: a form with something keyed in it is named and confirmed (its draft is kept on this
 * device for the brand it belongs to); writes already sent are waited for, and the switch is
 * refused if they do not finish; drafts are saved at once; the Dashboard opens; then the brand
 * changes. The data layer is rebuilt for the new brand from nothing (App mounts DataProvider
 * keyed by brand, and brand-scoped caches drop their copies via onBrandChange), so no figure
 * from the previous brand can be on screen afterwards.
 */
export function useBrandSwitch(): { switchTo: (target: BrandId) => Promise<boolean>; busy: BrandId | null } {
  const { brand, choose } = useBrand()
  const confirm = useConfirm()
  const toast = useToast()
  const navigate = useNavigate()
  const t = useT()
  const [busy, setBusy] = useState<BrandId | null>(null)
  const busyRef = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const switchTo = useCallback(
    async (target: BrandId): Promise<boolean> => {
      if (!brand || target === brand || busyRef.current) return false
      busyRef.current = true
      try {
        const drafts = unsavedWork()
        if (drafts.length > 0) {
          const ok = await confirm({
            title: t('เปลี่ยนเป็น {name}?', { name: brandDef(target).name }),
            message: t(
              'มีงานที่ยังไม่ได้บันทึก {n} หน้า — ระบบจะเก็บไว้ในเครื่องนี้สำหรับ {from} ก่อนเปลี่ยน และกลับมาเมื่อเปิดแบรนด์นี้อีกครั้ง ถ้าเก็บไม่ได้จะไม่เปลี่ยนแบรนด์ (รูปถ่ายที่แนบไว้จะไม่ถูกเก็บ)',
              { n: drafts.length, from: brandDef(brand).name },
            ),
            confirmText: t('เปลี่ยนแบรนด์'),
          })
          if (!ok) return false
        }
        if (alive.current) setBusy(target)
        if (pendingWriteCount() > 0 && !(await whenWritesSettle(WRITE_WAIT_MS))) {
          toast.error(t('ยังบันทึกข้อมูลไม่เสร็จ — รอให้เสร็จก่อนแล้วค่อยเปลี่ยนแบรนด์'))
          return false
        }
        // Nothing has been unmounted yet: if any draft cannot be kept, stop here and the forms
        // stay on screen exactly as typed (owner, 12 Oct 2026).
        const { failed } = flushUnsaved()
        if (failed.length > 0) {
          toast.error(
            t('เก็บงานที่ยังไม่ได้บันทึกไว้ในเครื่องนี้ไม่ได้ ({screens}) — ยังไม่เปลี่ยนแบรนด์ งานบนหน้าจอยังอยู่ครบ บันทึกหรือล้างงานก่อน แล้วค่อยเปลี่ยน', {
              screens: [...new Set(failed.map((f) => t(SCREEN_LABEL.find(([re]) => re.test(f))?.[1] ?? f)))].join(', '),
            }),
          )
          return false
        }
        navigate('/')
        choose(target)
        return true
      } finally {
        busyRef.current = false
        if (alive.current) setBusy(null)
      }
    },
    [brand, choose, confirm, navigate, t, toast],
  )

  return { switchTo, busy }
}
