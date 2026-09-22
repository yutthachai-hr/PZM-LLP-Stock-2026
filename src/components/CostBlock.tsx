import { useMemo, useState } from 'react'
import { useT } from '../i18n/I18nContext'
import { fmtMoney, formatThaiDateShort, msToDateInput, todayMs } from '../lib/format'
import { resolveFactor } from '../lib/uom'
import type { UnitConversion } from '../lib/units'
import type { CostEntry } from '../types'
import { Button, Field, Input, Select } from './ui'

/** What the cost block hands back: a price as keyed, ready for services/productCost.ts. */
export interface PriceDraft {
  price: number
  unit: string
  effectiveAt: number
  note?: string
}

/**
 * A product's price, stated the way the invoice states it (owner, 22 Sep 2026).
 *
 * The person keys the number on the paper and says what it is for — a carton, a piece,
 * a kilo — and reads, before saving, what that comes to per one of the product's own
 * unit; the day it applies from defaults to today, because a supplier's new price is
 * usually keyed the day the invoice arrives. Under it, every price ever stated, so a
 * rise can be seen and dated.
 *
 * The block does not save by itself: on an existing product the dialog saves each price
 * at once (`onSave`), on a new product the price rides along with the creation.
 */
export function CostBlock({
  product,
  history,
  disabled,
  onSave,
  onDraft,
}: {
  product: { name: string; unitType: string; unitConversions?: UnitConversion[] }
  history: readonly CostEntry[]
  disabled?: boolean
  /** Save the price now (existing product). Omit on a new product. */
  onSave?: (d: PriceDraft) => Promise<void>
  /** The price as keyed, for a dialog that saves it later (new product). */
  onDraft?: (d: PriceDraft | null) => void
}) {
  const t = useT()
  const [price, setPrice] = useState('')
  const [unit, setUnit] = useState('')
  const [date, setDate] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const units = useMemo(() => [product.unitType, ...(product.unitConversions ?? []).map((c) => c.label)], [product])
  const factor = unit ? resolveFactor(product, unit) : 1
  const n = Number(price)
  const perUnit = Number.isFinite(n) && n >= 0 && factor ? Math.round((n / factor) * 10000) / 10000 : null
  const current = [...history].sort((a, b) => b.effectiveAt - a.effectiveAt || b.at - a.at)
  const latest = current[0]
  const shown = showAll ? current : current.slice(0, 5)

  function draft(): PriceDraft | null {
    if (!(Number.isFinite(n) && n >= 0) || price.trim() === '') return null
    const effectiveAt = new Date(date + 'T00:00:00').getTime()
    if (!Number.isFinite(effectiveAt)) return null
    return { price: n, unit, effectiveAt, ...(note.trim() ? { note: note.trim() } : {}) }
  }

  function change(next: { price?: string; unit?: string; date?: string; note?: string }) {
    if (next.price !== undefined) setPrice(next.price)
    if (next.unit !== undefined) setUnit(next.unit)
    if (next.date !== undefined) setDate(next.date)
    if (next.note !== undefined) setNote(next.note)
    if (onDraft) {
      // Recompute from the values about to be set, not the stale state.
      const p = next.price ?? price
      const u = next.unit ?? unit
      const d = next.date ?? date
      const nn = Number(p)
      const f = u ? resolveFactor(product, u) : 1
      const eff = new Date(d + 'T00:00:00').getTime()
      onDraft(p.trim() !== '' && Number.isFinite(nn) && nn >= 0 && f && Number.isFinite(eff) ? { price: nn, unit: u, effectiveAt: eff, ...(next.note ?? note ? { note: (next.note ?? note).trim() } : {}) } : null)
    }
  }

  async function save() {
    const d = draft()
    if (!d || !onSave) return
    setBusy(true)
    try {
      await onSave(d)
      setPrice('')
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-sunken/50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{t('ต้นทุน')}</span>
        {latest ? (
          <span className="text-sm text-ink-soft">
            {t('ตอนนี้')} <span className="num font-semibold text-ink">฿{fmtMoney(latest.cost)}</span> / {product.unitType} {/* i18n-key */}
            <span className="text-ink-faint"> · {t('ตั้งแต่ {date}', { date: formatThaiDateShort(latest.effectiveAt) })}</span>
          </span>
        ) : (
          <span className="text-xs text-ink-faint">{t('ยังไม่มีราคา')}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label={t('ราคา (บาท)')}>
          <Input type="number" step="any" min={0} inputMode="decimal" value={price} onChange={(e) => change({ price: e.target.value })} disabled={disabled || busy} placeholder="0.00" />
        </Field>
        <Field label={t('ต่อ 1')}>
          <Select value={unit} onChange={(e) => change({ unit: e.target.value })} disabled={disabled || busy}>
            {units.map((u, i) => (
              <option key={u} value={i === 0 ? '' : u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('มีผลตั้งแต่')}>
          <Input type="date" value={date} onChange={(e) => change({ date: e.target.value })} disabled={disabled || busy} />
        </Field>
        <Field label={t('หมายเหตุ')}>
          <Input value={note} onChange={(e) => change({ note: e.target.value })} disabled={disabled || busy} placeholder={t('เลขบิล / ผู้ขาย')} />
        </Field>
      </div>
      {/* What the books will use — said before saving, so a carton price cannot pass for a piece price. */}
      {perUnit !== null && price.trim() !== '' && (
        <p className="text-sm text-ink">
          = <span className="num font-semibold">฿{fmtMoney(perUnit)}</span> {t('ต่อ 1 {unit}', { unit: product.unitType })} {/* i18n-key */}
          {unit && factor && factor !== 1 && <span className="text-ink-faint"> ({t('1 {unit} = {n} {base}', { unit, n: factor, base: product.unitType })})</span>}
        </p>
      )}
      {unit && !factor && <p className="text-sm text-danger">{t('หน่วยนี้ยังไม่มีอัตราแปลง — กำหนดในอัตราแปลงหน่วยด้านล่างก่อน')}</p>}
      {onSave && (
        <Button variant="secondary" onClick={() => void save()} disabled={disabled || busy || !draft()}>
          {busy ? t('กำลังบันทึก...') : t('บันทึกราคาใหม่')}
        </Button>
      )}
      {current.length > 0 && (
        <div className="text-xs">
          <div className="mb-1 text-ink-faint">{t('ประวัติราคา')}</div>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {shown.map((h, i) => (
              <li key={`${h.at}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
                <span className="num w-20 shrink-0 text-ink-soft">{formatThaiDateShort(h.effectiveAt)}</span>
                <span className="num text-ink">
                  ฿{fmtMoney(h.price)} / {h.unit} {/* ฿ is a currency symbol — i18n-key */}
                </span>
                {h.factor !== 1 && (
                  <span className="num text-ink-soft">
                    = ฿{fmtMoney(h.cost)} / {product.unitType} {/* i18n-key */}
                  </span>
                )}
                <span className="ml-auto text-ink-faint">
                  {h.byName}
                  {h.note ? ` · ${h.note}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {current.length > shown.length && (
            <button type="button" onClick={() => setShowAll(true)} className="mt-1 text-brand">
              {t('ดูทั้งหมด ({n})', { n: current.length })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
