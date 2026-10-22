import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { brandDef, getBrand } from '../../brand/brand'
import { orderCache } from '../../data/orderCache'
import { LineBadge } from '../orders/LineBadge'
import { createOutcomeTracker, mergeWizardOrders } from './outcomeOrder'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { Icon } from '../../components/Icon'
import { useSuppliers } from '../../services/suppliers'
import { PoSheet, SheetLangToggle } from '../../components/PoSheet'
import { Badge, Button, Modal } from '../../components/ui'
import { translatorFor, useI18n, useT, type Lang, type TFn } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { paginateLines, renderElementToJpeg, sheetFileName } from '../../lib/poImage'
import { imageHostAvailable, uploadPoImage, type HostedImage } from '../../services/poImages'
import { setShareStatus, type SharePatch } from '../../services/purchaseOrders'
import { deliver } from '../../services/notifications'
import { poSentDraft } from '../../lib/inventoryRules/notifications'
import { supplierLink } from '../../services/supplierConfirmation'
import { requestedOf, supplierDateLabel } from '../../lib/supplierConfirmation'
import { pickShareProvider, type PurchaseShareProvider } from '../../share'
import { liffNeedsLogin } from '../../share/lineLiffProvider'
import { isStandalone } from '../../share/liffResume'
import type { PurchaseOrder } from '../../types'
import { clearPageProgress, orderFingerprint, pageToResume, savePageProgress, type ProgressScope } from './sendProgress'
import { settleShare } from './shareSettle'

/**
 * Everything a share needs, made before the tap (owner P0, 22 Oct 2026). The share sheet and
 * LINE's picker (a window, outside LINE) need the tap that asked for them to still be "active";
 * rendering a sheet took 3.6 s at 4x CPU and 43 s at 16x in R36 measurements, all inside the
 * tap. Now the tap only shares; `key` ties the payload to what it shows, so an order revised
 * while the wizard is open is prepared again rather than sent stale.
 */
