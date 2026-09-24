import type { ReactNode } from 'react'
import { SectionCard, StatusChip } from '../../components/frame'
import { Button, Modal, Textarea } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { fmtQty, formatThaiDate } from '../../lib/format'
import { useT } from '../../i18n/I18nContext'
import type { DuplicateDoc } from '../../services/receiptDocs'
import { DuplicateWarning } from './DocumentCard'

/** What the review, the side panel and the success view all describe. */
export interface ReceiptFacts {
  supplierName: string
  poDocNo?: string
  warehouse: string
  date: number
  invoiceNo: string
  docDate: number
  hasPhoto: boolean
  note: string
  items: number
  matched: number
  short: number
  over: number
}

export interface Exception {
  productId: string
  productName: string
  owed: number
  qty: number
  unit: string
  reason: string
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-sm text-ink-soft">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm font-semibold text-ink">{children}</dd>
    </div>
  )
}

/**
 * The current receipt, beside the form (owner, 24 Sep 2026: this replaces "สรุปการรับวันนี้"
 * and the tips) — what will be filed if the button under it is pressed.
 */
export function ReceiptPanel({
  mode,
  facts,
  pending,
  problem,
  busy,
  onReview,
}: {
  mode: 'po' | 'manual'
  facts: Omit<ReceiptFacts, 'date' | 'docDate' | 'hasPhoto' | 'note'>
  pending: number
  problem: string | null
  busy: boolean
  onReview: () => void
}) {
  const t = useT()
  return (
    <div className="xl:sticky xl:top-4">
      <SectionCard icon="receive" title={t('ใบรับนี้')}>
        <dl className="divide-y divide-line">
          <Row label={t('ผู้ขาย')}>{facts.supplierName || '—'}</Row>
          <Row label={t('ใบสั่งซื้อ')}>{facts.poDocNo ?? (mode === 'po' ? '—' : t('ไม่มี (รับนอกใบสั่งซื้อ)'))}</Row>
          <Row label={t('คลัง')}>{mode === 'po' && !facts.poDocNo ? '—' : facts.warehouse || '—'}</Row>
          <Row label={t('จำนวนรายการ')}>{facts.items}</Row>
          {mode === 'po' && (
            <>
              <Row label={t('ครบ')}>
                <span className="text-in">{facts.matched}</span>
              </Row>
              <Row label={t('ขาด')}>
                <span className={facts.short ? 'text-warn' : ''}>{facts.short}</span>
              </Row>
              <Row label={t('เกิน')}>
                <span className={facts.over ? 'text-tile-blue' : ''}>{facts.over}</span>
              </Row>
              {pending > 0 && (
                <Row label={t('ยังไม่ใส่จำนวน')}>
                  <span className="text-danger">{pending}</span>
                </Row>
              )}
            </>
          )}
          <Row label={t('เลขที่เอกสาร')}>{facts.invoiceNo || '—'}</Row>
        </dl>
        {/* Below xl the panel sits under the form and the page's own bar carries the button. */}
        <div className="mt-4 hidden xl:block">
          <Button variant="success" onClick={onReview} disabled={busy} className="w-full">
            <Icon name="checkCircle" size={18} />
            {t('ตรวจสอบและรับสินค้า')}
          </Button>
          {problem && <p className="mt-2 text-xs text-ink-soft">{problem}</p>}
        </div>
      </SectionCard>
    </div>
  )
}

/**
 * The last look before anything moves (owner, 24 Sep 2026). Nothing is written until
 * "ยืนยันรับเข้าคลัง": this is the only button on the screen that touches stock.
 *
 * A short delivery against an order asks one more thing — whether the rest is still coming
 * (the order stays open, the default) or not (the order closes, with a reason).
 */
