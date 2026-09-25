import { useEffect, useMemo, useRef, useState } from 'react'
import { useViewport } from '../lib/viewport'
import { upsertLine } from '../lib/lines'
import { QtySheet } from './QtySheet'
import type { Product } from '../types'
import { ProductThumb } from './ProductThumb'
import { QtyInput } from './QtyInput'
import { useEntryUnits } from '../services/entryUnits'
import { Input } from './ui'
import { Icon } from './Icon'
import { fmtQty } from '../lib/format'
import { useT } from '../i18n/I18nContext'
import { looseMatch, looseScore } from '../lib/search'
import { findByBarcode, pickOnEnter, searchFields } from '../lib/barcode'
import { BarcodeScanner } from './BarcodeScanner'
import { describeQty, type QtyEntry } from '../lib/uom'

export interface Line {
  productId: string
  productName: string
  /** The product's own unit. The balance this line belongs to, unless entryUnit says otherwise. */
  unit: string
  /**
   * The unit the person actually picked, when it is not the product's own, and how many
   * of it. `qty` is always the product's own unit — converted at the product's rate
   * (lib/uom.ts) — so the balance check and the ledger read one number.
   */
  entryUnit?: string
  entryQty?: number
  qty: number
  /** This line's own note — filed on its movement instead of the document's. */
  note?: string
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

/**
 * How many matches the box lists. Eight was too few: with several sizes of one product the
 * one wanted was often ninth (owner, 20 Sep 2026). The box scrolls.
 */
const MAX_MATCHES = 40

export function LineBuilder({
  products,
  lines,
  onChange,
  availableAt,
  direction = 'in',
  focusOn = 0,
  onHandAt,
  lineNotes = false,
}: {
  products: Product[]
  lines: Line[]
  onChange: (lines: Line[]) => void
  /** optional: show current on-hand at source location + block over-issue */
  availableAt?: (productId: string) => number
  /** Show a balance beside each line without blocking on it — where the goods are going. */
  onHandAt?: (productId: string) => number
  /** A note box on every line (owner's mock-up 03), from 2xl up where the table has room. */
  lineNotes?: boolean
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
  const [scanning, setScanning] = useState(false)
  const searchBox = useRef<HTMLInputElement>(null)
  // A phone keys through a sheet (spec §3, 21 Sep 2026): tapping a product opens it for
  // that product, adding or editing its line. Tablets and desktops keep the inline rows.
  const phone = useViewport() === 'phone'
  const [sheetFor, setSheetFor] = useState<Product | null>(null)

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
      .filter((p) => phone || !chosen.has(p.id))
      .filter((p) => looseMatch(searchFields(p), q))
      .sort((a, b) => looseScore([b.name, b.sku], q) - looseScore([a.name, a.sku], q))
      .slice(0, MAX_MATCHES)
  }, [search, products, lines, phone])

  function addProduct(p: Product) {
    if (phone) {
      setSearch('')
      setSheetFor(p)
      return
    }
    // Scanned again: the line is already there (the list hides chosen products, a scan does not).
    if (!lines.some((l) => l.productId === p.id)) {
      onChange([...lines, { productId: p.id, productName: p.name, unit: p.unitType, qty: 1 }])
    }
    setSearch('')
    // Straight on to the next line: the cursor stays in the search box after every add.
    setTimeout(() => searchBox.current?.focus(), 0)
  }

  /** A scan is a decision, not a suggestion: the line goes on as soon as it reads. */
  function scanned(code: string) {
    setScanning(false)
    const hit = findByBarcode(products, code)
    if (!hit) {
      setSearch(code)
      return
    }
    addProduct(hit)
  }

  function sheetSubmit(e: QtyEntry) {
    if (!sheetFor) return
    onChange(upsertLine(lines, sheetFor, e))
    setSheetFor(null)
    setTimeout(() => searchBox.current?.focus(), 0)
  }

