import { useMemo, useRef, useState, type DragEvent } from 'react'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { type OcrLine } from '../../lib/billOcr'
import { blockedReason, choose as chooseRow, importable, planRows, setInclude, setQty } from '../../lib/importReview'
import { routeImportFile, type ImportRoute } from '../../lib/importFile'
import { fmtQty } from '../../lib/format'
import { buildMatchIndex } from '../../lib/productMatch'
import { looseScore } from '../../lib/search'
import { suggestProducts } from '../../lib/productSuggest'
import type { SheetLine } from '../../lib/sheetLines'
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
 *
 * A file can be dropped on the window, and a list can be typed or pasted (15 Oct 2026). Both
 * go through the same review: typed text adds nothing a person has not confirmed, and any
 * instruction in it ("ยังไม่ต้องส่งผู้ขาย") is shown, never acted on.
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

/** The window itself; screens open it through LineImportModal, which loads it on demand. */
export function LineImportWindow({
  products,
  onImport,
  onClose,
  title,
  documents = true,
}: {
  products: readonly Product[]
  /** Resolve `false` when nothing was added: the window stays open with the review as it was. */
  onImport: (lines: ImportedLine[], source: string) => void | Promise<void | boolean>
  onClose: () => void
  title?: string
  /** Offer photo / PDF reading (needs the AI reader). Spreadsheets are always offered. */
  documents?: boolean
}) {
  const t = useT()
  const [step, setStep] = useState<Step>('pick')
  const [rows, setRows] = useState<Row[]>([])
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [fromText, setFromText] = useState(false)
  const [constraints, setConstraints] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  /** One file at a time: a second drop or pick while one is read is ignored. */
  const reading = useRef(false)
  const index = useMemo(() => buildMatchIndex(products as Product[], []), [products])
  const aiReady = documents && billReaderAvailable()

  // Rows decided by lib/importReview: a sure match is ticked; a guess is offered, never ticked.
  const toRows = (lines: Row['read'][]): Row[] => planRows(lines, products, index) as Row[]

  function show(lines: Row['read'][], from: string, isText: boolean, notes: string[] = []) {
    setSource(from)
    setRows(toRows(lines))
    setFromText(isText)
    setConstraints(notes)
    setStep('review')
  }

  const ROUTE_ERROR: Record<Extract<ImportRoute, { error: string }>['error'], string> = {
    busy: '',
    unsupported: t('ไฟล์นี้นำเข้าไม่ได้ ใช้ Excel (.xlsx, .xls), CSV, รูปภาพ หรือ PDF'),
    'no-reader': documents ? t('รูปและ PDF อ่านได้บนระบบจริงเท่านั้น ใช้ Excel หรือ CSV แทน') : t('หน้านี้นำเข้าได้เฉพาะ Excel หรือ CSV'),
    'too-big': t('ไฟล์ใหญ่เกินไป Excel/CSV ไม่เกิน 10 MB และ PDF ประมาณ 3 MB'),
    empty: t('ไฟล์ว่างเปล่า'),
  }

  async function takeFile(file: File | undefined) {
    if (!file) return
    const route = routeImportFile(file, { documents: aiReady, busy: reading.current })
    if ('error' in route) {
      if (route.error !== 'busy') setError(ROUTE_ERROR[route.error])
      return
    }
    reading.current = true
    setError(null)
    setStep('reading')
    try {
      if (route.kind === 'sheet') {
        const { parseSheetLines } = await import('../../lib/sheetLines')
        const parsed = parseSheetLines(await file.arrayBuffer())
        if (!parsed.lines.length) throw new Error(t('ไม่พบแถวสินค้าในไฟล์ — ต้องมีหัวคอลัมน์ชื่อสินค้า (หรือรหัส) และจำนวน'))
        show(parsed.lines, `${file.name} · ${parsed.sheet}`, false)
      } else {
        const bill = await readDocumentFile(file)
        if (!bill.lines.length) throw new Error(t('AI ({model}) ไม่พบรายการสินค้าในเอกสารนี้ — ลองรูปที่ชัดขึ้น หรือใช้ Excel', { model: bill.model ?? '?' }))
        show(bill.lines.map((line) => ({ ...line, source: 'ocr' as const })), [file.name, bill.supplier, bill.invoiceNo].filter(Boolean).join(' · '), false)
      }
    } catch (e) {
      setError(errText(e, t))
      setStep('pick')
    } finally {
      reading.current = false
    }
  }

  async function readText() {
    // Loaded on first use: most imports are files, and the reader is not needed for those.
    // Offline or after a deploy that chunk can fail to load; say so rather than do nothing.
    let readItemText: (typeof import('../../lib/itemText'))['readItemText']
    try {
      ;({ readItemText } = await import('../../lib/itemText'))
    } catch (e) {
      setError(errText(e, t))
      return
    }
    const r = readItemText(text)
    if (!r.lines.length) {
      setError(t('ไม่พบรายการสินค้าในข้อความ พิมพ์ชื่อสินค้าและจำนวน บรรทัดละรายการ หรือคั่นด้วยจุลภาค'))
      return
    }
    setError(null)
    show(r.lines, t('ข้อความที่พิมพ์'), true, r.constraints)
  }

  function drop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 1) {
      setError(t('วางได้ทีละไฟล์'))
      return
    }
    void takeFile(files[0])
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
      const added = await onImport(
        chosen.map((r) => ({
          product: r.product!,
          qty: r.qty,
          ...(r.entryUnit ? { entryUnit: r.entryUnit, entryQty: r.entryQty } : {}),
          ...(r.read.note ? { note: r.read.note } : {}),
        })),
        source,
      )
      // Nothing was added (a failed save, no supplier): keep the review so nothing is lost.
      if (added === false) {
        setError(t('ยังไม่ได้เพิ่มรายการ ตรวจข้อความแจ้งเตือนแล้วลองอีกครั้ง'))
        return
      }
      onClose()
    } catch (e) {
      setError(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open wide onClose={onClose} title={title ?? t('นำเข้ารายการสินค้า')}>
      <input
        ref={fileInput}
        type="file"
        accept={aiReady ? '.xlsx,.xls,.csv,image/*,application/pdf,.pdf' : '.xlsx,.xls,.csv'}
        className="hidden"
        data-testid="import-file"
        onChange={(e) => {
          void takeFile(e.target.files?.[0])
          // The same file can be chosen again after a failed read.
          e.target.value = ''
        }}
      />

      {step === 'pick' && (
        <div className="space-y-3">
          <div
            role="button"
            tabIndex={0}
            aria-describedby="import-drop-hint"
            data-testid="import-drop"
            className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface hover:bg-sunken'
            }`}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInput.current?.click()
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
            }}
            onDrop={drop}
          >
            <Icon name={dragging ? 'download' : 'upload'} size={26} className="text-brand" />
            <span className="text-sm font-semibold text-ink">{dragging ? t('วางไฟล์เพื่อนำเข้า') : t('ลากไฟล์มาวางที่นี่ หรือกดเพื่อเลือกไฟล์')}</span>
            <span id="import-drop-hint" className="text-xs text-ink-soft">
              {aiReady ? t('Excel, CSV, รูปภาพ หรือ PDF') : t('Excel หรือ CSV (รูปและ PDF ใช้ได้บนระบบจริงเท่านั้น)')}
              {' · '}
              {t('แถวแรก ๆ ต้องมีหัวคอลัมน์ ชื่อสินค้า (หรือรหัส) และ จำนวน')}
            </span>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="import-text" className="text-sm font-medium text-ink">
              {t('หรือพิมพ์ / วางรายการสินค้า')}
            </label>
            <textarea
              id="import-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={t('เช่น แป้งพิซซ่า 5 ถุง, มอสซาเรลล่า 3 กก. บรรทัดละรายการ หรือคั่นด้วยจุลภาค')}
              className="w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
            />
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => void readText()} disabled={!text.trim()}>
                <Icon name="check" size={16} />
                {t('อ่านรายการ')}
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-out-soft px-3 py-2 text-sm text-out">
              {error}
            </p>
          )}
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
          {constraints.length > 0 && (
            <div role="note" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              <p className="font-semibold">{t('ข้อความมีคำสั่ง: {list}', { list: constraints.join(', ') })}</p>
              <p className="text-xs">{t('ระบบไม่ส่งผู้ขาย ไม่อนุมัติ และไม่ตัดสต๊อกจากข้อความนี้ จะเพิ่มเฉพาะรายการที่คุณยืนยันเท่านั้น')}</p>
            </div>
          )}
          <ul className="space-y-2">
            {rows.map((r) => (
              <ReviewRow
                key={r.key}
                row={r}
                fromText={fromText}
                products={products}
                onPick={(p) => choose(r.key, p)}
                onInclude={(on) => setRows((cur) => cur.map((x) => (x.key === r.key ? (setInclude(x, on) as Row) : x)))}
                onQty={(q) => setRows((cur) => cur.map((x) => (x.key === r.key ? (setQty(x, q) as Row) : x)))}
              />
            ))}
          </ul>
          {error && (
            <p role="alert" className="rounded-lg bg-out-soft px-3 py-2 text-sm text-out">
              {error}
            </p>
          )}
          <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-1 pb-1 pt-3">
            <span className="mr-auto text-xs text-ink-soft">{t('จะเพิ่ม {n} จาก {total} รายการ', { n: chosen.length, total: rows.length })}</span>
            <Button
              variant="secondary"
              onClick={() => {
                setError(null)
                setStep('pick')
              }}
              disabled={busy}
            >
              {fromText ? t('แก้ข้อความ') : t('เลือกไฟล์อื่น')}
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
  fromText,
  products,
  onPick,
  onInclude,
  onQty,
}: {
  row: Row
  /** The line was typed, not read from a file. */
  fromText: boolean
  products: readonly Product[]
  onPick: (p: Product | null) => void
  onInclude: (on: boolean) => void
  onQty: (qty: number) => void
}) {
  const t = useT()
  const [searching, setSearching] = useState(false)
  /** A quantity being typed: the box stays while the person types, even once it is valid. */
  const [qtyText, setQtyText] = useState<string | null>(null)
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
          <p className="text-xs text-ink-faint">{fromText ? t('ในข้อความ') : t('ในไฟล์')}</p>
          <p className="break-words font-medium text-ink">
            {r.read.name}
            {r.read.code && r.read.code !== r.read.name && <span className="ml-1 text-xs font-normal text-ink-faint">{r.read.code}</span>}
          </p>
          <p className="num text-sm text-ink-soft">
            {Number.isFinite(r.read.qty) ? fmtQty(r.read.qty) : t('ไม่ระบุจำนวน')} {r.read.unit ?? ''}
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
              {(blocked === 'bad-qty' || qtyText !== null) && (
                <label className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${blocked === 'bad-qty' ? 'text-out' : 'text-ink-soft'}`}>
                  {fromText ? t('อ่านจำนวนไม่ได้') : t('จำนวนในไฟล์ใช้ไม่ได้')}
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    aria-label={t('ใส่จำนวน')}
                    placeholder={t('ใส่จำนวน')}
                    className="min-h-9 w-28 py-1 text-sm"
                    value={qtyText ?? ''}
                    onChange={(e) => {
                      setQtyText(e.target.value)
                      onQty(e.target.value === '' ? NaN : Number(e.target.value))
                    }}
                  />
                  <span className="text-ink-soft">{r.entryUnit ?? r.read.unit ?? r.product.unitType}</span>
                </label>
              )}
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
