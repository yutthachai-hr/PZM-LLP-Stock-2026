import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { Icon } from '../../components/Icon'
import { PoSheet, SheetLangToggle } from '../../components/PoSheet'
import { Badge, Button, Modal } from '../../components/ui'
import { useI18n, useT, type Lang } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { paginateLines, renderElementToJpeg, sheetFileName } from '../../lib/poImage'
import { imageHostAvailable, uploadPoImage } from '../../services/poImages'
import { setShareStatus } from '../../services/purchaseOrders'
import { pickShareProvider, statusFor, type PurchaseShareProvider } from '../../share'
import type { PurchaseOrder } from '../../types'

/**
 * "ส่ง LINE ทั้งหมด": one supplier at a time, in order, until the list is done.
 *
 * A personal LINE cannot push a message to a chosen supplier quietly, and the owner does
 * not want it to — the person picks the chat, the same as today. So this is a guided walk:
 * 1 / 8 THAINAMTHIP, the sheet, [ส่ง LINE] [ข้าม]; the picker opens; back here, 2 / 8. Each
 * step is written to the order the moment it is known, so closing the tab halfway loses
 * nothing: reopening the wizard starts at the first order not yet sent or skipped.
 *
 * What is written is what is known (see PurchaseShareProvider). With LIFF, LINE reports
 * success and the order says `sent`. With the share sheet, the app only knows it was
 * opened, and the person says whether it went.
 */