interface Prepared {
  key: string
  file: File
  hosted?: HostedImage
  caption: string
  card?: { altText: string; contents: Record<string, unknown> }
  version: number
}

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
  resend = false,
}: {
  /** The batch's placed orders, in the order they should be sent. */
  orders: PurchaseOrder[]
  /** Called after every status written, with the order as it now stands. */
  onStatus: (order: PurchaseOrder) => Promise<void>
  onClose: () => void
  /** Send again even if already marked sent — a corrected order, or one sent from the list. */
  resend?: boolean
}) {
  const t = useT()
  const { lang: screenLang } = useI18n()
  const toast = useToast()
  const { user } = useAuth()
  const { brand } = useBrand()
  const { locationById } = useData()
  const company = brand ? brandDef(brand).name : ''
  // Which LINE group each supplier's orders go to (owner, 2 Oct 2026). The list is read once
  // per session and held, so this costs nothing per send.
  const suppliers = useSuppliers()

  // ponytail: keep local map of patched orders in wizard state so completion summary and rows reflect outcome immediately
  // Only the status fields this wizard wrote: a full copy here would hide an amendment that
  // arrives afterwards (R38 review: the sheet showed Rev.1 with the old quantities).
  const [patchedOrders, setPatchedOrders] = useState<Record<string, SharePatch>>({})
  const ordersRef = useRef(orders)
  ordersRef.current = orders
  const effectiveOrders = useMemo(() => mergeWizardOrders(orders, patchedOrders), [orders, patchedOrders])

  // Once an order has been sent (or skipped) in THIS wizard it is done; `resend` only
  // decides whether one that was already sent before the wizard opened is offered again.
  const doneHere = useRef(new Set<string>())
  const pending = useMemo(
    () => effectiveOrders.filter((o) => !doneHere.current.has(o.id) && (resend || (o.shareStatus !== 'sent' && o.shareStatus !== 'skipped'))),
    [effectiveOrders, resend],
  )
  const [provider, setProvider] = useState<PurchaseShareProvider | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(pending[0]?.id ?? null)
  const [pageIdx, setPageIdx] = useState(0)
  const [sheetLang, setSheetLang] = useState<Lang>(screenLang)
  const [busy, setBusy] = useState<'' | 'render' | 'share'>('')
  const [askOutcome, setAskOutcome] = useState(false)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [prepareError, setPrepareError] = useState('')
  const [prepareTick, setPrepareTick] = useState(0)
  // A share that failed: what went wrong, and the ways forward (retry, download, copy, later).
  const [failure, setFailure] = useState('')
  // LINE confirmed the message went but the order could not be updated: save again, never resend.
  const [unsaved, setUnsaved] = useState<{ version: number; error: string } | null>(null)
  const progressFp = useRef('')
  // A second tap while the share sheet is opening opens nothing (stops before React re-renders).
  const sharing = useRef(false)
  // One outcome is written at a time. A double tap on "sent" or "skip" used to write the
  // order twice and ring the bell twice; the ref stops the second tap before React can
  // re-render, the state greys the buttons out for the person.
  const recording = useRef(false)
  // The newest copy of each order seen here. The server's reply to the supplier link (the
  // supplier asked, waiting, date requested) arrives after `current` was handed over, and the
  // outcome written next must land on that reply, not roll the order back to the list's copy.
  const tracker = useRef(createOutcomeTracker()).current
  const [recordingNow, setRecordingNow] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)

  const [needsLogin, setNeedsLogin] = useState(false)
  useEffect(() => {
    void pickShareProvider().then(async (p) => {
      setProvider(p)
      if (p.id === 'line-liff') setNeedsLogin(await liffNeedsLogin())
    })
  }, [])

  // Follow the list as orders get their status: the current one is the first still pending.
  // Keyed on WHICH orders are pending, not on the array: the parent re-renders while a
  // share is in flight (the "opened" status is written first), and resetting on identity
  // wiped the "was it sent?" question the moment it appeared.
  const pendingKey = pending.map((o) => o.id).join(',')
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => {
    const first = pendingRef.current[0]
    setCurrentId(first?.id ?? null)
    setFailure('')
    // Back after the page was dropped while LINE was in front: a multi-page order goes on from
    // the page not yet shared; an order whose share sheet was opened asks whether it went,
    // instead of quietly starting the send again.
    const resumeAt = first && user ? pageToResume(scopeOf(first), paginateLines(first.lines).length) : 0
    progressFp.current = first ? orderFingerprint(first) : ''
    setPageIdx(resumeAt)
    setAskOutcome(!!first && resumeAt === 0 && first.shareStatus === 'shareOpened')
  }, [pendingKey])

  // Always the order as it now stands: its status fields move while it is being sent.
  const current = currentId ? (effectiveOrders.find((o) => o.id === currentId) ?? null) : null

  // The order content the pages shared so far belong to (R38 review, finding A). If the order is
  // amended mid-send — or a fresher copy arrives after the wizard resumed from a cached one — the
  // pages already shared are of the old order: start again at page 1 rather than skip the change.
  const currentFp = current ? orderFingerprint(current) : ''
  useEffect(() => {
    if (!current || !currentFp) return
    if (progressFp.current && currentFp !== progressFp.current && pageIdx > 0) {
      clearPageProgress(scopeOf(current))
      setPageIdx(0)
      toast.info(t('ใบสั่งซื้อถูกแก้ไขระหว่างส่ง — เริ่มส่งใหม่ที่รูปที่ 1'))
    }
    progressFp.current = currentFp
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFp])
  const pages = useMemo(() => (current ? paginateLines(current.lines) : []), [current])
  const doneCount = effectiveOrders.length - pending.length
  const position = doneCount + 1

  function scopeOf(order: PurchaseOrder): ProgressScope {
    return { brand: getBrand(), userId: user?.id ?? '', orderId: order.id, fingerprint: orderFingerprint(order) }
  }

  async function record(order: PurchaseOrder, status: 'shareOpened' | 'sent' | 'skipped' | 'failed', version?: number) {
    if (!user || recording.current) return
    recording.current = true
    setRecordingNow(true)
    try {
      const brand = getBrand()
      const written = await setShareStatus(order.id, status, { id: user.id, name: user.name }, version)
      if (status === 'sent' || status === 'skipped') {
        doneHere.current.add(order.id)
        clearPageProgress(scopeOf(order))
      }
      // The bell's record that it went (info, no popup); best effort like every deliver().
      if (status === 'sent') void deliver(poSentDraft(order, { id: user.id, name: user.name }, version ?? (order.imageVersion ?? 0) + 1), { id: user.id })
      // Exactly what was written, so the list, the sheet and the batch agree at once — and
      // the device's copy too, so coming back to the list does not show the old badge.
      // Only the written fields go into the device cache, onto the row it holds now (R29).
      const held = getBrand() === brand ? await orderCache.patchFields(order.id, written) : undefined
      // Built on the order as the parent holds it now, so the caller's row keeps any amendment.
      const base = ordersRef.current.find((o) => o.id === order.id) ?? order
      const next = tracker.afterWrite(base, written, held)
      setPatchedOrders((prev) => ({ ...prev, [order.id]: { ...prev[order.id], ...written } }))
      await onStatus(next)
    } finally {
      recording.current = false
      setRecordingNow(false)
    }
  }

  // What the sheet shows; the order's status fields move while it is being sent and are not part of it.
  const payloadKey = current && provider
    ? JSON.stringify([current.id, current.revision ?? 0, current.expectedAt ?? 0, current.note ?? '', current.lines.map((l) => [l.productId, l.orderedQty, l.unit]), pageIdx, sheetLang, provider.id])
    : ''

  // Prepare: render (and, for LINE, host) the picture and fetch the supplier link, in the background.
  useEffect(() => {
    if (!payloadKey || !current || !provider || askOutcome) return
    let stale = false
    setPrepared((p) => (p?.key === payloadKey ? p : null))
    setPrepareError('')
    void (async () => {
      // Let the sheet for this page and language paint before it is captured.
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      if (stale || !sheet.current) return
      const page = { n: pageIdx + 1, of: pages.length }
      try {
        setBusy('render')
        const original = await renderElementToJpeg(sheet.current, { scale: 2 })
        const file = new File([original], sheetFileName(current.docNo, page), { type: 'image/jpeg' })
        const version = (current.imageVersion ?? 0) + 1
        let hosted: HostedImage | undefined
        if (provider.needsHosting) {
          if (!imageHostAvailable()) throw new Error(t('เครื่องนี้ยังไม่ได้ตั้งค่าที่เก็บรูปสำหรับส่ง LINE'))
          const preview = await renderElementToJpeg(sheet.current, { scale: 1, quality: 0.8 })
          hosted = await uploadPoImage({ poId: current.id, original, preview, version })
        }
        // The new-order message and the supplier's confirmation link go with the first page
        // (5 Oct 2026): text, then the [ยืนยันวันจัดส่ง] card, then the sheet. Still the
        // person's own LINE through the picker — which takes plain text only, so a real @All
        // mention cannot be made here and none is faked as text. No link (not set up yet,
        // or offline) → the sheet goes out exactly as before.
        const link = pageIdx === 0 ? await supplierLink(current) : null
        if (stale) return
        if (link) tracker.observe(link.order)
        const st = translatorFor(sheetLang)
        const asked = requestedOf(link?.order ?? current)
        const pageTag = page.of > 1 ? ` (${page.n}/${page.of})` : ''
        const caption = link
          ? newOrderMessage(st, {
              company,
              docNo: current.docNo + pageTag,
              supplier: current.supplierName,
              date: asked !== undefined ? supplierDateLabel(asked, sheetLang) : undefined,
              url: link.url,
            })
          : t('ใบสั่งซื้อ {docNo} — {company}', { docNo: current.docNo, company }) + pageTag
        setPrepared({ key: payloadKey, file, hosted, caption, card: link ? confirmCard(link.url, current.docNo, st) : undefined, version })
      } catch (e) {
        if (!stale) setPrepareError(errText(e, t))
      } finally {
        if (!stale) setBusy('')
      }
    })()
    return () => {
      stale = true
    }
    // `current` is read through payloadKey: re-preparing on every status write would re-upload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey, prepareTick, askOutcome])

  // Share: the first thing the tap does. Status writes and the outcome follow the share sheet.
  function send() {
    if (!current || !provider || !user || sharing.current) return
    const p = prepared
    if (!p || p.key !== payloadKey) return
    sharing.current = true
    setBusy('share')
    setFailure('')
    const order = current
    const isLast = pageIdx === pages.length - 1
    let shared: ReturnType<PurchaseShareProvider['share']>
    try {
      shared = provider.share({ subject: { kind: 'order', id: order.id }, file: p.file, hosted: p.hosted, caption: p.caption, card: p.card })
    } catch (e) {
      shared = Promise.reject(e)
    }
    // Opened is still written, just after the share sheet was asked for rather than before.
    const opened = order.shareStatus !== 'shareOpened' ? record(order, 'shareOpened') : Promise.resolve()
    void (async () => {
      try {
        const settled = await settleShare({
          shared,
          opened,
          isLast,
          recordSent: () => record(order, 'sent', p.version),
          recordFailed: () => record(order, 'failed'),
        })
        if (settled.kind === 'nextPage') {
          // More pages of the same order: stay on it, move to the next page, and remember that.
          savePageProgress(scopeOf(order), pageIdx + 1)
          progressFp.current = orderFingerprint(order)
          setPageIdx(pageIdx + 1)
        } else if (settled.kind === 'ask') {
          // The share sheet told us nothing. Ask the one person who knows.
          setAskOutcome(true)
        } else if (settled.kind === 'sentUnsaved') {
          setUnsaved({ version: p.version, error: errText(settled.error, t) })
        } else if (settled.kind === 'failed') {
          setFailure(errText(settled.error, t))
        }
      } finally {
        sharing.current = false
        setBusy('')
      }
    })()
  }

  async function confirmSent(order: PurchaseOrder, version: number) {
    try {
      await record(order, 'sent', version)
      setUnsaved(null)
    } catch (e) {
      // The message went; only the record failed. Keep this question on screen to try again.
      toast.error(t('บันทึกสถานะไม่สำเร็จ: {e}', { e: errText(e, t) }))
    }
  }

  function downloadPicture() {
    if (!prepared) return
    const url = URL.createObjectURL(prepared.file)
    const a = document.createElement('a')
    a.href = url
    a.download = prepared.file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  async function copyMessage() {
    if (!prepared) return
    try {
      await navigator.clipboard.writeText(prepared.caption)
      toast.success(t('คัดลอกข้อความแล้ว'))
    } catch (e) {
      toast.error(errText(e, t))
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
            {effectiveOrders.map((o) => (
              <li key={o.id} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 text-ink">{o.supplierName}</span>
                <span className="doc-no text-xs text-ink-faint">{o.docNo}</span>
                <LineBadge order={o} />
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
        {(() => {
          const group = suppliers.find((s) => s.id === current.supplierId)?.lineGroup
          return group ? (
            <div className="flex items-center gap-2 rounded-lg bg-in-soft px-3 py-2 text-sm font-semibold text-in">
              <Icon name="message" size={16} />
              {t('ส่งเข้ากลุ่ม LINE: {name}', { name: group })}
            </div>
          ) : (
            <p className="text-xs text-ink-faint">{t('ยังไม่ได้ระบุกลุ่ม LINE ของผู้ขายนี้ — ใส่ได้ที่หน้าผู้ขาย')}</p>
          )
        })()}
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
        {prepareError && !askOutcome && (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
            <p className="mb-2">{t('เตรียมรูปไม่สำเร็จ: {e}', { e: prepareError })}</p>
            <Button variant="secondary" onClick={() => setPrepareTick((n) => n + 1)}>
              {t('ลองเตรียมใหม่')}
            </Button>
          </div>
        )}
        {unsaved && (
          <div role="alert" className="rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm">
            <p className="mb-2 text-ink">
              <strong>{t('LINE ส่งแล้ว แต่บันทึกสถานะไม่สำเร็จ')}</strong> — {t('ห้ามส่งซ้ำ')} ({unsaved.error})
            </p>
            <Button onClick={() => void confirmSent(current, unsaved.version)} disabled={recordingNow}>
              {t('บันทึกสถานะอีกครั้ง')}
            </Button>
          </div>
        )}
        {failure && !askOutcome && !unsaved && (
          <div role="group" aria-label={t('ส่งไม่สำเร็จ')} className="rounded-lg border border-danger/40 bg-danger-soft p-3">
            <p className="mb-2 text-sm text-danger">
              <strong>{t('ส่งไม่สำเร็จ')}</strong> — {failure}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => send()} disabled={!!busy || !prepared}>
                {t('ลองอีกครั้ง')}
              </Button>
              <Button variant="secondary" onClick={downloadPicture} disabled={!prepared}>
                {t('ดาวน์โหลดรูป')}
              </Button>
              <Button variant="secondary" onClick={() => void copyMessage()} disabled={!prepared}>
                {t('คัดลอกข้อความ')}
              </Button>
              <Button variant="secondary" onClick={onClose}>
                {t('ไว้ส่งทีหลัง')}
              </Button>
            </div>
          </div>
        )}
        {askOutcome ? (
          <div className="rounded-lg border border-line bg-sunken p-3">
            <p className="mb-2 text-sm text-ink">{t('ส่งใน LINE เรียบร้อยหรือไม่?')}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void confirmSent(current, (current.imageVersion ?? 0) + 1)} disabled={recordingNow}>
                <Icon name="check" size={16} />
                {t('ส่งแล้ว')}
              </Button>
              <Button variant="secondary" onClick={() => setAskOutcome(false)} disabled={recordingNow}>
                {t('ยังไม่ได้ส่ง — ลองอีกครั้ง')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={!!busy}>
              {t('พักไว้ก่อน')}
            </Button>
            <Button variant="secondary" onClick={() => void skip()} disabled={!!busy || recordingNow}>
              {t('ข้าม')}
            </Button>
            <Button onClick={() => send()} disabled={!!busy || !!unsaved || !provider || !prepared || prepared.key !== payloadKey}>
              <Icon name="share" size={16} />
              {busy === 'render'
                ? t('กำลังเตรียมรูป…')
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
            ? needsLogin
              ? isStandalone()
                ? t('ครั้งแรกจะเปิดใบนี้ในแอป LINE ให้ (แอปจากหน้าจอโฮมเข้าสู่ระบบ LINE เองไม่ได้) — กด "ส่ง LINE" ที่นั่นอีกครั้ง')
                : t('ครั้งแรกจะพาไปเข้าสู่ระบบ LINE แล้วกลับมาที่ใบนี้ — กด "ส่ง LINE" อีกครั้งเพื่อเลือกแชท')
              : t('กด "ส่ง LINE" → เลือกแชทของผู้ขาย → ส่ง แล้วกลับมาที่นี่ ระบบจะไปรายถัดไปเอง')
            : t('เครื่องนี้ไม่มี LINE (LIFF) — จะเปิดเมนูแชร์ของเครื่องแทน เลือก LINE แล้วเลือกแชทของผู้ขาย')}
        </p>
      </div>
    </Modal>
  )
}

/** The supplier's confirm button as a Flex card: one link (URI) action, all the picker allows. */
function confirmCard(url: string, docNo: string, t: TFn): { altText: string; contents: Record<string, unknown> } {
  const label = t('ยืนยันวันจัดส่ง')
  return {
    altText: `${label} ${docNo}: ${url}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: docNo, weight: 'bold', size: 'md' },
          { type: 'text', text: t('กดเพื่อยืนยันหรือเลือกวันจัดส่ง'), size: 'sm', color: '#64748b', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'button', style: 'primary', color: '#06c755', action: { type: 'uri', label, uri: url } }],
      },
    },
  }
}

/** The new-order message in the sheet's language, as the owner wrote it (5 Oct 2026). */
function newOrderMessage(t: TFn, m: { company: string; docNo: string; supplier: string; date?: string; url: string }): string {
  return [
    t('📦 ใบสั่งซื้อใหม่จาก {company}', { company: m.company.toUpperCase() }),
    '',
    m.docNo,
    t('ผู้ขาย: {name}', { name: m.supplier }),
    t('วันที่ต้องการสินค้า: {date}', { date: m.date ?? t('ไม่ระบุ') }),
    '',
    t('กรุณาตรวจสอบและยืนยันวันที่สามารถจัดส่งได้'),
    m.url,
  ].join('\n')
}
