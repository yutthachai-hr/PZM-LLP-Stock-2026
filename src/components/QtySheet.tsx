import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n/I18nContext'
import { fmtQty } from '../lib/format'
import type { UnitConversion } from '../lib/units'
import { isCountUnit, type QtyEntry } from '../lib/uom'
import { useEntryUnits } from '../services/entryUnits'
import { ProductThumb } from './ProductThumb'
import { entryOf, entryUnitsFor, UnitSelect } from './QtyInput'
import { blurOnWheel, Button, Modal } from './ui'

/**
 * "How many, in what unit" on a phone (spec §3, 21 Sep 2026): a sheet that rises when a
 * product is tapped, with the number set large under the thumb and the numeric keyboard
 * already up. The same list of units and the same ask-once rate prompt as the inline
 * QtyInput the tablet keeps; only the geometry is different.
 */
export function QtySheet({
  open,
  product,
  initial,
  available,
  direction,
  submitLabel,
  extra,
  onClose,
  onSubmit,
  onRateDefined,
}: {
  open: boolean
  product: { id: string; name: string; sku: string; unitType: string; hasImage: boolean; unitConversions?: UnitConversion[] } | null
  /** The line being edited, when there is one. */
  initial?: { qty: number; entryQty?: number; entryUnit?: string }
  /** On hand at the source site; issuing more than this is refused here, as the ledger would. */
  available?: number
  direction: 'in' | 'out'
  /** Already translated. */
  submitLabel: string
  /** Fields the caller adds above the buttons (Adjust: direction, reason). */
  extra?: ReactNode
  onClose: () => void
  onSubmit: (entry: QtyEntry) => void
  onRateDefined?: (conversions: UnitConversion[]) => void
}) {
  const t = useT()
  const plainUnits = useEntryUnits()
  const units = useMemo(
    () => (product ? entryUnitsFor(product.unitType, plainUnits, product.unitConversions) : []),
    [product, plainUnits],
  )
  const [entryUnit, setEntryUnit] = useState('')
  const [text, setText] = useState('')
  const box = useRef<HTMLInputElement>(null)

  // Start from the line being edited, or empty; focus the number so the keyboard is up.
  useEffect(() => {
    if (!open) return
    setEntryUnit(initial?.entryUnit ?? '')
    setText(initial ? String(initial.entryQty ?? initial.qty) : '')
    setTimeout(() => box.current?.focus(), 50)
  }, [open, initial])

  if (!product) return null
  const unit = units.find((u) => u.records.toLowerCase() === (entryUnit || product.unitType).toLowerCase()) ?? units[0]
  const factor = unit?.factor ?? 1
  const entry: QtyEntry = unit ? entryOf(text, unit, factor) : { qty: 0, entryQty: 0, factor: 1 }
  const over = available !== undefined && direction === 'out' && entry.qty > available
  const fraction = isCountUnit(product.unitType) && entry.qty > 0 && !Number.isInteger(entry.qty)
  const canSubmit = entry.qty > 0 && !over

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product.name}
      compact
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            {t('ยกเลิก')}
          </Button>
          <Button onClick={() => onSubmit(entry)} disabled={!canSubmit} className="flex-[2]">
            {submitLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3 text-xs text-ink-soft">
          <ProductThumb productId={product.id} hasImage={product.hasImage} size={36} />
          <div>
            <div className="doc-no">{product.sku}</div>
            {available !== undefined && (
              <div className={over ? 'font-medium text-danger' : ''}>
                {t('คงเหลือ')}: <span className="num">{fmtQty(available)}</span> {product.unitType}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-stretch gap-2">
          {/* The number is the thing being committed to the books, so it is the largest
              thing on the sheet — typed with a thumb, read at arm's length. */}
          <input
            ref={box}
            type="number"
            step="any"
            min={0}
            inputMode="decimal"
            value={text}
            onWheel={blurOnWheel}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) {
                e.preventDefault()
                onSubmit(entry)
              }
            }}
            className={`num min-h-14 w-full min-w-0 rounded-xl border-2 px-3 text-right text-3xl font-bold text-ink outline-none ${
              over ? 'border-danger bg-danger-soft' : 'border-brand focus-visible:ring-2 focus-visible:ring-brand/25'
            }`}
            aria-label={t('จำนวน')}
          />
          <div className="w-32 shrink-0">
            <UnitSelect
              units={units}
              value={entryUnit}
              onChange={setEntryUnit}
              product={product}
              onRateDefined={(list) => onRateDefined?.(list)}
              className="min-h-14 text-base"
            />
          </div>
        </div>
        {entry.entryUnit && entry.qty > 0 && (
          <p className="text-right text-sm text-ink-soft">
            = <span className="num font-semibold text-ink">{fmtQty(entry.qty)}</span> {product.unitType}
          </p>
        )}
        {over && <p className="text-sm font-medium text-danger">{t('เกินคงเหลือ — บันทึกไม่ได้')}</p>}
        {fraction && (
          <p className="text-sm font-medium text-warn">
            {t('จะบันทึก {qty} {unit} (ไม่เต็มหน่วย) — ตรวจสอบหน่วยอีกครั้ง', { qty: fmtQty(entry.qty), unit: product.unitType })}
          </p>
        )}
        {extra}
      </div>
    </Modal>
  )
}
