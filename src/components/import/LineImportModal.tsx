import { useMemo, useRef, useState } from 'react'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { type OcrLine } from '../../lib/billOcr'
import { blockedReason, choose as chooseRow, importable, planRows, setInclude } from '../../lib/importReview'
import { fmtQty } from '../../lib/format'
import { buildMatchIndex } from '../../lib/productMatch'
import { looseScore } from '../../lib/search'
import { suggestProducts } from '../../lib/productSuggest'
import { parseSheetLines, type SheetLine } from '../../lib/sheetLines'
import { billReaderAvailable, readDocumentFile } from '../../services/billOcr'
import type { Product } from '../../types'
import { Icon } from '../Icon'
import { Badge, Button, Input, Modal } from '../ui'

/**
 * Bring product lines in from a file (6 Oct 2026): a spreadsheet, or a photo / PDF read by
 * AI. One component for every screen that keys product lines — issue, transfer, receive,
 * purchase requests, orders, adjustments, monthly counts — so they all read files the same
 * way and nothing is filed without a person looking at the matches first.
 *
 * Only a sure match is pre-ticked (SKU, alias, one exact name — lib/billOcr); anything else
 * waits for someone to pick the product. Quantities arrive in the product's own unit, or in
 * one of its other units when the file names it.
 */

export interface ImportedLine {
  product: Product
  /** In the product's own unit. */
  qty: number
  entryUnit?: string
  entryQty?: number
  note?: string
}

interface Row {
  key: number
  read: SheetLine | (OcrLine & { row?: number; code?: string; note?: string })
  product: Product | null
  qty: number
  entryUnit?: string
  entryQty?: number
  unitUnknown?: string
  include: boolean
  /** sure: SKU/alias/exact name; guess: the one clear suggestion; picked: chosen by hand. */
  how: 'sure' | 'guess' | 'picked' | null
  /** The closest products, for one-tap picking. */
  suggestions: Product[]
}

type Step = 'pick' | 'reading' | 'review'

