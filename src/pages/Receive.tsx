import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { SiteSelect } from '../components/SiteChip'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Field, Input, Modal } from '../components/ui'
import { FramePage, PageHero, SectionCard, WithSidePanel, frameCard } from '../components/frame'
import { SubmitBar } from '../components/keying/SubmitBar'
import { LineBuilder } from '../components/LineBuilder'
import { ThaiDateField } from '../components/ThaiDateField'
import { Icon, type IconName } from '../components/Icon'
import { receiveStock } from '../services/stock'
import { listOpenOrders, receivePurchaseOrder } from '../services/purchaseOrders'
import { findDuplicateDocument, type DuplicateDoc } from '../services/receiptDocs'
import { useSuppliers } from '../services/suppliers'
import { compressImage } from '../lib/image'
import { matchOcrLines } from '../lib/billOcr'
import { buildMatchIndex } from '../lib/productMatch'
import { billReaderAvailable, readBillPhoto } from '../services/billOcr'
import { ocrFill, type OcrFill } from './receive/ocrApply'
import { shownUnit } from '../lib/ledger'
import { dateInputToMs, msToDateInput, todayMs } from '../lib/format'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { useDraft } from '../lib/useDraft'
import { DraftNotice } from '../components/DraftNotice'
import type { PurchaseOrder } from '../types'
import { PoPicker } from './receive/PoPicker'
import { PoLines } from './receive/PoLines'
import { DocumentCard, OTHER_SUPPLIER } from './receive/DocumentCard'
import { ReceiptDone, ReceiptPanel, ReviewModal, type Exception, type ReceiptFacts } from './receive/ReceiptReview'
import {
  draftIsEmpty,
  emptyDraft,
  manualProblem,
  nextQueued,
  outstanding,
  owedLines,
  poProblem,
  restoreReceipt,
  summarise,
  variance,
  type Mode,
  type ReceiptDraft,
  type ReceiptProblem,
} from './receive/receipt'

interface Done {
  docNo: string
  facts: Pick<ReceiptFacts, 'supplierName' | 'poDocNo' | 'items'>
  exceptions: number
  outstandingLines?: number
}

/**
 * รับสินค้าเข้า, purchase order first (owner, 24 Sep 2026):
 *
 *   SELECT PO → everything loads → "รับครบตาม PO" → fix the exceptions → document →
 *   review → confirm
 *
 * — a normal delivery that matches its order is five presses. Deliveries with no order
 * behind them ("รับนอกใบสั่งซื้อ") keep the product-by-product builder. Either way it is one
 * bill at a time, with its supplier, number, date and photo as fields of their own, and
 * nothing moves until the review is confirmed.
 *
 * The receiving itself is the engine it always was: receivePurchaseOrder (tick, reason,
 * the order's unit rate) and receiveStock (the ledger). This page only gathers the input.
 * Who received is whoever is signed in — the anti-fraud rule.
 */
