import { useT } from '../i18n/I18nContext'
import { fmtQty } from '../lib/format'
import { resolveFactor } from '../lib/inventoryRules/uom'
import { sameUnit, type UnitConversion } from '../lib/units'
import { Icon } from './Icon'
import { Button, Input, Select } from './ui'

/** Units a rate may be stated in even when the owner's list has none of them: weight and volume. */
const MEASURES = ['KG', 'g', 'L', 'ml']

/**
 * The product's unit rates, one equation per row: `[per] [unit ▾] = [size] [of ▾]`.
 *
 * Reads the way the owner says it — "1 Carton = 12 Pack", "1 Pack = 25 EA", "2.72 KG =
 * 1 EA", "10 EA = 1 KG" — and stores each as a row of `Product.unitConversions`. The right-
 * hand unit may be the product's own or another row's, so the five units chain; the
 * summary under the rows says what each one comes to in the product's own unit, which is
 * what every screen files. Rules of the shape live in lib/units.ts `normaliseConversions`
 * and lib/inventoryRules/uom.ts `resolveFactor`.
 */
export function ConversionRows({
  baseUnit,
  rows,
  onChange,
  unitChoices,
  disabled = false,
}: {
  baseUnit: string
  rows: UnitConversion[]
  onChange: (rows: UnitConversion[]) => void
  /** The owner's unit list; the standard measures are added here. */
  unitChoices: readonly string[]
  disabled?: boolean
}) {
  const t = useT()
  const base = baseUnit.trim()
  const product = { unitType: base, unitConversions: rows }

  const labelOptions = (current: string) => {
    const taken = rows.map((r) => r.label).filter((l) => !sameUnit(l, current))
    const out = [...unitChoices, ...MEASURES].filter((u, i, all) => all.findIndex((x) => sameUnit(x, u)) === i)
    const list = out.filter((u) => !sameUnit(u, base) && !taken.some((x) => sameUnit(x, u)))
    if (current && !list.some((u) => sameUnit(u, current))) list.unshift(current)
    return list
  }
  const ofOptions = (current: UnitConversion) => [base, ...rows.map((r) => r.label).filter((l) => l && !sameUnit(l, current.label))]

  const set = (i: number, patch: Partial<UnitConversion>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r))
    onChange(next)
  }

  return (
    <div>
      <div className="space-y-2">
        {rows.map((c, i) => {
          const factor = c.label ? resolveFactor(product, c.label) : null
          return (
            <div key={i}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-20 shrink-0">
                  <Input
                    type="number"
                    step="any"
                    min={0}
                    value={c.per ?? 1}
                    onChange={(e) => set(i, { per: Number(e.target.value) })}
                    disabled={disabled}
                    className="num text-right"
                    aria-label={t('จำนวนของหน่วยที่ตั้ง')}
                  />
                </div>
                <div className="min-w-0 flex-1 basis-28">
                  <Select value={c.label} onChange={(e) => set(i, { label: e.target.value })} disabled={disabled} aria-label={t('หน่วย')}>
                    <option value="">{t('— เลือกหน่วย —')}</option>
                    {labelOptions(c.label).map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </div>
                <span className="shrink-0 text-sm text-ink-faint">=</span>
                <div className="w-24 shrink-0">
                  <Input
                    type="number"
                    step="any"
                    min={0}
                    value={c.size || ''}
                    onChange={(e) => set(i, { size: Number(e.target.value) })}
                    disabled={disabled}
                    className="num text-right"
                    aria-label={t('อัตราแปลง')}
                  />
                </div>
                <div className="min-w-0 flex-1 basis-28">
                  <Select
                    value={c.of && !sameUnit(c.of, base) ? c.of : base}
                    onChange={(e) => set(i, { of: sameUnit(e.target.value, base) ? undefined : e.target.value })}
                    disabled={disabled}
                    aria-label={t('เทียบกับหน่วย')}
                  >
                    {ofOptions(c).map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </div>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    className="shrink-0 rounded p-2 text-ink-faint hover:bg-danger-soft hover:text-danger"
                    aria-label={t('ลบแถวนี้')}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
              {/* What the row comes to in the product's own unit — the number the ledger uses. */}
              {c.label && (
                <p className={`mt-0.5 pl-1 text-xs ${factor === null ? 'text-danger' : 'text-ink-faint'}`}>
                  {factor === null
                    ? t('อัตรานี้ยังคำนวณไม่ได้ — หน่วยที่อ้างอิงยังไม่มีอัตรา')
                    : `1 ${c.label} = ${fmtQty(factor)} ${base}${factor < 1 && factor > 0 ? ` · 1 ${base} = ${fmtQty(Math.round((1 / factor) * 1000) / 1000)} ${c.label}` : ''}`}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {!disabled && (
        <Button variant="ghost" className="mt-2" onClick={() => onChange([...rows, { label: '', size: 0 }])}>
          <Icon name="plus" size={16} />
          {t('เพิ่มอัตราแปลง')}
        </Button>
      )}
    </div>
  )
}
