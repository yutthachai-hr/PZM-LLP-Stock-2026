import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { SectionCard } from '../../components/frame'
import { AlertBanner, Button, Field, Input, Select, bannerAction } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { ThaiDateField } from '../../components/ThaiDateField'
import { formatThaiDate } from '../../lib/format'
import { useT } from '../../i18n/I18nContext'
import type { DuplicateDoc } from '../../services/receiptDocs'
import type { Supplier } from '../../types'

/** The "someone else" choice in the supplier list — a name typed by hand. Never stored. */
export const OTHER_SUPPLIER = '__other'

/** "This bill from SIAMFOOD was already received as RC-00012", and a way to look at it. */
export function DuplicateWarning({ dup }: { dup: DuplicateDoc }) {
  const t = useT()
  const to = dup.docNo ? `/movements?doc=${encodeURIComponent(dup.docNo)}` : null
  return (
    <AlertBanner
      tone="warn"
      icon="warning"
      action={
        to ? (
          <Link to={to} target="_blank" rel="noopener" className={bannerAction}>
            {t('ดูใบรับเดิม')}
            <Icon name="arrowRight" size={15} />
          </Link>
        ) : undefined
      }
    >
      {t('เลขเอกสารนี้ของ {supplier} รับเข้าไปแล้วใน {docNo}', { supplier: dup.supplierName ?? '', docNo: dup.docNo ?? '' })}
      {dup.date ? ` (${formatThaiDate(dup.date)})` : ''}
      {dup.poDocNo ? ` · ${dup.poDocNo}` : ''}
      <span className="mt-0.5 block text-xs font-normal">{t('ตรวจให้แน่ใจว่าไม่ใช่บิลเดิมก่อนรับเข้า — ยังรับต่อได้ถ้าเป็นบิลใหม่จริง')}</span>
    </AlertBanner>
  )
}

/**
 * The supplier's paperwork, one field each (owner, 24 Sep 2026: never one free-text box).
 *
 * From an order the supplier is the order's and cannot change. By hand it is picked from
 * the supplier list, or typed when it is somebody not on it. The document date starts as the
 * receiving date; it only needs touching when the paper is dated differently.
 */
export function DocumentCard({
  locked,
  suppliers,
  supplierId,
  supplierName,
  onSupplier,
  invoiceNo,
  onInvoice,
  onInvoiceBlur,
  docDateStr,
  onDocDate,
  photo,
  onPhoto,
  note,
  onNote,
  duplicate,
  invalid,
}: {
  /** The order's supplier, when receiving against one. */
  locked?: string
  suppliers: Supplier[]
  supplierId: string
  supplierName: string
  onSupplier: (id: string, name: string) => void
  invoiceNo: string
  onInvoice: (v: string) => void
  onInvoiceBlur: () => void
  docDateStr: string
  onDocDate: (v: string) => void
  photo: string | null
  onPhoto: (file: File | null) => void
  note: string
  onNote: (v: string) => void
  duplicate: DuplicateDoc | null
  invalid: { supplier: boolean; invoice: boolean }
}) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const other = supplierId === OTHER_SUPPLIER
  const active = suppliers.filter((s) => s.active !== false).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <SectionCard icon="note" title={t('เอกสารจากผู้ขาย')}>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          <Field label={t('ผู้ขาย (Supplier)')} required>
            {locked !== undefined ? (
              <Input value={locked} disabled />
            ) : (
              <div className="space-y-2">
                <Select
                  value={supplierId}
                  onChange={(e) => {
                    const v = e.target.value
                    onSupplier(v, v === OTHER_SUPPLIER ? '' : (suppliers.find((s) => s.id === v)?.name ?? ''))
                  }}
                  className={invalid.supplier ? 'border-danger' : ''}
                >
                  <option value="">{t('— เลือกผู้ขาย —')}</option>
                  {active.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value={OTHER_SUPPLIER}>{t('อื่น ๆ (พิมพ์ชื่อเอง)')}</option>
                </Select>
                {other && (
                  <Input
                    value={supplierName}
                    onChange={(e) => onSupplier(OTHER_SUPPLIER, e.target.value)}
                    placeholder={t('ชื่อผู้ขาย / ร้านที่ซื้อ')}
                    autoFocus
                  />
                )}
              </div>
            )}
          </Field>
          <Field label={t('เลขที่เอกสาร / ใบกำกับ')} required>
            <Input
              value={invoiceNo}
              onChange={(e) => onInvoice(e.target.value)}
              onBlur={onInvoiceBlur}
              placeholder={t('เช่น IV2616876')}
              className={invalid.invoice ? 'border-danger' : ''}
              autoComplete="off"
            />
          </Field>
        </div>

        {duplicate && <DuplicateWarning dup={duplicate} />}

        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          <Field label={t('วันที่ในเอกสาร')}>
            <ThaiDateField value={docDateStr} onChange={onDocDate} ariaLabel={t('วันที่ในเอกสาร')} />
          </Field>
          <Field label={t('แนบรูปเอกสาร')}>
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  onPhoto(e.target.files?.[0] ?? null)
                  e.target.value = ''
                }}
              />
              {photo ? (
                <img src={photo} alt={t('รูปเอกสาร')} className="h-11 w-11 rounded-lg border border-line object-cover" />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-dashed border-line-strong text-ink-faint">
                  <Icon name="camera" size={17} />
                </span>
              )}
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                <Icon name="camera" size={16} />
                {photo ? t('เปลี่ยนรูป') : t('ถ่าย / เลือกรูป')}
              </Button>
              {photo && (
                <button type="button" onClick={() => onPhoto(null)} className="cursor-pointer text-xs text-danger hover:underline">
                  {t('ลบรูป')}
                </button>
              )}
            </div>
          </Field>
        </div>

        <Field label={t('หมายเหตุ')}>
          <Input value={note} onChange={(e) => onNote(e.target.value)} placeholder={t('ระบุหมายเหตุ (ถ้ามี)')} />
        </Field>
      </div>
    </SectionCard>
  )
}