export function ReceivePage() {
  const t = useT()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { products, locations, qtyAt } = useData()
  const suppliers = useSuppliers()
  const { user } = useAuth()
  const toast = useToast()

  const warehouses = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const defaultWh = warehouses.find((l) => l.type === 'warehouse') ?? warehouses[0]

  const [d, setD] = useState<ReceiptDraft>(() => ({ ...emptyDraft(), dateStr: msToDateInput(todayMs()) }))
  const patch = useCallback((p: Partial<ReceiptDraft>) => setD((cur) => ({ ...cur, ...p })), [])
  const [photo, setPhoto] = useState<string | null>(null)
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null)
  const [dup, setDup] = useState<{ key: string; hit: DuplicateDoc | null } | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [closeShort, setCloseShort] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [help, setHelp] = useState(false)
  const [focusPicker, setFocusPicker] = useState(0)
  const [focusLines, setFocusLines] = useState(0)

  // Half-keyed receipts survive leaving the screen (lib/useDraft.ts), whichever version of
  // this screen saved them (receive/receipt.ts). The photo never does.
  // A link to one order (?po=) outranks a draft of another: the draft can be restored after
  // the link was read (StrictMode re-runs effects; the brand or the person can resolve
  // late), so the link is held here and laid over whatever comes back.
  const linkRef = useRef<string | null>(null)
  const withLink = useCallback((r: ReceiptDraft): ReceiptDraft => {
    const id = linkRef.current
    return id ? { ...r, mode: 'po', poId: id, entries: r.poId === id ? r.entries : {} } : r
  }, [])
  const { restored, clear: clearDraft } = useDraft('receive', d, (saved) => setD(withLink(restoreReceipt(saved))), draftIsEmpty)

  // Orders waiting for goods: asked for when the screen opens and after each receipt —
  // one read per open order, no listener.
  const loadOrders = useCallback(() => {
    setOrders(null)
    listOpenOrders()
      .then(setOrders)
      .catch((e) => {
        setOrders([])
        toast.error(errText(e, t))
      })
  }, [toast, t])
  useEffect(loadOrders, [loadOrders])

  // /receive?po=<id> — from the Orders page or the calendar: that order, ready to check in.
  const linked = params.get('po')
  useEffect(() => {
    if (!linked || linkRef.current === linked) return
    linkRef.current = linked
    setDone(null)
    setD(withLink)
    // Placed after the list was read (the screen was already open): read it again. On
    // arrival the list is still loading, and that read already includes it.
    if (orders && !orders.some((o) => o.id === linked)) loadOrders()
    const next = new URLSearchParams(params)
    next.delete('po')
    setParams(next, { replace: true })
  }, [linked, params, setParams, loadOrders, orders, withLink])

  useEffect(() => {
    if (!d.toLocationId && defaultWh) patch({ toLocationId: defaultWh.id })
  }, [d.toLocationId, defaultWh, patch])

  const order = d.mode === 'po' && orders ? (orders.find((o) => o.id === d.poId) ?? null) : null
  const orderMissing = d.mode === 'po' && !!d.poId && orders !== null && !order
  const summary = order ? summarise(order, d.entries) : null

  const supplierName = order ? order.supplierName : d.supplierName.trim()
  const supplierId = order ? order.supplierId : d.supplierId && d.supplierId !== OTHER_SUPPLIER ? d.supplierId : ''
  const toLocationId = order ? order.locationId : d.toLocationId
  const warehouseName = locations.find((l) => l.id === toLocationId)?.name ?? ''
  const date = dateInputToMs(d.dateStr)
  const docDate = dateInputToMs(d.docDateStr || d.dateStr)

  const problem: ReceiptProblem | null =
    d.mode === 'po' ? poProblem(order, d.entries, d.invoiceNo) : manualProblem(d.lines, supplierName, d.invoiceNo)

  function problemText(p: ReceiptProblem): string {
    switch (p) {
      case 'noOrder':
        return t('เลือกใบสั่งซื้อก่อน')
      case 'pending':
        return t('ยังไม่ได้ใส่จำนวนรับ {n} รายการ — กด "รับครบตาม PO ทั้งหมด" หรือใส่ทีละรายการ', { n: summary?.pending ?? 0 })
      case 'unexplained':
        return t('ระบุเหตุผลของรายการที่ไม่ตรง {n} รายการ', { n: summary?.unexplained ?? 0 })
      case 'nothing':
        return t('ไม่มีรายการที่รับเข้า')
      case 'noInvoice':
        return t('กรุณากรอกเลขที่เอกสาร / ใบกำกับ')
      case 'noLines':
        return t('เพิ่มรายการสินค้าก่อน')
      case 'badQty':
        return t('จำนวนต้องมากกว่า 0')
      case 'noSupplier':
        return t('เลือกผู้ขาย')
    }
  }

  // The same bill from the same supplier, already on the books. Asked when the number is
  // typed and again before the review; the answer is kept per supplier + number.
  const dupKey = `${supplierId || supplierName.toUpperCase()}|${d.invoiceNo.trim().toUpperCase()}`
  const duplicate = dup?.key === dupKey ? dup.hit : null
  async function checkDuplicate(): Promise<DuplicateDoc | null> {
    if (!d.invoiceNo.trim() || !supplierName) return null
    if (dup?.key === dupKey) return dup.hit
    try {
      const hit = await findDuplicateDocument({ invoiceNo: d.invoiceNo, supplierId: supplierId || undefined, supplierName })
      setDup({ key: dupKey, hit })
      return hit
    } catch {
      return null // the check is a courtesy; failing to make it must not stop a receipt
    }
  }

  const exceptions: Exception[] = order
    ? owedLines(order)
        .map((l) => {
          const e = d.entries[l.productId]
          const owed = outstanding(l)
          const v = variance(owed, e?.qty ?? null)
          return v === 'short' || v === 'over'
            ? { productId: l.productId, productName: l.productName, owed, qty: e?.qty ?? 0, unit: shownUnit(l), reason: e?.reason.trim() ?? '' }
            : null
        })
        .filter((x): x is Exception => x !== null)
    : []

  const facts: ReceiptFacts = {
    supplierName,
    poDocNo: order?.docNo,
    warehouse: warehouseName,
    date,
    invoiceNo: d.invoiceNo.trim(),
    docDate,
    hasPhoto: !!photo,
    note: d.note.trim(),
    items: order ? (summary?.items ?? 0) : d.lines.length,
    matched: summary?.matched ?? 0,
    short: summary?.short ?? 0,
    over: summary?.over ?? 0,
  }

  async function openReview() {
    if (problem) {
      setTried(true)
      return toast.error(problemText(problem))
    }
    if (!toLocationId) return toast.error(t('เลือกคลังปลายทาง'))
    await checkDuplicate()
    setCloseShort(false)
    setCloseReason('')
    setReviewing(true)
  }

  async function confirm() {
    const actor = { id: user!.id, name: user!.name }
    setBusy(true)
    try {
      if (order) {
        const result = await receivePurchaseOrder({
          orderId: order.id,
          invoiceNo: d.invoiceNo,
          date,
          docDate,
          note: d.note,
          photoDataUrl: photo ?? undefined,
          actor,
          lines: owedLines(order).map((l) => {
            const e = d.entries[l.productId]
            return {
              productId: l.productId,
              receivedQty: e?.qty ?? 0,
              checked: variance(outstanding(l), e?.qty ?? null) === 'match',
              note: e?.reason,
            }
          }),
          ...(closeShort && facts.short > 0 ? { closeRemainder: { reason: closeReason } } : {}),
        })
        setDone({ docNo: result.docNo, facts, exceptions: exceptions.length, outstandingLines: result.outstandingLines })
      } else {
        const docNo = await receiveStock({
          lines: d.lines,
          toLocationId,
          date,
          actor,
          note: d.note.trim() || undefined,
          doc: { supplierId: supplierId || undefined, supplierName, invoiceNo: d.invoiceNo, docDate },
          photoDataUrl: photo ?? undefined,
        })
        setDone({ docNo, facts, exceptions: 0 })
      }
      // Filed: the form empties at once, so pressing anything again cannot file it twice.
      linkRef.current = null
      setReviewing(false)
      setTried(false)
      setPhoto(null)
      setOcr(null)
      setD((cur) => ({ ...emptyDraft(), mode: cur.mode, toLocationId: cur.toLocationId, dateStr: cur.dateStr, queue: cur.queue }))
      if (d.queue.length === 0) clearDraft()
      window.scrollTo({ top: 0 })
    } catch (e) {
      toast.error(t('บันทึกไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  function next() {
    setDone(null)
    const queued = nextQueued(d)
    if (queued) {
      setD(queued)
      setFocusLines((n) => n + 1)
      return
    }
    if (d.mode === 'po') {
      loadOrders()
      setFocusPicker((n) => n + 1)
    } else {
      setFocusLines((n) => n + 1)
    }
  }

  function setMode(mode: Mode) {
    if (mode === d.mode) return
    linkRef.current = null
    setDone(null)
    setTried(false)
    setDup(null)
    patch({ mode })
  }

  // A bill read by AI (Automation Plan Phase 4): it only fills the form; the person checks.
  const [reading, setReading] = useState(false)
  const [ocr, setOcr] = useState<OcrFill | null>(null)
  async function readBill() {
    if (!photo) return
    setReading(true)
    try {
      const bill = await readBillPhoto(photo)
      const filled = ocrFill(bill, matchOcrLines(bill, buildMatchIndex(products, [])), { draft: d, order, suppliers })
      patch(filled.patch)
      setOcr(filled)
      toast.success(t('AI อ่านบิลแล้ว — ใส่ให้ {n} รายการ ตรวจก่อนยืนยันทุกครั้ง', { n: filled.filled }))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setReading(false)
    }
  }

  async function pickPhoto(file: File | null) {
    if (!file) return setPhoto(null)
    try {
      setPhoto(await compressImage(file))
    } catch {
      toast.error(t('อ่านรูปไม่สำเร็จ'))
    }
  }

  function discardDraft() {
    linkRef.current = null
    setD({ ...emptyDraft(), toLocationId: d.toLocationId, dateStr: msToDateInput(todayMs()) })
    setPhoto(null)
    setOcr(null)
    clearDraft()
  }

  const cta = t('ตรวจสอบและรับสินค้า')

  return (
    <FramePage>
      <PageHero
        icon="receive"
        tone="in"
        title={t('รับสินค้าเข้า')}
        subtitle={t('เลือกใบสั่งซื้อ → รับครบ → แก้เฉพาะรายการที่ไม่ตรง → ตรวจสอบ → ยืนยัน')}
        actions={
          <>
            <Link to="/movements" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink">
              <Icon name="history" size={17} />
              {t('ประวัติรับเข้า')}
            </Link>
            <Button variant="secondary" onClick={() => setHelp(true)} aria-label={t('วิธีรับสินค้า')}>
              <Icon name="info" size={17} />
              <span className="hidden sm:inline">{t('วิธีใช้')}</span>
            </Button>
          </>
        }
      />

      <ModeCards mode={d.mode} setMode={setMode} />

      {done ? (
        <ReceiptDone
          docNo={done.docNo}
          facts={done.facts}
          exceptions={done.exceptions}
          outstandingLines={done.outstandingLines}
          queued={d.queue.length}
          onNext={next}
          onView={() => navigate(`/movements?doc=${encodeURIComponent(done.docNo)}`)}
        />
      ) : (
        <WithSidePanel
          sideLabel={t('สรุปใบรับนี้')}
          side={
            <ReceiptPanel
              mode={d.mode}
              facts={facts}
              pending={summary?.pending ?? 0}
              problem={problem ? problemText(problem) : null}
              busy={busy}
              onReview={() => void openReview()}
            />
          }
        >
          {restored && <DraftNotice onDiscard={discardDraft} />}

          {d.mode === 'po' ? (
            <>
              <PoPicker
                orders={orders}
                selected={order}
                missing={orderMissing}
                onPick={(o) => {
                  linkRef.current = null
                  setTried(false)
                  patch({ poId: o.id, entries: {} })
                }}
                onClear={() => {
                  linkRef.current = null
                  patch({ poId: '', entries: {} })
                }}
                focusSearch={focusPicker}
              />
              {order && (
                <>
                  <ReceiveWhere warehouse={warehouseName} dateStr={d.dateStr} onDate={(v) => patch({ dateStr: v })} />
                  <PoLines order={order} entries={d.entries} onChange={(entries) => patch({ entries })} invalid={tried} />
                </>
              )}
            </>
          ) : (
            <>
              <SectionCard icon="receive" title={t('ข้อมูลการรับ')}>
                <div className="grid grid-cols-2 gap-3 md:gap-4">
                  <Field label={t('คลังปลายทาง')} required>
                    <SiteSelect value={d.toLocationId} onChange={(v) => patch({ toLocationId: v })} locations={warehouses} />
                  </Field>
                  <Field label={t('วันที่รับ')} required>
                    <ThaiDateField value={d.dateStr} onChange={(v) => patch({ dateStr: v })} ariaLabel={t('วันที่รับ')} />
                  </Field>
                </div>
              </SectionCard>
              <SectionCard icon="package" title={t('รายการสินค้า')} count={d.lines.length ? t('({n} รายการ)', { n: d.lines.length }) : undefined}>
                <LineBuilder
                  products={products}
                  lines={d.lines}
                  onChange={(lines) => patch({ lines })}
                  direction="in"
                  onHandAt={d.toLocationId ? (id) => qtyAt(d.toLocationId, id) : undefined}
                  focusOn={focusLines}
                  lineNotes
                />
              </SectionCard>
            </>
          )}

          {(d.mode === 'manual' || order) && (
            <DocumentCard
              locked={order ? order.supplierName : undefined}
              suppliers={suppliers}
              supplierId={d.supplierId}
              supplierName={d.supplierName}
              onSupplier={(id, name) => patch({ supplierId: id, supplierName: name })}
              invoiceNo={d.invoiceNo}
              onInvoice={(v) => patch({ invoiceNo: v })}
              onInvoiceBlur={() => void checkDuplicate()}
              docDateStr={d.docDateStr || d.dateStr}
              onDocDate={(v) => patch({ docDateStr: v })}
              photo={photo}
              onPhoto={(f) => void pickPhoto(f)}
              note={d.note}
              onNote={(v) => patch({ note: v })}
              duplicate={duplicate}
              invalid={{ supplier: tried && problem === 'noSupplier', invoice: tried && problem === 'noInvoice' }}
              onReadBill={billReaderAvailable() ? () => void readBill() : undefined}
              reading={reading}
            />
          )}

          {ocr && ocr.skipped.length > 0 && (
            <div className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-ink">
              <div className="font-semibold">{t('AI อ่านได้แต่ยังไม่ได้ใส่ให้ {n} รายการ — คีย์เอง', { n: ocr.skipped.length })}</div>
              <ul className="mt-1 list-disc pl-5 text-xs text-ink-soft">
                {ocr.skipped.map((s, i) => (
                  <li key={`${s.name}-${i}`}>
                    {s.name} —{' '}
                    {s.why === 'noProduct'
                      ? t('ไม่พบสินค้าที่ชื่อตรงกัน')
                      : s.why === 'notOnOrder'
                        ? t('ไม่อยู่ในใบสั่งซื้อนี้')
                        : s.why === 'unit'
                          ? t('หน่วยในบิลไม่ตรงกับหน่วยที่สั่ง/หน่วยสินค้า')
                          : t('มีในรายการแล้ว')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Below the wide layout the side panel sits under the form, so the button lives here. */}
          <div className="xl:hidden">
            <SubmitBar hasDraft={!draftIsEmpty(d)}>
              <Button onClick={() => void openReview()} disabled={busy} variant="success" className="w-full sm:w-auto sm:min-w-64">
                <Icon name="checkCircle" size={18} />
                {cta}
              </Button>
            </SubmitBar>
          </div>
        </WithSidePanel>
      )}

      {reviewing && (
        <ReviewModal
          facts={facts}
          exceptions={exceptions}
          duplicate={duplicate}
          canCloseShort={!!order && facts.short > 0}
          closeShort={closeShort}
          onCloseShort={setCloseShort}
          closeReason={closeReason}
          onCloseReason={setCloseReason}
          busy={busy}
          onBack={() => setReviewing(false)}
          onConfirm={() => void confirm()}
        />
      )}

      {help && (
        <Modal open compact onClose={() => setHelp(false)} title={t('วิธีรับสินค้า')}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
            <li>{t('เลือกใบสั่งซื้อ → กด "รับครบตาม PO ทั้งหมด" → แก้เฉพาะรายการที่มาไม่ตรง')}</li>
            <li>{t('ของมาไม่ครบ: ใส่จำนวนที่มาจริงพร้อมเหตุผล ใบสั่งซื้อจะเปิดค้างไว้รอส่วนที่เหลือ')}</li>
            <li>{t('ของที่ไม่มีใบสั่งซื้อ ใช้ "รับนอกใบสั่งซื้อ" แล้วคีย์ทีละสินค้า')}</li>
            <li>{t('หลายบิลในวันเดียว: รับทีละบิล แล้วกด "รับบิลถัดไป"')}</li>
            <li>{t('ระบบเตือนเมื่อเลขเอกสารซ้ำกับบิลเดิมของผู้ขายรายเดียวกัน (บิลที่คีย์ก่อน 24/09/2569 เก็บไว้ในหมายเหตุ ระบบตรวจซ้ำไม่ได้)')}</li>
            <li>{t('คีย์เป็นหน่วยที่อยู่บนบิลได้เลย ระบบแปลงเป็นหน่วยหลักให้')}</li>
            <li>{t('คีย์ผิดแก้ได้จากหน้าประวัติ — ยอดคงเหลือปรับตามอัตโนมัติ')}</li>
          </ul>
        </Modal>
      )}
    </FramePage>
  )
}

/** Where the order's goods go and on which day. The warehouse is the order's, not a choice. */
function ReceiveWhere({ warehouse, dateStr, onDate }: { warehouse: string; dateStr: string; onDate: (v: string) => void }) {
  const t = useT()
  return (
    <SectionCard icon="receive" title={t('ข้อมูลการรับ')}>
      <div className="grid grid-cols-2 gap-3 md:gap-4">
        <Field label={t('คลังปลายทาง (ตามใบสั่งซื้อ)')}>
          <Input value={warehouse} disabled />
        </Field>
        <Field label={t('วันที่รับ')} required>
          <ThaiDateField value={dateStr} onChange={onDate} ariaLabel={t('วันที่รับ')} />
        </Field>
      </div>
    </SectionCard>
  )
}

/** From a PO (default) or without one — the Issue screen's mode cards. */
function ModeCards({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const t = useT()
  const cards: { key: Mode; icon: IconName; title: string; hint: string }[] = [
    { key: 'po', icon: 'fileSheet', title: t('จากใบสั่งซื้อ'), hint: t('เลือก PO แล้วรับตามรายการที่สั่ง') },
    { key: 'manual', icon: 'package', title: t('รับนอกใบสั่งซื้อ'), hint: t('ของที่ไม่มี PO — คีย์ทีละสินค้า') },
  ]
  return (
    <div role="radiogroup" aria-label={t('ประเภทการรับ')} className={`${frameCard} grid grid-cols-2 gap-2 p-2`}>
      {cards.map((c) => {
        const on = c.key === mode
        return (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setMode(c.key)}
            className={`flex min-h-14 cursor-pointer items-center justify-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
              on ? 'border-in bg-in-soft text-in' : 'border-transparent text-ink-soft hover:bg-sunken'
            }`}
          >
            <Icon name={c.icon} size={24} className="shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-bold md:text-base">{c.title}</span>
              <span className={`hidden text-xs md:block ${on ? 'text-in/80' : 'text-ink-faint'}`}>{c.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