export function SendWizard({
  orders,
  onStatus,
  onClose,
}: {
  /** The batch's placed orders, in the order they should be sent. */
  orders: PurchaseOrder[]
  /** Called after every status written, with the order as it now stands. */
  onStatus: (order: PurchaseOrder) => Promise<void>
  onClose: () => void
}) {
  const t = useT()
  const { lang: screenLang } = useI18n()
  const toast = useToast()
  const { user } = useAuth()
  const { brand } = useBrand()
  const { locationById } = useData()
  const company = brand ? brandDef(brand).name : ''

  const pending = useMemo(() => orders.filter((o) => o.shareStatus !== 'sent' && o.shareStatus !== 'skipped'), [orders])
  const [provider, setProvider] = useState<PurchaseShareProvider | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(pending[0]?.id ?? null)
  const [pageIdx, setPageIdx] = useState(0)
  const [sheetLang, setSheetLang] = useState<Lang>(screenLang)
  const [busy, setBusy] = useState<'' | 'render' | 'share'>('')
  const [askOutcome, setAskOutcome] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void pickShareProvider().then(setProvider)
  }, [])

  // Follow the list as orders get their status: the current one is the first still pending.
  // Keyed on WHICH orders are pending, not on the array: the parent re-renders while a
  // share is in flight (the "opened" status is written first), and resetting on identity
  // wiped the "was it sent?" question the moment it appeared.
  const pendingKey = pending.map((o) => o.id).join(',')
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => {
    setCurrentId(pendingRef.current[0]?.id ?? null)
    setPageIdx(0)
    setAskOutcome(false)
  }, [pendingKey])

  // Always the order as it now stands: its status fields move while it is being sent.
  const current = currentId ? (orders.find((o) => o.id === currentId) ?? null) : null
  const pages = useMemo(() => (current ? paginateLines(current.lines) : []), [current])
  const doneCount = orders.length - pending.length
  const position = doneCount + 1

  async function record(order: PurchaseOrder, status: 'shareOpened' | 'sent' | 'skipped' | 'failed', version?: number) {
    if (!user) return
    await setShareStatus(order.id, status, { id: user.id, name: user.name }, version)
    await onStatus({ ...order, shareStatus: status })
  }

  async function send() {
    if (!current || !sheet.current || !provider || !user) return
    const page = { n: pageIdx + 1, of: pages.length }
    const isLast = pageIdx === pages.length - 1
    try {
      setBusy('render')
      const original = await renderElementToJpeg(sheet.current, { scale: 2 })
      const file = new File([original], sheetFileName(current.docNo, page), { type: 'image/jpeg' })
      const version = (current.imageVersion ?? 0) + 1
      let hosted
      if (provider.needsHosting) {
        if (!imageHostAvailable()) throw new Error(t('เครื่องนี้ยังไม่ได้ตั้งค่าที่เก็บรูปสำหรับส่ง LINE'))
        const preview = await renderElementToJpeg(sheet.current, { scale: 1, quality: 0.8 })
        hosted = await uploadPoImage({ poId: current.id, original, preview, version })
      }
      // Opened is written before the picker, so a tab closed mid-way still shows the
      // truth: this one was started and not finished.
      if (current.shareStatus !== 'shareOpened') await record(current, 'shareOpened')
      setBusy('share')
      const outcome = await provider.share({
        order: current,
        page,
        file,
        hosted,
        caption: t('ใบสั่งซื้อ {docNo} — {company}', { docNo: current.docNo, company }) + (page.of > 1 ? ` (${page.n}/${page.of})` : ''),
      })
      if (outcome === 'cancelled') return
      if (!isLast) {
        // More pages of the same order: stay on it, move to the next page.
        setPageIdx(pageIdx + 1)
        return
      }
      const status = statusFor(outcome)
      if (status === 'sent') {
        await record(current, 'sent', version)
      } else {
        // The share sheet told us nothing. Ask the one person who knows.
        setAskOutcome(true)
      }
    } catch (e) {
      toast.error(errText(e, t))
      await record(current, 'failed').catch(() => {})
    } finally {
      setBusy('')
    }
  }

  async function skip() {
    if (!current) return
    await record(current, 'skipped')
  }

  if (!current) {
    return (
      <Modal open onClose={onClose} title={t('ส่งใบสั่งซื้อ')}>
        <div className="space-y-3">
          <p className="text-sm text-ink">{t('ส่งครบทุกรายแล้ว')}</p>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex items-center gap-2 px-3 py-2">
                <Icon name={o.shareStatus === 'sent' ? 'check' : 'x'} size={16} className={o.shareStatus === 'sent' ? 'text-in' : 'text-ink-faint'} />
                <span className="flex-1 text-ink">{o.supplierName}</span>
                <span className="doc-no text-xs text-ink-faint">{o.docNo}</span>
                <Badge color={o.shareStatus === 'sent' ? 'green' : 'slate'}>
                  {o.shareStatus === 'sent' ? t('ส่งเข้า LINE แล้ว') : t('ข้าม')}
                </Badge>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('ปิด')}</Button>
          </div>
        </div>
      </Modal>
    )
  }

  const page = { n: pageIdx + 1, of: pages.length }
  return (
    <Modal open onClose={onClose} title={t('ส่งใบสั่งซื้อ {i} / {n}', { i: position, n: orders.length })}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold text-ink">{current.supplierName}</span>
          <span className="doc-no text-xs text-ink-faint">{current.docNo}</span>
          {pages.length > 1 && <Badge color="amber">{t('รูปที่ {n} จาก {of}', { n: page.n, of: page.of })}</Badge>}
          {current.shareStatus === 'failed' && <Badge color="red">{t('ครั้งก่อนส่งไม่สำเร็จ')}</Badge>}
        </div>
        <SheetLangToggle value={sheetLang} onChange={setSheetLang} />
        <PoSheet
          order={current}
          lines={pages[pageIdx] ?? current.lines}
          locationName={locationById(current.locationId)?.name ?? ''}
          company={company}
          page={page}
          ref={sheet}
          id="send-sheet"
          lang={sheetLang}
        />
        {askOutcome ? (
          <div className="rounded-lg border border-line bg-sunken p-3">
            <p className="mb-2 text-sm text-ink">{t('ส่งใน LINE เรียบร้อยหรือไม่?')}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void record(current, 'sent', (current.imageVersion ?? 0) + 1)}>
                <Icon name="check" size={16} />
                {t('ส่งแล้ว')}
              </Button>
              <Button variant="secondary" onClick={() => setAskOutcome(false)}>
                {t('ยังไม่ได้ส่ง — ลองอีกครั้ง')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={!!busy}>
              {t('พักไว้ก่อน')}
            </Button>
            <Button variant="secondary" onClick={() => void skip()} disabled={!!busy}>
              {t('ข้าม')}
            </Button>
            <Button onClick={() => void send()} disabled={!!busy || !provider}>
              <Icon name="share" size={16} />
              {busy === 'render'
                ? t('กำลังสร้างรูป...')
                : busy === 'share'
                  ? t('กำลังเปิด LINE...')
                  : provider
                    ? t(provider.label)
                    : t('กำลังเตรียม…')}
            </Button>
          </div>
        )}
        <p className="text-xs text-ink-faint">
          {provider?.id === 'line-liff'
            ? t('กด "ส่ง LINE" → เลือกแชทของผู้ขาย → ส่ง แล้วกลับมาที่นี่ ระบบจะไปรายถัดไปเอง')
            : t('เครื่องนี้ไม่มี LINE (LIFF) — จะเปิดเมนูแชร์ของเครื่องแทน เลือก LINE แล้วเลือกแชทของผู้ขาย')}
        </p>
      </div>
    </Modal>
  )
}