export function LineImportModal({
  products,
  onImport,
  onClose,
  title,
  documents = true,
}: {
  products: readonly Product[]
  /** `kind`: a spreadsheet read as-is, or a photo / PDF read by OCR (D4′ intake). */
  onImport: (lines: ImportedLine[], source: string, kind: 'excel' | 'ocr') => void | Promise<void | boolean>
  onClose: () => void
  title?: string
  /** Offer photo / PDF reading (needs the AI reader). Spreadsheets are always offered. */
  documents?: boolean
}) {
  const t = useT()
  const [step, setStep] = useState<Step>('pick')
  const [rows, setRows] = useState<Row[]>([])
  const [source, setSource] = useState('')
  const [kind, setKind] = useState<'excel' | 'ocr'>('excel')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sheetInput = useRef<HTMLInputElement>(null)
  const docInput = useRef<HTMLInputElement>(null)
  const index = useMemo(() => buildMatchIndex(products as Product[], []), [products])
  const aiReady = documents && billReaderAvailable()

  // Rows decided by lib/importReview: a sure match is ticked; a guess is offered, never ticked.
  const toRows = (lines: Row['read'][]): Row[] => planRows(lines, products, index) as Row[]

  async function pickSheet(file: File | undefined) {
    if (!file) return
    setError(null)
    setStep('reading')
    try {
      const parsed = parseSheetLines(await file.arrayBuffer())
      if (!parsed.lines.length) throw new Error(t('ไม่พบแถวสินค้าในไฟล์ — ต้องมีหัวคอลัมน์ชื่อสินค้า (หรือรหัส) และจำนวน'))
      setSource(`${file.name} · ${parsed.sheet}`)
      setKind('excel')
      setRows(toRows(parsed.lines))
      setStep('review')
    } catch (e) {
      setError(errText(e, t))
      setStep('pick')
    }
  }

  async function pickDocument(file: File | undefined) {
    if (!file) return
    setError(null)
    setStep('reading')
    try {
      const bill = await readDocumentFile(file)
      if (!bill.lines.length) throw new Error(t('AI ({model}) ไม่พบรายการสินค้าในเอกสารนี้ — ลองรูปที่ชัดขึ้น หรือใช้ Excel', { model: bill.model ?? '?' }))
      setSource([file.name, bill.supplier, bill.invoiceNo].filter(Boolean).join(' · '))
      setKind('ocr')
      setRows(toRows(bill.lines))
      setStep('review')
    } catch (e) {
      setError(errText(e, t))
      setStep('pick')
    }
  }

  function choose(key: number, product: Product | null) {
    setRows((cur) => cur.map((r) => (r.key === key ? (chooseRow(r, product) as Row) : r)))
  }

  // Only ticked, confirmed, unblocked rows leave (never a bare guess).
  const chosen = importable(rows) as Row[]

  async function confirm() {
    if (!chosen.length) return
    setBusy(true)
    try {
      await onImport(
        chosen.map((r) => ({
          product: r.product!,
          qty: r.qty,
          ...(r.entryUnit ? { entryUnit: r.entryUnit, entryQty: r.entryQty } : {}),
          ...(r.read.note ? { note: r.read.note } : {}),
        })),
        source,
        kind,
      )
      onClose()
    } catch (e) {
      setError(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open wide onClose={onClose} title={title ?? t('นำเข้ารายการสินค้า')}>
      <input ref={sheetInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => void pickSheet(e.target.files?.[0])} />
      <input ref={docInput} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={(e) => void pickDocument(e.target.files?.[0])} />

      {step === 'pick' && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-surface p-4 text-center hover:bg-sunken"
              onClick={() => sheetInput.current?.click()}
            >
              <Icon name="fileSheet" size={26} className="text-in" />
              <span className="text-sm font-semibold text-ink">{t('Excel / CSV')}</span>
              <span className="text-xs text-ink-soft">{t('แถวแรก ๆ ต้องมีหัวคอลัมน์ ชื่อสินค้า (หรือรหัส) และ จำนวน')}</span>
            </button>
            <button
              className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-surface p-4 text-center hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => docInput.current?.click()}
              disabled={!aiReady}
            >
              <Icon name="camera" size={26} className="text-brand" />
              <span className="text-sm font-semibold text-ink">{t('รูป / PDF (AI อ่าน)')}</span>
              <span className="text-xs text-ink-soft">
                {aiReady ? t('บิล ใบสั่งของ ใบนับสต๊อก ใบโอน — ถ่ายรูปหรือเลือกไฟล์') : t('ใช้ได้บนระบบจริงเท่านั้น')}
              </span>
            </button>
          </div>
          {error && <p className="rounded-lg bg-out-soft px-3 py-2 text-sm text-out">{error}</p>}
          <p className="text-xs text-ink-faint">{t('ระบบจับคู่สินค้าให้ แล้วให้คุณตรวจก่อนเพิ่ม — ไม่มีอะไรถูกบันทึกจนกว่าจะกดยืนยันในหน้านั้น')}</p>
        </div>
      )}

      {step === 'reading' && (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-ink-soft">
          <Icon name="refresh" size={16} className="animate-spin" />
          {t('กำลังอ่านไฟล์...')}
        </p>
      )}

      {step === 'review' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="mr-auto truncate font-medium text-ink">{source}</span>
            <Badge color="green">{t('ตรงแน่นอน {n}', { n: rows.filter((r) => r.how === 'sure').length })}</Badge>
            <Badge color="blue">{t('ระบบเดา {n}', { n: rows.filter((r) => r.how === 'guess').length })}</Badge>
            <Badge color="amber">{t('ต้องเลือก {n}', { n: rows.filter((r) => !r.product).length })}</Badge>
          </div>
          <ul className="space-y-2">
            {rows.map((r) => (
              <ReviewRow
                key={r.key}
                row={r}
                products={products}
                onPick={(p) => choose(r.key, p)}
                onInclude={(on) => setRows((cur) => cur.map((x) => (x.key === r.key ? (setInclude(x, on) as Row) : x)))}
              />
            ))}
          </ul>
          {error && <p className="rounded-lg bg-out-soft px-3 py-2 text-sm text-out">{error}</p>}
          <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-1 pb-1 pt-3">
            <span className="mr-auto text-xs text-ink-soft">{t('จะเพิ่ม {n} จาก {total} รายการ', { n: chosen.length, total: rows.length })}</span>
            <Button variant="secondary" onClick={() => setStep('pick')} disabled={busy}>
              {t('เลือกไฟล์อื่น')}
            </Button>
            <Button onClick={() => void confirm()} disabled={busy || !chosen.length}>
              <Icon name="check" size={16} />
              {t('เพิ่ม {n} รายการ', { n: chosen.length })}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

const HOW_UI: Record<'sure' | 'guess' | 'picked' | 'none', { label: string; tone: string }> = {
  sure: { label: 'ตรงแน่นอน', tone: 'bg-in-soft text-in' }, // i18n-key
  guess: { label: 'ระบบเดา — ตรวจด้วย', tone: 'bg-brand-soft text-brand' }, // i18n-key
  picked: { label: 'เลือกเอง', tone: 'bg-in-soft text-in' }, // i18n-key
  none: { label: 'ต้องเลือกสินค้า', tone: 'bg-warn-soft text-warn' }, // i18n-key
}

/**
 * One line from the file as a card: what was read on the left, the product it becomes on
 * the right — or one-tap choices of the closest products, and a search that lists its
 * results inside the card (nothing floats over the next row).
 */
function ReviewRow({
  row: r,
  products,
  onPick,
  onInclude,
}: {
  row: Row
  products: readonly Product[]
  onPick: (p: Product | null) => void
  onInclude: (on: boolean) => void
}) {
  const t = useT()
  const [searching, setSearching] = useState(false)
  const ui = HOW_UI[r.how ?? 'none']
  const blocked = blockedReason(r)
  const awaiting = r.how === 'guess' && !r.include
  const skipped = !!r.product && !r.include && !awaiting && blocked === null
  const others = r.suggestions.filter((s) => s.id !== r.product?.id)
  return (
    <li className={`rounded-xl border p-3 ${skipped ? 'border-line bg-sunken' : r.product ? 'border-line bg-surface' : 'border-warn/40 bg-warn-soft/40'}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed"
          checked={r.include}
          disabled={blocked !== null}
          onChange={(e) => onInclude(e.target.checked)}
          aria-label={t('เพิ่มแถวนี้')}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-faint">{t('ในไฟล์')}</p>
          <p className="break-words font-medium text-ink">
            {r.read.name}
            {r.read.code && r.read.code !== r.read.name && <span className="ml-1 text-xs font-normal text-ink-faint">{r.read.code}</span>}
          </p>
          <p className="num text-sm text-ink-soft">
            {fmtQty(r.read.qty)} {r.read.unit ?? ''}
          </p>
        </div>
        <Icon name="arrowRight" size={16} className="mt-5 hidden shrink-0 text-ink-faint sm:block" />
        <div className="min-w-0 basis-full sm:basis-[55%]">
          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${skipped ? 'bg-line text-ink-soft' : ui.tone}`}>
            {skipped ? t('ไม่เพิ่ม') : t(ui.label)}
          </span>
          {r.product ? (
            <div className="mt-1">
              <p className="break-words font-semibold text-ink">{r.product.name}</p>
              <p className="text-xs text-ink-soft">
                {r.entryUnit
                  ? t('{q} {u} = {base} {unit}', { q: fmtQty(r.entryQty ?? 0), u: r.entryUnit, base: fmtQty(r.qty), unit: r.product.unitType })
                  : `${fmtQty(r.qty)} ${r.product.unitType}`}
                <span className="ml-1 text-ink-faint">{r.product.sku}</span>
              </p>
              {blocked === 'product-has-no-unit' && <p className="mt-0.5 text-xs text-out">{t('สินค้านี้ยังไม่มีหน่วย — ให้ผู้ดูแลกำหนดหน่วยที่หน้าสินค้าก่อน จึงจะนำเข้าได้')}</p>}
              {blocked === 'unit-unknown' && <p className="mt-0.5 text-xs text-out">{t('หน่วย {u} ยังไม่มีอัตราแปลงของสินค้านี้ — กำหนดอัตราที่หน้าสินค้าก่อน แล้วนำเข้าใหม่', { u: r.unitUnknown ?? '' })}</p>}
              {blocked === 'bad-qty' && <p className="mt-0.5 text-xs text-out">{t('จำนวนในไฟล์ใช้ไม่ได้')}</p>}
              {awaiting && blocked === null && (
                <button type="button" className="mt-1 mr-3 rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90" onClick={() => onInclude(true)}>
                  {t('ยืนยันว่าเป็นสินค้านี้')}
                </button>
              )}
              {!searching && (
                <button type="button" className="mt-1 text-xs font-medium text-brand hover:underline" onClick={() => setSearching(true)}>
                  {t('เปลี่ยนสินค้า')}
                </button>
              )}
            </div>
          ) : (
            others.length > 0 && <p className="mt-1 text-xs text-ink-soft">{t('ใกล้เคียง — กดเลือก:')}</p>
          )}
          {(!r.product || searching) && others.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {others.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onPick(s)
                    setSearching(false)
                  }}
                  className="max-w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-left text-xs text-ink hover:border-brand hover:bg-brand-soft"
                >
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block text-[10px] text-ink-faint">{s.sku}</span>
                </button>
              ))}
            </div>
          )}
          {(!r.product || searching) && (
            <ProductSearch
              products={products}
              onPick={(p) => {
                onPick(p)
                setSearching(false)
              }}
              onCancel={r.product ? () => setSearching(false) : undefined}
            />
          )}
        </div>
      </div>
    </li>
  )
}

/** Search the catalogue; results are listed inside the row, never floating over the next. */
function ProductSearch({ products, onPick, onCancel }: { products: readonly Product[]; onPick: (p: Product) => void; onCancel?: () => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const hits = useMemo(() => {
    const needle = q.trim()
    if (needle.length < 2) return []
    const byWords = suggestProducts(needle, products, 6).map((x) => x.product)
    const loose = products
      .filter((p) => p.active !== false)
      .map((p) => ({ p, s: looseScore([p.name, p.sku, p.barcode], needle) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p)
    return [...new Map([...byWords, ...loose].map((p) => [p.id, p])).values()].slice(0, 6)
  }, [products, q])
  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ค้นหาสินค้าในระบบ (ชื่อ / รหัส)')} className="min-h-10 flex-1 py-1.5 text-sm" />
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('ยกเลิก')}
          </Button>
        )}
      </div>
      {q.trim().length >= 2 && (
        <ul className="mt-1 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-faint">{t('ไม่พบสินค้า')}</li>
          ) : (
            hits.map((p) => (
              <li key={p.id}>
                <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-sunken" onClick={() => onPick(p)}>
                  <span className="font-medium text-ink">{p.name}</span> <span className="text-xs text-ink-faint">{p.sku}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