  function setQty(id: string, e: QtyEntry) {
    onChange(
      lines.map((l) =>
        l.productId === id
          ? { ...l, qty: e.qty, ...(e.entryUnit ? { entryUnit: e.entryUnit, entryQty: e.entryQty } : { entryUnit: undefined, entryQty: undefined }) }
          : l,
      ),
    )
  }

  function setNote(id: string, note: string) {
    onChange(lines.map((l) => (l.productId === id ? { ...l, note: note || undefined } : l)))
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
          placeholder={t("ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า / บาร์โค้ด)")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            // A scanner in keyboard mode types the code and presses Enter: an exact barcode
            // (or product code) is what it meant, before any loose match.
            if (e.key !== 'Enter') return
            const hit = pickOnEnter(products, search, matches)
            if (hit) {
              e.preventDefault()
              addProduct(hit)
            }
          }}
          autoComplete="off"
          // Product codes and names are not prose; the browser's dictionary only gets in
          // the way and covers the field in red underlines.
          spellCheck={false}
        />
        {/* A scan puts the line on directly (spec §3). */}
        <button
          type="button"
          onClick={() => setScanning(true)}
          aria-label={t('สแกนบาร์โค้ด')}
          title={t('สแกนบาร์โค้ด')}
          className="absolute right-1.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-ink-soft hover:bg-sunken hover:text-ink"
        >
          <Icon name="barcode" size={20} />
        </button>
        {matches.length > 0 && (
          <div className="mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-surface shadow-lg md:absolute md:z-20">
            {matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addProduct(p)}
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm outline-none transition-colors duration-150 hover:bg-sunken focus-visible:bg-sunken"
              >
                <ProductThumb productId={p.id} hasImage={p.hasImage} size={32} zoom={false} />
                <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                <span className="doc-no shrink-0 text-xs text-ink-faint">{p.sku}</span>
                {availableAt && (
                  <span className="num shrink-0 text-xs text-ink-soft">
                    {fmtQty(availableAt(p.id))} {p.unitType}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-soft">
          {t("ยังไม่มีรายการ — ค้นหาด้านบนเพื่อเพิ่มสินค้า")}
        </div>
      ) : phone ? (
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {lines.map((l) => {
            const avail = availableAt?.(l.productId)
            const over = avail !== undefined && l.qty > avail
            const product = products.find((p) => p.id === l.productId)
              return (
                <button
                  key={l.productId}
                  type="button"
                  onClick={() => setSheetFor(product ?? null)}
                  className="flex w-full items-center gap-3 p-3 text-left outline-none active:bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <span aria-hidden="true" className={`num w-4 shrink-0 text-center text-lg font-bold leading-none ${signColor}`}>
                    {sign}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{l.productName}</div>
                    <div className={`text-xs ${over ? 'font-medium text-danger' : 'text-ink-soft'}`}>
                      {avail !== undefined ? (
                        <>
                          {t('คงเหลือต้นทาง')}: <span className="num">{fmtQty(avail)}</span> {l.unit}
                        </>
                      ) : (
                        <span className="doc-no">{product?.sku}</span>
                      )}
                    </div>
                  </div>
                  <div className="num shrink-0 text-right text-base font-semibold text-ink">{describeQty(l, fmtQty)}</div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(l.productId)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        remove(l.productId)
                      }
                    }}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-faint active:bg-danger-soft active:text-danger"
                    aria-label={t('ลบ "{name}" ออกจากรายการ', { name: l.productName })}
                  >
                    <Icon name="x" size={18} />
                  </span>
                </button>
              )
          })}
        </div>
      ) : (
        /* Tablet and up: the lines as a table (owner's mock-up 03) — number, product, SKU,
           quantity with its unit, what is on hand, a note, and remove. */
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] table-fixed text-sm">
            <thead className="bg-sunken text-left text-[13px] text-ink-soft">
              <tr>
                <th className="w-14 px-2 py-2.5 text-center font-semibold">{t('ลำดับ')}</th>
                <th className="px-3 py-2.5 font-semibold">{t('สินค้า')}</th>
                <th className="hidden w-36 px-3 py-2.5 font-semibold 2xl:table-cell">SKU</th>
                <th className="w-56 px-3 py-2.5 font-semibold xl:w-[17rem]">{t('จำนวน / หน่วย')}</th>
                {(availableAt || onHandAt) && (
                  <th className="w-24 px-3 py-2.5 text-right font-semibold xl:w-28">{availableAt ? t('คงเหลือต้นทาง') : t('สต๊อกคงเหลือ')}</th>
                )}
                {lineNotes && <th className="hidden w-44 px-3 py-2.5 font-semibold 2xl:table-cell">{t('หมายเหตุ')}</th>}
                <th className="w-14 px-1 py-2.5 text-center font-semibold">
                  <span className="sr-only">{t('ลบ')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((l, i) => {
                const avail = availableAt?.(l.productId)
                const shown = avail ?? onHandAt?.(l.productId)
                const over = avail !== undefined && l.qty > avail
                const product = products.find((p) => p.id === l.productId)
                return (
                  <tr key={l.productId} className={over ? 'bg-danger-soft/40' : ''}>
                    <td className="num whitespace-nowrap px-3 py-2 text-center text-ink-soft">
                      {/* Direction, restated on every line. */}
                      <span aria-hidden="true" className={`mr-1 font-bold ${signColor}`}>{sign}</span>
                      {i + 1}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {product && <ProductThumb productId={product.id} hasImage={product.hasImage} size={36} />}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink" title={l.productName}>{l.productName}</div>
                          <div className="doc-no truncate text-xs text-ink-faint 2xl:hidden">{product?.sku}</div>
                          {l.entryUnit && l.entryQty !== undefined && (
                            <div className="text-xs text-ink-faint">{describeQty(l, fmtQty)}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="doc-no hidden truncate px-3 py-2 text-ink-soft 2xl:table-cell">{product?.sku}</td>
                    <td className="px-3 py-2">
                      <QtyInput
                        unitType={l.unit}
                        plainUnits={plainUnits}
                        conversions={product?.unitConversions}
                        value={l.qty}
                        onChange={(e) => setQty(l.productId, e)}
                        product={product}
                        invalid={over}
                      />
                    </td>
                    {shown !== undefined && (
                      <td className={`num whitespace-nowrap px-3 py-2 text-right ${over ? 'font-semibold text-danger' : 'text-ink-soft'}`}>
                        {fmtQty(shown)} <span className="text-xs">{l.unit}</span>
                      </td>
                    )}
                    {lineNotes && (
                      <td className="hidden px-3 py-2 2xl:table-cell">
                        <Input
                          value={l.note ?? ''}
                          onChange={(e) => setNote(l.productId, e.target.value)}
                          placeholder={t('ระบุหมายเหตุ')}
                          aria-label={t('หมายเหตุของ "{name}"', { name: l.productName })}
                          maxLength={200}
                        />
                      </td>
                    )}
                    <td className="px-1 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => remove(l.productId)}
                        className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-danger/80 outline-none transition-colors duration-150 hover:bg-danger-soft hover:text-danger focus-visible:ring-2 focus-visible:ring-brand/40"
                        aria-label={t('ลบ "{name}" ออกจากรายการ', { name: l.productName })}
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onRead={scanned} />
      <QtySheet
        open={!!sheetFor}
        product={sheetFor}
        initial={sheetFor ? lines.find((l) => l.productId === sheetFor.id) : undefined}
        available={sheetFor && availableAt ? availableAt(sheetFor.id) : undefined}
        direction={direction}
        submitLabel={sheetFor && lines.some((l) => l.productId === sheetFor.id) ? t('บันทึก') : t('เพิ่มรายการ')}
        onClose={() => setSheetFor(null)}
        onSubmit={sheetSubmit}
      />
    </div>
  )
}
