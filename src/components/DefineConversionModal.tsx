import { useState } from 'react'
import { errText } from '../i18n/AppError'
import { useT } from '../i18n/I18nContext'
import type { UnitConversion } from '../lib/units'
import { addConversion } from '../services/products'
import { useToast } from './Toast'
import { Button, Modal } from './ui'
import { blurOnWheel } from './ui'

/**
 * "1 Pack = ___ EA" — asked the first time somebody keys a unit this product has no rate
 * for, answered once, saved on the product (owner, 20 Sep 2026). From then on the unit
 * converts without asking; the rate is corrected on the product page if it was wrong.
 */
export function DefineConversionModal({
  product,
  label,
  onClose,
  onSaved,
}: {
  product: { id: string; name: string; unitType: string; unitConversions?: UnitConversion[] }
  label: string
  onClose: () => void
  onSaved: (conversions: UnitConversion[], size: number) => void
}) {
  const t = useT()
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const size = Number(text)
  const ok = Number.isFinite(size) && size > 0

  async function save() {
    if (!ok) return
    setBusy(true)
    try {
      const list = await addConversion(product, label, size)
      toast.success(t('บันทึกอัตราแล้ว: 1 {unit} = {size} {base}', { unit: label, size, base: product.unitType }))
      onSaved(list, size)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('กำหนดอัตราแปลงหน่วย')}>
      <p className="text-sm text-ink-soft">
        {t('สินค้า "{name}" ยังไม่มีอัตราสำหรับหน่วย "{unit}" ระบุครั้งเดียว ระบบจะจำไว้ที่สินค้านี้ และแก้ได้ที่หน้าสินค้า', { name: product.name, unit: label })}
      </p>
      <div className="mt-4 flex items-center gap-2 text-base text-ink">
        <span className="num font-semibold">1 {label}</span>
        <span>=</span>
        <input
          type="number"
          step="any"
          min={0}
          inputMode="decimal"
          autoFocus
          value={text}
          onWheel={blurOnWheel}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ok && !busy) void save()
          }}
          className="num min-h-11 w-32 rounded-lg border border-line-strong px-3 py-2 text-right text-base font-semibold text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          aria-label={t('อัตราแปลง')}
        />
        <span className="font-semibold">{product.unitType}</span>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('ยกเลิก')}
        </Button>
        <Button onClick={() => void save()} disabled={busy || !ok}>
          {busy ? t('กำลังบันทึก...') : t('บันทึกอัตรา')}
        </Button>
      </div>
    </Modal>
  )
}
