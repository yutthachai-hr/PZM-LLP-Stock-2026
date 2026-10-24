import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { BarcodeScanner } from '../../components/BarcodeScanner'
import { useConfirm } from '../../components/Confirm'
import { Icon } from '../../components/Icon'
import { SiteChip } from '../../components/SiteChip'
import { useToast } from '../../components/Toast'
import { AlertBanner, Button, EmptyState, FormActions, Input, Select, Spinner, Textarea } from '../../components/ui'
import { FramePage, PageHero, SectionCard } from '../../components/frame'
import { transferCache } from '../../data/transferCache'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { pickOnEnter } from '../../lib/barcode'
import { fmtQty } from '../../lib/format'
import { compressImage } from '../../lib/image'
import { DISCREPANCY_REASON_KEYS, canReceive } from '../../lib/transferStatus'
import { roundQty } from '../../lib/validate'
import { confirmReceive, expectedQty, getTransfer, openReceiving, saveDiscrepancyPhoto, type ReceivedLineInput } from '../../services/transfers'
import type { DiscrepancyReason, Transfer, TransferItem } from '../../types'
import { createSubmitGate, formatDecimalInput, parseDecimalInput, validateReceiveQty } from './receiveHelpers'


/**
 * `/transfers/:id/receive` — the destination checks in a delivery, standing at the door
 * with a phone, a tablet or a barcode scanner.
 *
 * Four deliberate mobile rows: (1) >=44px checkbox + full-width identity/SKU; (2) sent quantity/status;
 * (3) separate stepper with 48px buttons, flex input, >=8px gaps; (4) variance/reason/validation/photo.
 * Synchronous double-submit gate protects confirmation await.
 */

interface Count {
  qty: number
  rawQty?: string
  checked: boolean
  reason?: DiscrepancyReason
  note: string
  photo?: string
}

const SHORT_REASONS: DiscrepancyReason[] = ['SHORT', 'WEIGHT_VARIANCE', 'DAMAGED', 'WRONG_ITEM', 'WRONG_BRANCH', 'COUNTING_ERROR', 'OTHER']
const OVER_REASONS: DiscrepancyReason[] = ['OVER', 'WEIGHT_VARIANCE', 'WRONG_ITEM', 'COUNTING_ERROR', 'OTHER']

export function TransferReceivePage() {
  const t = useT()
  const { id } = useParams()
  const { user } = useAuth()
  const [doc, setDoc] = useState<Transfer | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    if (!id || !user) return
    const actor = { id: user.id, name: user.name, role: user.role, siteIds: user.siteIds }
    ;(async () => {
      const cur = await getTransfer(id)
      // Opening the page is "the branch opened the delivery" in the audit trail.
      const opened = cur && cur.status === 'inTransit' && canReceive(cur, actor) ? await openReceiving(id, actor) : cur
      if (live) setDoc(opened)
    })().catch(() => live && setDoc(null))
    return () => {
      live = false
    }
  }, [id, user])

  if (doc === undefined) return <Spinner label={t('กำลังโหลด...')} />
  if (!doc) return <EmptyState icon="truck" title={t('ไม่พบเอกสารโอนสินค้า')} />
  return <ReceiveForm key={doc.id} transfer={doc} />
}

