import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Modal, Spinner } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { findColumns, planBarcodeImport, type BarcodePlan, type BarcodeRow } from '../../services/barcodeImport'
import { updateProduct } from '../../services/products'
import type { Product } from '../../types'

/**
 * Barcodes for the whole catalogue, from a spreadsheet (spec §3): SKU in one column, the
 * number on the box in another.
 *
 * Nothing is written until the plan has been read: the owner's rule for every import in
 * this app is that the screen which will change data is the screen that first says what it
 * will change. xlsx is loaded on demand — most days nobody opens this.
 */
const ISSUE_TEXT: Record<string, string> = {
  unknownSku: 'ไม่พบ SKU นี้ในแคตตาล็อก', // i18n-key
  duplicateInFile: 'บาร์โค้ดซ้ำกับอีกแถวในไฟล์', // i18n-key
  takenByOther: 'บาร์โค้ดนี้ใช้กับสินค้าอื่นอยู่แล้ว', // i18n-key
  blank: 'กรอกไม่ครบ (ต้องมีทั้ง SKU และบาร์โค้ด)', // i18n-key
}

export function BarcodeImportModal({ products, onClose, onDone }: { products: Product[]; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const toast = useToast()
  const [plan, setPlan] = useState<BarcodePlan | null>(null)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function pick(file: File) {
    setReading(true)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const grid = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, raw: false, defval: '' })
      const headerRow = grid.findIndex((r) => findColumns((r ?? []).map(String)).sku >= 0)
      if (headerRow < 0) throw new Error(t('ไม่พบคอลัมน์ SKU ในไฟล์'))
      const cols = findColumns(grid[headerRow].map(String))
      if (cols.barcode < 0) throw new Error(t('ไม่พบคอลัมน์ Barcode ในไฟล์'))
      const rows: BarcodeRow[] = grid
        .slice(headerRow + 1)
        .map((r) => ({ sku: String(r?.[cols.sku] ?? ''), barcode: String(r?.[cols.barcode] ?? '') }))
      setPlan(planBarcodeImport(rows, products))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setReading(false)
    }
  }

  async function apply() {
    if (!plan) return
    setSaving(true)
    try {
      for (const c of plan.changes) await updateProduct(c.product.id, { barcode: c.barcode })
      toast.success(t('บันทึกบาร์โค้ด {n} รายการแล้ว', { n: plan.changes.length }))
      onDone()
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t('นำเข้าบาร์โค้ดจาก Excel')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('ปิด')}
          </Button>
          <Button onClick={() => void apply()} disabled={!plan || plan.changes.length === 0 || saving}>
            {saving ? t('กำลังบันทึก...') : t('บันทึก {n} รายการ', { n: plan?.changes.length ?? 0 })}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">
          {t('ไฟล์ต้องมีคอลัมน์ SKU (หรือ "รหัสสินค้า") และ Barcode (หรือ "บาร์โค้ด") — SKU ยังเป็นกุญแจหลัก ไม่มีการสร้างสินค้าใหม่')}
        </p>
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong p-4 text-center text-sm text-ink-soft hover:border-brand/50">
          <Icon name="upload" size={22} />
          {t('เลือกไฟล์ Excel (.xlsx)')}
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pick(f)
              e.target.value = ''
            }}
          />
        </label>

        {reading && <Spinner label={t('กำลังอ่านไฟล์...')} />}

        {plan && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Figure tone="text-in" value={plan.changes.length} label={t('จะบันทึก')} />
              <Figure tone="text-ink-soft" value={plan.unchanged} label={t('ตรงอยู่แล้ว')} />
              <Figure tone="text-danger" value={plan.problems.length} label={t('มีปัญหา')} />
            </div>

            {plan.changes.length > 0 && (
              <div className="max-h-52 overflow-y-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-sunken text-left text-xs text-ink-soft">
                    <tr>
                      <th className="px-3 py-2">{t('สินค้า')}</th>
                      <th className="px-3 py-2">{t('บาร์โค้ดใหม่')}</th>
                      <th className="px-3 py-2">{t('เดิม')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {plan.changes.slice(0, 200).map((c) => (
                      <tr key={c.product.id}>
                        <td className="px-3 py-1.5">
                          <span className="block truncate text-ink">{c.product.name}</span>
                          <span className="doc-no text-xs text-ink-faint">{c.product.sku}</span>
                        </td>
                        <td className="doc-no px-3 py-1.5">{c.barcode}</td>
                        <td className="doc-no px-3 py-1.5 text-ink-faint">{c.was ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {plan.problems.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-danger/30 bg-danger-soft/50 p-3 text-xs text-danger">
                {plan.problems.slice(0, 100).map((x, i) => (
                  <li key={i}>
                    <span className="doc-no">{x.row.sku || '—'}</span> · <span className="doc-no">{x.row.barcode || '—'}</span> —{' '}
                    {t(ISSUE_TEXT[x.issue])}
                    {x.detail ? ` (${x.detail})` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Figure({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className={`num text-xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  )
}
