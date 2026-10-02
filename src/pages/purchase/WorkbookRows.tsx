import { Badge, Button, Field, Input, Select, Spinner } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { fmtQty } from '../../lib/format'
import { rowState } from '../../services/purchaseBatch'
import { badgeColor, issueText, rowStateText } from './issues'
import { ResolveRowModal } from './ResolveRowModal'
import type { useWorkbookRows } from './useWorkbookRows'

/**
 * The pieces of an order-workbook screen, shared by the order import and the purchase-request
 * import (owner, 2 Oct 2026): the column letters for a file with no known header, the order
 * round, the row counts, and the table where each row can be settled in place.
 */
type Workbook = ReturnType<typeof useWorkbookRows>

/** Column letters, for a file whose headers the reader does not recognise. */
export function WorkbookMapping({ wb }: { wb: Workbook }) {
  const t = useT()
  const f = wb.mappingForm
  const set = wb.setMappingForm
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={t('ชื่อสินค้า')} required>
          <Input value={f.name} onChange={(e) => set({ ...f, name: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t('จำนวนสั่ง')} required>
          <Input value={f.qty} onChange={(e) => set({ ...f, qty: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t('หน่วย')}>
          <Input value={f.unit ?? ''} onChange={(e) => set({ ...f, unit: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t('หมายเหตุ / วันส่ง')}>
          <Input value={f.note ?? ''} onChange={(e) => set({ ...f, note: e.target.value.toUpperCase() })} />
        </Field>
      </div>
      <Button onClick={wb.applyMapping} disabled={!f.name.trim() || !f.qty.trim()}>
        {t('อ่านตามคอลัมน์นี้')}
      </Button>
    </div>
  )
}

/** Which order round of the file — a workbook keeps several days side by side. */
export function WorkbookRound({ wb }: { wb: Workbook }) {
  const t = useT()
  return (
    <Select value={wb.blockIdx} onChange={(e) => wb.setBlockIdx(Number(e.target.value))}>
      {wb.blocks.map((b, i) => (
        <option key={`${b.sheet}-${b.headerRow}-${b.cols.name}`} value={i}>
          {b.label}
          {wb.blocks.some((o) => o !== b && o.label === b.label) ? ` (${b.sheet})` : ''}
          {' — '}
          {t('{n} รายการสั่ง', { n: b.rows.filter((r) => r.qtyState !== 'none').length })}
        </option>
      ))}
    </Select>
  )
}

export function WorkbookCounts({ wb }: { wb: Workbook }) {
  const t = useT()
  if (!wb.rows) return null
  return (
    <span className="flex flex-wrap gap-1">
      <Badge color="green">{t('พร้อม {n}', { n: wb.counts.ready })}</Badge>
      {wb.counts.review > 0 && <Badge color="amber">{t('ต้องตรวจ {n}', { n: wb.counts.review })}</Badge>}
      {wb.counts.blocked > 0 && <Badge color="red">{t('ติดปัญหา {n}', { n: wb.counts.blocked })}</Badge>}
      {wb.counts.skipped > 0 && <Badge>{t('ข้าม {n}', { n: wb.counts.skipped })}</Badge>}
    </span>
  )
}

/**
 * Every row with what the app made of it, and a button to settle it — the same dialog the
 * batch page uses (owner, 2 Oct 2026: "ตรวจยังไง ไม่มีให้เลือกอะไรเลย"). Fixed widths, words
 * wrapped inside their own column: a long name or a long reason never pushes into the next.
 */
export function WorkbookTable({ wb }: { wb: Workbook }) {
  const t = useT()
  if (!wb.rows) return <Spinner label={t('กำลังจับคู่สินค้า…')} />
  if (wb.rows.length === 0) return <p className="text-sm text-ink-soft">{t('รอบนี้ไม่มีแถวที่ใส่จำนวนสั่ง')}</p>
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] table-fixed text-sm">
          <colgroup>
            <col className="w-12" />
            <col className="w-[20%]" />
            <col className="w-28" />
            <col className="w-[22%]" />
            <col className="w-[11%]" />
            <col />
            <col className="w-24" />
          </colgroup>
          <thead className="border-b border-line text-left text-xs text-ink-soft">
            <tr>
              <th className="py-1.5 pr-2">{t('แถว')}</th>
              <th className="py-1.5 pr-2">{t('ในไฟล์')}</th>
              <th className="py-1.5 pr-3 text-right">{t('จำนวน')}</th>
              <th className="py-1.5 pr-2">{t('สินค้าในระบบ')}</th>
              <th className="py-1.5 pr-2">{t('ผู้ขาย')}</th>
              <th className="py-1.5 pr-2">{t('สถานะ')}</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {wb.rows.map((r) => {
              const state = rowState(r)
              const near = wb.nearest(r)
              const open = state === 'review' || state === 'blocked'
              return (
                <tr key={r.idx} className={`border-b border-line align-top row-hover ${open ? 'bg-warn-soft/30' : ''}`}>
                  <td className="num py-2 pr-2 text-ink-faint">{r.excelRow}</td>
                  <td className="break-words py-2 pr-2 text-ink">{r.rawName}</td>
                  <td className="num py-2 pr-3 text-right">
                    {r.qty !== undefined ? fmtQty(r.qty) : <span className="text-warn">{r.rawQty}</span>}{' '}
                    <span className="text-ink-soft">{r.entryUnit ?? r.unit ?? r.rawUnit}</span>
                  </td>
                  <td className="break-words py-2 pr-2">
                    {r.productName ?? (
                      <span className="text-ink-faint">
                        —
                        {near && <span className="block text-xs">{t('ใกล้เคียง: {name}', { name: near.name })}</span>}
                      </span>
                    )}
                  </td>
                  <td className="break-words py-2 pr-2">{r.supplierName ?? <span className="text-ink-faint">—</span>}</td>
                  <td className="py-2 pr-2">
                    <Badge color={badgeColor(state)}>{rowStateText(state, t)}</Badge>
                    {r.issues.length > 0 && (
                      <ul className="mt-1 space-y-0.5 break-words text-xs text-ink-soft">
                        {r.issues.map((i) => (
                          <li key={i.code}>• {issueText(i, t)}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    <Button size="sm" variant={open ? 'primary' : 'ghost'} onClick={() => wb.setResolving(r)} disabled={!wb.ctx}>
                      {open ? t('ตรวจ') : t('แก้')}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {wb.resolving && wb.ctx && (
        <ResolveRowModal
          row={wb.resolving}
          suppliers={wb.suppliers}
          aliases={wb.aliases}
          onClose={() => wb.setResolving(null)}
          onSave={wb.resolved}
        />
      )}
    </>
  )
}