function ReceiveForm({ transfer }: { transfer: Transfer }) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { products } = useData()
  const actor = useMemo(() => ({ id: user!.id, name: user!.name, role: user!.role, siteIds: user!.siteIds }), [user])
  const lines = transfer.items.filter((i) => !i.removed)
  const submitGate = useRef(createSubmitGate())
  const [counts, setCounts] = useState<Record<number, Count>>(() =>
    Object.fromEntries(lines.map((i) => {
      const exp = expectedQty(i)
      return [i.idx, { qty: exp, rawQty: String(exp), checked: false, note: '' }]
    })),
  )
  const [scan, setScan] = useState('')
  const [camera, setCamera] = useState(false)
  const [lit, setLit] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const scanBox = useRef<HTMLInputElement>(null)

  const allowed = canReceive(transfer, actor)
  const lineProducts = useMemo(() => products.filter((p) => lines.some((l) => l.productId === p.id)), [products, lines])

  function set(idx: number, patch: Partial<Count>) {
    setCounts((c) => ({ ...c, [idx]: { ...c[idx], ...patch } }))
  }

  function handleQtyChange(idx: number, raw: string) {
    const parsed = parseDecimalInput(raw)
    set(idx, { qty: parsed, rawQty: raw, checked: true })
  }

  function bump(i: TransferItem, by: number) {
    const cur = counts[i.idx]?.qty ?? 0
    const next = Math.max(0, roundQty(cur + by))
    set(i.idx, { qty: next, rawQty: String(next), checked: true })
  }

  /** A scan: find the line, mark it counted, bring it into view. */
  function found(code: string) {
    const hit = pickOnEnter(lineProducts, code, [])
    const line = hit && lines.find((l) => l.productId === hit.id)
    setScan('')
    if (!line) {
      toast.error(t('ไม่พบสินค้านี้ในเอกสาร {docNo}', { docNo: transfer.docNo }))
      return
    }
    set(line.idx, { checked: true })
    setLit(line.idx)
    rowRefs.current[line.idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => setLit((cur) => (cur === line.idx ? null : cur)), 2500)
  }

  async function addPhoto(idx: number, file?: File) {
    if (!file) return
    try {
      set(idx, { photo: await compressImage(file) })
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  const diffs = lines.filter((i) => roundQty(counts[i.idx].qty - expectedQty(i)) !== 0)
  const unchecked = lines.filter((i) => !counts[i.idx].checked)

  /**
   * "รับครบตามใบส่ง" (Automation Plan Phase 2): everything arrived as sent — every line at its
   * sent quantity, ticked, and filed in the same press. A line that differs is still keyed
   * one by one below.
   */
  async function receiveAllAsSent() {
    const all = Object.fromEntries(lines.map((i) => {
      const exp = expectedQty(i)
      return [i.idx, { ...counts[i.idx], qty: exp, rawQty: String(exp), checked: true }]
    }))
    setCounts(all)
    await submit(all)
  }

  async function submit(use: Record<number, Count> = counts) {
    if (submitGate.current.isLocked() || busy) return
    const unchecked = lines.filter((i) => !use[i.idx].checked)
    const hasInvalid = lines.some((i) => !validateReceiveQty(use[i.idx].qty).valid)
    if (hasInvalid) return

    await submitGate.current.execute({
      confirm: unchecked.length > 0 ? async () => {
        return await confirm({
          title: t('ยืนยันรับสินค้า'),
          message: t('ยังไม่ได้ติ๊กตรวจ {n} รายการ — ใช้จำนวนตามที่ส่งมาสำหรับรายการเหล่านั้น?', { n: unchecked.length }),
          confirmText: t('ยืนยันรับสินค้า'),
        })
      } : undefined,
      action: async () => {
        setBusy(true)
        try {
          const receivedLines: ReceivedLineInput[] = []
          for (const i of lines) {
            const c = use[i.idx]
            const exp = expectedQty(i)
            const diff = roundQty(c.qty - exp) !== 0
            const photoId = diff && c.photo ? await saveDiscrepancyPhoto(transfer.docNo, i.idx, c.photo) : undefined
            receivedLines.push({
              idx: i.idx,
              receivedQty: c.qty,
              ...(diff ? { discrepancy: { reason: c.reason ?? (c.qty < exp ? 'SHORT' : 'OVER'), note: c.note.trim() || undefined, photoId } } : {}),
            })
          }
          const next = await confirmReceive({ transferId: transfer.id, actor, receivedLines })
          transferCache.patch(next)
          toast.success(next.status === 'completed' ? t('รับสินค้าครบ เอกสารเสร็จสิ้น') : t('บันทึกการรับแล้ว — มีผลต่างรอหัวหน้าพิจารณา'))
          navigate(`/transfers/${transfer.id}`, { replace: true })
          return next
        } catch (e) {
          toast.error(errText(e, t))
          throw e
        } finally {
          setBusy(false)
        }
      },
    })
  }

  return (
    <FramePage>
      <PageHero
        icon="receive"
        tone="in"
        title={t('ตรวจรับสินค้า ({docNo})', { docNo: transfer.docNo })}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SiteChip locationId={transfer.fromLocationId} /> <Icon name="arrowRight" size={14} /> <SiteChip locationId={transfer.toLocationId} />
          </span>
        }
      />

      {!allowed && <AlertBanner tone="danger">{t('ไม่มีสิทธิ์ตรวจรับสินค้าที่สาขานี้')}</AlertBanner>}

      {allowed && diffs.length === 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-in/30 bg-in-soft px-4 py-3">
          <div className="min-w-0 flex-1 text-sm text-ink">
            <div className="font-semibold">{t('ของมาครบตามใบส่งทุกรายการ?')}</div>
            <div className="text-xs text-ink-soft">{t('กดครั้งเดียว รับเข้าสาขาตามจำนวนที่ส่งมาทั้ง {n} รายการ — ถ้ามีรายการไม่ตรง ให้แก้จำนวนด้านล่างแทน', { n: lines.length })}</div>
          </div>
          <Button variant="success" onClick={() => void receiveAllAsSent()} disabled={busy} className="w-full sm:w-auto">
            <Icon name="checkCircle" size={18} />
            {t('รับครบตามใบส่ง')}
          </Button>
        </div>
      )}

      <SectionCard icon="barcode" title={t('ยิงบาร์โค้ด / ค้นหาสินค้า')}>
        <div className="flex gap-2">
          <Input
            ref={scanBox}
            autoFocus
            inputMode="text"
            value={scan}
            placeholder={t('ยิงบาร์โค้ดหรือพิมพ์รหัสสินค้า แล้วกด Enter')}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && scan.trim()) {
                e.preventDefault()
                found(scan)
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <Button variant="outline" onClick={() => setCamera(true)} aria-label={t('สแกนบาร์โค้ด')}>
            <Icon name="camera" size={18} />
            <span className="hidden sm:inline">{t('สแกนด้วยกล้อง')}</span>
          </Button>
        </div>
      </SectionCard>

      <div className="space-y-3 pb-32 md:pb-8">
        {lines.map((i) => {
          const c = counts[i.idx]
          const exp = expectedQty(i)
          const variance = roundQty(c.qty - exp)
          const reasons = variance < 0 ? SHORT_REASONS : OVER_REASONS
          const qtyValidation = validateReceiveQty(c.qty)
          const isInvalid = !qtyValidation.valid

          return (
            <div
              key={i.idx}
              ref={(el) => {
                rowRefs.current[i.idx] = el
              }}
              className={`rounded-2xl border bg-surface p-3 transition-colors md:p-4 ${
                lit === i.idx
                  ? 'border-brand ring-2 ring-brand'
                  : isInvalid
                    ? 'border-out ring-1 ring-out'
                    : variance !== 0
                      ? 'border-warn'
                      : 'border-line'
              }`}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                {/* Mobile Row 1 (Identity) & Row 2 (Dispatched) */}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start gap-3">
                    <label className="flex h-[44px] w-[44px] min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-lg touch-manipulation hover:bg-sunken">
                      <input
                        type="checkbox"
                        className="h-[24px] w-[24px] rounded border-line text-brand focus:ring-brand"
                        checked={c.checked}
                        onChange={(e) => set(i.idx, { checked: e.target.checked })}
                        aria-label={t('ตรวจแล้ว')}
                      />
                    </label>
                    <div className="min-w-0 flex-1 pt-1.5">
                      <div className="font-semibold text-ink text-base leading-snug break-words">{i.productName}</div>
                      <div className="text-xs text-ink-faint break-all">{i.sku}</div>
                      <div className="mt-1 text-sm text-ink-soft">
                        {t('ส่งมา')}: <b className="num font-semibold text-ink">{fmtQty(exp)} {i.unit}</b>
                        {i.dispatchEntryUnit && i.dispatchEntryQty && exp === i.dispatchQty ? ` (${fmtQty(i.dispatchEntryQty)} ${i.dispatchEntryUnit})` : ''}
                        {exp !== i.dispatchQty && <span className="ml-1 text-warn font-medium">· {t('ส่วนหนึ่งถูกรายงานว่าอยู่สาขาอื่น')}</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mobile Row 3: Stepper with fixed 8px gaps, fixed 8px input padding, min-w-[96px] input, unit wrap */}
                <div className="w-full md:w-auto shrink-0 pt-1 md:pt-0">
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <div className="flex items-center gap-[8px] flex-1 sm:flex-none">
                      <Button
                        variant="outline"
                        size="sm"
                        className="!h-[48px] !w-[48px] !min-h-[48px] !min-w-[48px] shrink-0 !px-0 text-xl font-bold select-none touch-manipulation"
                        onClick={() => bump(i, -1)}
                        aria-label={t('ลด')}
                      >
                        −
                      </Button>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min={0}
                        style={{ paddingLeft: '8px', paddingRight: '8px' }}
                        className="!h-[48px] !min-w-[96px] flex-1 md:w-28 text-center text-lg font-semibold !px-[8px]"
                        value={formatDecimalInput(c.qty, c.rawQty)}
                        onChange={(e) => handleQtyChange(i.idx, e.target.value)}
                        aria-label={t('รับจริง')}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="!h-[48px] !w-[48px] !min-h-[48px] !min-w-[48px] shrink-0 !px-0 text-xl font-bold select-none touch-manipulation"
                        onClick={() => bump(i, 1)}
                        aria-label={t('เพิ่ม')}
                      >
                        +
                      </Button>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-ink-soft pl-1 text-left">{i.unit}</span>
                  </div>
                </div>
              </div>

              {/* Mobile Row 4: Validation error and Discrepancy block */}
              {isInvalid && qtyValidation.error && (
                <div className="mt-2 text-xs font-semibold text-out pl-1">
                  {t(qtyValidation.error)}
                </div>
              )}

              {variance !== 0 && (
                <div className="mt-3 grid gap-2 border-t border-line pt-3 md:grid-cols-[auto_1fr_1fr_auto] md:items-center">
                  <div className={`num text-sm font-semibold ${variance < 0 ? 'text-out' : 'text-warn'}`}>
                    {t('ผลต่าง')} {variance > 0 ? '+' : ''}
                    {fmtQty(variance)} {i.unit}
                  </div>
                  <Select value={c.reason ?? reasons[0]} onChange={(e) => set(i.idx, { reason: e.target.value as DiscrepancyReason })}>
                    {reasons.map((r) => (
                      <option key={r} value={r}>
                        {t(DISCREPANCY_REASON_KEYS[r])}
                      </option>
                    ))}
                  </Select>
                  <Textarea rows={1} value={c.note} onChange={(e) => set(i.idx, { note: e.target.value })} placeholder={t('หมายเหตุ เช่น น้ำหนักที่ชั่งได้')} />
                  <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line px-3 text-sm text-ink-soft hover:bg-sunken touch-manipulation">
                    <Icon name="camera" size={16} />
                    {c.photo ? t('มีรูปแล้ว') : t('แนบรูป')}
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void addPhoto(i.idx, e.target.files?.[0])} />
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <FormActions>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-ink-soft sm:text-sm">
            {t('ตรวจแล้ว {n}/{total}', { n: lines.length - unchecked.length, total: lines.length })}
            {diffs.length > 0 && <span className="ml-2 text-warn">· {t('มีผลต่าง {n} รายการ', { n: diffs.length })}</span>}
          </div>
          <div className="flex w-full sm:w-auto flex-wrap items-center gap-2">
            {/* On a phone the top bar's back arrow does this; the bar keeps room for the count. */}
            <Button variant="outline" className="max-sm:hidden" onClick={() => navigate(`/transfers/${transfer.id}`)} disabled={busy}>
              {t('ย้อนกลับ')}
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !allowed || lines.some((i) => !validateReceiveQty(counts[i.idx].qty).valid)} className="w-full sm:w-auto">
              <Icon name="check" size={18} />
              {busy ? t('กำลังบันทึก...') : diffs.length ? t('ยืนยันรับและส่งผลต่างให้หัวหน้า') : t('ยืนยันรับสินค้า')}
            </Button>
          </div>
        </div>
      </FormActions>

      <BarcodeScanner open={camera} onClose={() => setCamera(false)} onRead={(code) => { setCamera(false); found(code) }} title={t('สแกนบาร์โค้ดสินค้า')} />
    </FramePage>
  )
}
