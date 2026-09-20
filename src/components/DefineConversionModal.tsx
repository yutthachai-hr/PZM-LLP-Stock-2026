import { useMemo, useState } from 'react'
import { errText } from '../i18n/AppError'
import { useT } from '../i18n/I18nContext'
import { fmtQty } from '../lib/format'
import { resolveFactor } from '../lib/inventoryRules/uom'
import { sameUnit, type UnitConversion } from '../lib/units'
import { addConversion } from '../services/products'
import { useToast } from './Toast'
import { Button, Modal, Select } from './ui'
import { blurOnWheel } from './ui'

/**
 * "1 Pack = ___ EA" — asked the first time somebody keys a unit this product has no rate
 * for, answered once, saved on the product (owner, 20 Sep 2026). From then on the unit
 * converts without asking; the rate is corrected on the product page if it was wrong.
 *
 * The right-hand unit may be the product's own or one of its other rated units, so a
 * Carton can be stated in Pack. The "สลับ" switch turns the equation round for the case
 * people say the other way — "1 EA = 2.72 KG" — and stores it as 2.72 KG = 1 EA.
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
  onSaved: (conversions: UnitConversion[], factor: number) => void
}) {
  const t = useT()
  const toast = useToast()
  const [text, setText] = useState('')
  const [of, setOf] = useState(product.unitType)
  const [reverse, setReverse] = useState(false)
  const [busy, setBusy] = useState(false)
  const n = Number(text)
  const ok = Number.isFinite(n) && n > 0

  // The units the rate may be stated against: the product's own, and every other unit it
  // already has a rate for (so "1 Carton = 12 Pack" is possible once Pack is known).
  const ofOptions = useMemo(
    () => [product.unitType, ...(product.unitConversions ?? []).map((c) => c.label).filter((l) => !sameUnit(l, label) && resolveFactor(product, l) !== null)],
    [product, label],
  )
  const ofFactor = resolveFactor(product, of) ?? 1
  // What one `label` comes to in the product's own unit, as the person has it set up now.
  const preview = ok ? (reverse ? ofFactor / n : n * ofFactor) : null

  async function save() {
    if (!ok) return
    setBusy(true)
    try {
      const opts = { ...(reverse ? { per: n, size: 1 } : { size: n }), ...(sameUnit(of, product.unitType) ? {} : { of }) }
      const list = await addConversion(product, label, opts.size, { per: 'per' in opts ? opts.per : undefined, of: opts.of })
      const factor = resolveFactor({ unitType: product.unitType, unitConversions: list }, label) ?? 1
      toast.success(t('บันทึกอัตราแล้ว: 1 {unit} = {size} {base}', { unit: label, size: fmtQty(factor), base: product.unitType }))
      onSaved(list, factor)
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const numberBox = (
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
      className="num min-h-11 w-28 rounded-lg border border-line-strong px-3 py-2 text-right text-base font-semibold text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
      aria-label={t('อัตราแปลง')}
    />
  )
  const ofBox =
    ofOptions.length > 1 ? (
      <Select value={of} onChange={(e) => setOf(e.target.value)} className="w-28">
        {ofOptions.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </Select>
    ) : (
      <span className="font-semibold">{of}</span>
    )

  return (
    <Modal open onClose={onClose} title={t('กำหนดอัตราแปลงหน่วย')}>
      <p className="text-sm text-ink-soft">
        {t('สินค้า "{name}" ยังไม่มีอัตราสำหรับหน่วย "{unit}" ระบุครั้งเดียว ระบบจะจำไว้ที่สินค้านี้ และแก้ได้ที่หน้าสินค้า', { name: product.name, unit: label })}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-base text-ink">
        {reverse ? (
          <>
            <span className="num font-semibold">1</span>
            {ofBox}
            <span>=</span>
            {numberBox}
            <span className="font-semibold">{label}</span>
          </>
        ) : (
          <>
            <span className="num font-semibold">1 {label}</span>
            <span>=</span>
            {numberBox}
            {ofBox}
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
        <button type="button" onClick={() => setReverse((r) => !r)} className="text-brand hover:underline">
          {reverse ? t('สลับเป็น "1 {unit} = ?"', { unit: label }) : t('สลับเป็น "1 {base} = ? {unit}"', { base: of, unit: label })}
        </button>
        {preview !== null && (
          <span>
            = 1 {label} = <span className="num font-semibold text-ink">{fmtQty(preview)}</span> {product.unitType}
          </span>
        )}
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
