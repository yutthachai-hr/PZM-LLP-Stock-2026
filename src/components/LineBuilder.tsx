import { useEffect, useMemo, useRef, useState } from 'react'
import type { Product } from '../types'
import { ProductThumb } from './ProductThumb'
import { QtyInput } from './QtyInput'
import { useEntryUnits } from '../services/entryUnits'
import { Input } from './ui'
import { Icon } from './Icon'
import { fmtQty } from '../lib/format'
import { useT } from '../i18n/I18nContext'

export interface Line {
  productId: string
  productName: string
  /** The product's own unit. The balance this line belongs to, unless entryUnit says otherwise. */
  unit: string
  /**
   * The unit the person actually picked, when it is not the product's own.
   *
   * Carried separately so the movement can be filed under what was keyed while the line
   * still knows which product unit it started from.
   */
  entryUnit?: string
  qty: number
}

/**
 * Which way the stock is moving on this screen.
 *
 * Everything this app does is goods arriving or goods leaving, and until now the only
 * thing distinguishing the receive form from the issue form was the heading. The sign in
 * front of every quantity says it instead, in the same place on every screen, so someone
 * halfway through keying a document can tell at a glance which one they are on.
 */
export type LineDirection = 'in' | 'out'

export function LineBuilder({
  products,
  lines,
  onChange,
  availableAt,
  direction = 'in',
  focusOn = 0,
}: {
  products: Product[]
  lines: Line[]
  onChange: (lines: Line[]) => void
  /** optional: show current on-hand at source location + block over-issue */
  availableAt?: (productId: string) => number
  direction?: LineDirection
  /**
   * Bump this to put the cursor back in the search box.
   *
   * The screen above raises it after a save, because the next thing anybody does with a
   * delivery note is key the next line off it — and the form has just emptied itself, so
   * the cursor would otherwise be sitting in a box that is no longer there.
   */
  focusOn?: number
}) {
  const t = useT()
  const [search, setSearch] = useState('')
  const searchBox = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusOn > 0) searchBox.current?.focus()
  }, [focusOn])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    const chosen = new Set(lines.map((l) => l.productId))
    return products
      // A hidden product is one nobody should be filing against any more. Unhide it in
      // สินค้าคงคลัง if it turns out they should.
      .filter((p) => p.active !== false)
      .filter((p) => !chosen.has(p.id))
      .filter(
        (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [search, products, lines])

  function addProduct(p: Product) {
    onChange([...lines, { productId: p.id, productName: p.name, unit: p.unitType, qty: 1 }])
    setSearch('')
  }

  function setQty(id: string, qty: number, entryUnit: string) {
    onChange(lines.map((l) => (l.productId === id ? { ...l, qty, entryUnit } : l)))
  }

  function remove(id: string) {
    onChange(lines.filter((l) => l.productId !== id))
  }

  // Read once for the whole screen, not once per line.
  const plainUnits = useEntryUnits()

  const inbound = direction === 'in'
  const sign = inbound ? '+' : '−'
  const signColor = inbound ? 'text-in' : 'text-out'

  return (
    <div className="space-y-3">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
          <Icon name="search" size={18} />
        </span>
        <Input
          ref={searchBox}
          className="pl-10"
          placeholder={t("ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า)")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
          // Product codes and names are not prose; the browser's dictionary only gets in
          // the way and covers the field in red underlines.
          spellCheck={false}
        />
        {matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
            {matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addProduct(p)}
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm outline-none transition-colors duration-150 hover:bg-sunken focus-visible:bg-sunken"
              >
                <ProductThumb productId={p.id} hasImage={p.hasImage} size={32} />
                <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                <span className="doc-no shrink-0 text-xs text-ink-faint">{p.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-soft">
          {t("ยังไม่มีรายการ — ค้นหาด้านบนเพื่อเพิ่มสินค้า")}
        </div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {lines.map((l) => {
            const avail = availableAt?.(l.productId)
            const over = avail !== undefined && l.qty > avail
            return (
              <div
                key={l.productId}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {/* Direction, restated on every line. */}
                  <span
                    aria-hidden="true"
                    className={`num w-4 shrink-0 text-center text-lg font-bold leading-none ${signColor}`}
                  >
                    {sign}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{l.productName}</div>
                    {avail !== undefined && (
                      <div className={`text-xs ${over ? 'font-medium text-danger' : 'text-ink-soft'}`}>
                        {t('คงเหลือต้นทาง')}: <span className="num">{fmtQty(avail)}</span> {l.unit}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 pl-6 sm:pl-0">
                  <div className="w-full sm:w-44">
                    <QtyInput
                      unitType={l.unit}
                      plainUnits={plainUnits}
                      value={l.qty}
                      onChange={(v, u) => setQty(l.productId, v, u)}
                      invalid={over}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(l.productId)}
                    className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint outline-none transition-colors duration-150 hover:bg-danger-soft hover:text-danger focus-visible:ring-2 focus-visible:ring-brand/40"
                    aria-label={t('ลบ "{name}" ออกจากรายการ', { name: l.productName })}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
