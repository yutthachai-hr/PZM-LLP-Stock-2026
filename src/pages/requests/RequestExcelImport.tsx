import { useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Badge, Button, Card, Field, SectionHeader } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { rowState } from '../../services/purchaseBatch'
import type { LineInput } from '../../services/purchaseRequests'
import { useWorkbookRows } from '../purchase/useWorkbookRows'
import { WorkbookCounts, WorkbookMapping, WorkbookRound, WorkbookTable } from '../purchase/WorkbookRows'

/** The answers given here, per file and order round, kept on the device until they are used. */
const LS_EDITS = 'pmstock:pr-import:edits:'

/**
 * The order workbook read into a purchase request (owner, 2 Oct 2026: "เพิ่มช่อง import excel
 * ในหน้ารายการขอสั่งซื้อ"). Unlike the order import, nothing becomes an order here: the lines
 * join the request, and the request still goes to a หัวหน้า for approval like any other.
 *
 * The same reading, matching and in-place settling as the order import. Every row has to be
 * ready or explicitly skipped before anything is added — a row is never quietly left out.
 */
export function RequestExcelImport({
  onAdd,
  onClose,
}: {
  /** Add the lines to the request; true when they went in. */
  onAdd: (lines: LineInput[], source: string) => Promise<boolean>
  onClose: () => void
}) {
  const t = useT()
  const wb = useWorkbookRows(LS_EDITS)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const ready = (wb.rows ?? []).filter((r) => rowState(r) === 'ready')
  const waiting = wb.counts.review + wb.counts.blocked

  async function add() {
    if (!wb.block || ready.length === 0 || waiting > 0) return
    setBusy(true)
    try {
      const lines: LineInput[] = ready.map((r) => ({
        productId: r.productId!,
        supplierId: r.supplierId!,
        qty: r.qty!,
        ...(r.entryUnit ? { entryUnit: r.entryUnit } : {}),
        ...(r.note ? { note: r.note } : {}),
      }))
      if (await onAdd(lines, `${wb.fileName} · ${wb.block.label}`)) {
        wb.clearEdits()
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <SectionHeader
        icon="upload"
        title={t('นำเข้าจาก Excel')}
        description={t('ไฟล์รายการสั่งของแบบเดียวกับหน้าสั่งซื้อ — รายการจะเข้าใบขอนี้ แล้วยังต้องให้หัวหน้าอนุมัติตามปกติ')}
        badge={wb.fileName ? <Badge color="green">{wb.fileName}</Badge> : undefined}
      />
      {wb.error ? <p className="mb-3 text-sm text-danger">{errText(wb.error, t)}</p> : null}
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void wb.pickFile(file)
        }}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Button onClick={() => fileRef.current?.click()} disabled={busy || wb.reading || wb.loading}>
          <Icon name="upload" size={16} />
          {wb.fileName ? t('เลือกไฟล์อื่น') : t('เลือกไฟล์ Excel')}
        </Button>
        {wb.blocks.length > 0 && (
          <Field label={t('รอบสั่งในไฟล์')} className="min-w-64 flex-1">
            <WorkbookRound wb={wb} />
          </Field>
        )}
        {wb.loading && <span className="text-xs text-ink-soft">{t('กำลังโหลดข้อมูลผู้ขาย…')}</span>}
      </div>

      {wb.fileLoaded && wb.needsMapping && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <p className="mb-2 text-sm font-semibold text-ink">{t('ไม่พบหัวตารางที่รู้จัก — ระบุคอลัมน์เอง')}</p>
          <WorkbookMapping wb={wb} />
        </div>
      )}

      {wb.block && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-soft">
              {t('กด "ตรวจ" ที่แถวสีเหลืองเพื่อเลือกสินค้า ผู้ขาย จำนวน หรือหน่วยได้ที่นี่เลย — ชื่อที่ยืนยันแล้วระบบจำไว้ ครั้งหน้าไม่ถามซ้ำ ระบบไม่เดาให้เอง')}
            </p>
            <WorkbookCounts wb={wb} />
          </div>
          <WorkbookTable wb={wb} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {waiting > 0 && (
          <span className="text-xs text-warn">
            {t('ตรวจให้ครบก่อน (เหลือ {n}) — รายการที่ไม่สั่ง กด "ตรวจ" แล้ว "ข้ามรายการนี้"', { n: waiting })}
          </span>
        )}
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ปิด')}
        </Button>
        <Button onClick={() => void add()} disabled={busy || !wb.block || ready.length === 0 || waiting > 0}>
          <Icon name="plus" size={16} />
          {busy ? t('กำลังบันทึก...') : t('เพิ่มลงใบขอ ({n} รายการ)', { n: ready.length })}
        </Button>
      </div>
    </Card>
  )
}