export function ReviewModal({
  facts,
  exceptions,
  duplicate,
  canCloseShort,
  closeShort,
  onCloseShort,
  closeReason,
  onCloseReason,
  busy,
  onBack,
  onConfirm,
}: {
  facts: ReceiptFacts
  exceptions: Exception[]
  duplicate: DuplicateDoc | null
  /** A delivery against an order that leaves something owed. */
  canCloseShort: boolean
  closeShort: boolean
  onCloseShort: (v: boolean) => void
  closeReason: string
  onCloseReason: (v: string) => void
  busy: boolean
  onBack: () => void
  onConfirm: () => void
}) {
  const t = useT()
  const blocked = busy || (canCloseShort && closeShort && !closeReason.trim())
  return (
    <Modal
      open
      onClose={busy ? () => {} : onBack}
      title={t('ตรวจสอบก่อนรับเข้าคลัง')}
      wide
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            <Icon name="chevronLeft" size={16} />
            {t('กลับไปแก้')}
          </Button>
          <Button variant="success" onClick={onConfirm} disabled={blocked}>
            <Icon name="check" size={18} />
            {busy ? t('กำลังบันทึก...') : t('ยืนยันรับเข้าคลัง')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <dl className="grid gap-x-6 rounded-xl bg-sunken px-4 py-2 sm:grid-cols-2">
          <Row label={t('ผู้ขาย')}>{facts.supplierName}</Row>
          <Row label={t('ใบสั่งซื้อ')}>{facts.poDocNo ?? t('ไม่มี (รับนอกใบสั่งซื้อ)')}</Row>
          <Row label={t('คลัง')}>{facts.warehouse}</Row>
          <Row label={t('วันที่รับ')}>{formatThaiDate(facts.date)}</Row>
          <Row label={t('เลขที่เอกสาร')}>{facts.invoiceNo}</Row>
          <Row label={t('วันที่ในเอกสาร')}>{formatThaiDate(facts.docDate)}</Row>
          <Row label={t('รูปเอกสาร')}>{facts.hasPhoto ? t('แนบแล้ว') : t('ไม่มี')}</Row>
          <Row label={t('จำนวนรายการ')}>{facts.items}</Row>
          {facts.note && <Row label={t('หมายเหตุ')}>{facts.note}</Row>}
        </dl>

        {facts.poDocNo !== undefined && (
          <div className="flex flex-wrap gap-2">
            <StatusChip tone="green">{t('ครบ {n}', { n: facts.matched })}</StatusChip>
            <StatusChip tone="amber">{t('ขาด {n}', { n: facts.short })}</StatusChip>
            <StatusChip tone="blue" icon="alertCircle">{t('เกิน {n}', { n: facts.over })}</StatusChip>
          </div>
        )}

        {duplicate && <DuplicateWarning dup={duplicate} />}

        {exceptions.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-bold text-ink">{t('รายการที่ไม่ตรงใบสั่งซื้อ')}</h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {exceptions.map((x) => (
                <li key={x.productId} className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-ink">{x.productName}</span>
                    <span className="num text-sm text-ink-soft">
                      {t('ค้าง {owed} → รับ {qty} {unit}', { owed: fmtQty(x.owed), qty: fmtQty(x.qty), unit: x.unit })}
                    </span>
                  </div>
                  <div className="text-xs text-ink-soft">{x.reason}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canCloseShort && (
          <fieldset className="space-y-2 rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-bold text-ink">{t('ส่วนที่ยังขาด')}</legend>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="short" checked={!closeShort} onChange={() => onCloseShort(false)} className="mt-1" />
              <span>
                <span className="font-semibold text-ink">{t('เก็บ PO ไว้รอส่วนที่เหลือ')}</span>
                <span className="block text-xs text-ink-soft">{t('ใบสั่งซื้อยังเปิดอยู่ รับของที่เหลือได้ในรอบถัดไป')}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="short" checked={closeShort} onChange={() => onCloseShort(true)} className="mt-1" />
              <span>
                <span className="font-semibold text-ink">{t('ปิด PO — ส่วนที่ขาดไม่มาแล้ว')}</span>
                <span className="block text-xs text-ink-soft">{t('ใบสั่งซื้อปิดพร้อมเหตุผล ยอดที่ขาดจะไม่ค้างรับอีก')}</span>
              </span>
            </label>
            {closeShort && (
              <Textarea
                rows={2}
                value={closeReason}
                onChange={(e) => onCloseReason(e.target.value)}
                placeholder={t('เหตุผลที่ปิดยอดค้าง (บังคับ) เช่น ผู้ขายแจ้งว่าของหมด')}
                className={closeReason.trim() ? '' : 'border-danger'}
                autoFocus
              />
            )}
          </fieldset>
        )}
      </div>
    </Modal>
  )
}

/** Filed. What happened, and the two things anyone does next. */
export function ReceiptDone({
  docNo,
  facts,
  exceptions,
  outstandingLines,
  queued,
  onNext,
  onView,
}: {
  docNo: string
  facts: Pick<ReceiptFacts, 'supplierName' | 'poDocNo' | 'items'>
  exceptions: number
  /** Lines still owed on the order after this delivery; undefined when there was no order. */
  outstandingLines?: number
  /** Bills from an old draft still waiting. */
  queued: number
  onNext: () => void
  onView: () => void
}) {
  const t = useT()
  return (
    <SectionCard icon="checkCircle" tone="green" title={t('รับสินค้าเข้าคลังแล้ว')}>
      <div className="space-y-4">
        <div className="rounded-xl bg-in-soft px-4 py-3">
          <div className="num text-2xl font-bold text-in">{docNo}</div>
          <div className="mt-1 text-sm text-ink">
            {facts.supplierName}
            {facts.poDocNo ? ` · ${facts.poDocNo}` : ''} · {t('{n} รายการ', { n: facts.items })}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {exceptions > 0 ? (
            <StatusChip tone="amber">{t('ไม่ตรงใบสั่งซื้อ {n} รายการ', { n: exceptions })}</StatusChip>
          ) : (
            <StatusChip tone="green">{t('ตรงตามเอกสารทุกรายการ')}</StatusChip>
          )}
          {outstandingLines !== undefined &&
            (outstandingLines > 0 ? (
              <StatusChip tone="slate" icon="clock">{t('PO ยังค้างรับ {n} รายการ', { n: outstandingLines })}</StatusChip>
            ) : (
              <StatusChip tone="green">{t('PO ปิดแล้ว')}</StatusChip>
            ))}
        </div>
        {queued > 0 && <p className="text-sm text-ink-soft">{t('ยังมีบิลร่างที่ค้างไว้อีก {n} บิล — กด "รับบิลถัดไป" เพื่อเปิด', { n: queued })}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="success" onClick={onNext} className="min-w-48" autoFocus>
            <Icon name="plus" size={18} />
            {t('รับบิลถัดไป')}
          </Button>
          <Button variant="secondary" onClick={onView}>
            <Icon name="eye" size={17} />
            {t('ดูใบรับ')}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}
