import { useMemo, useRef, useState } from 'react'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { matchOcrLines, type OcrLine } from '../../lib/billOcr'
import { fmtQty } from '../../lib/format'
import { buildMatchIndex } from '../../lib/productMatch'
import { looseScore } from '../../lib/search'
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
}

type Step = 'pick' | 'reading' | 'review'

function matchOne(read: Row['read'], index: ReturnType<typeof buildMatchIndex>) {
  const tries = read.code ? [read.code, read.name] : [read.name]
  for (const name of tries) {
    const m = matchOcrLines({ lines: [{ name, qty: read.qty, unit: read.unit }] }, index).matched[0]
    if (m) return m
  }
  return undefined
}

/** Convert a line read for a chosen product, by matching on that product alone. */
function convertFor(read: Row['read'], product: Product) {
  const m = matchOcrLines({ lines: [{ name: product.name, qty: read.qty, unit: read.unit }] }, buildMatchIndex([product], [])).matched[0]
  return m ? { qty: m.qty, entryUnit: m.entryUnit, entryQty: m.entryQty, unitUnknown: m.unitUnknown } : { qty: read.qty }
}

export function LineImportModal({
  products,
  onImport,
  onClose,
  title,
  documents = true,
}: {
  products: readonly Product[]
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
  const sheetInput = useRef<HTMLInputElement>(null)
  const docInput = useRef<HTMLInputElement>(null)
  const index = useMemo(() => buildMatchIndex(products as Product[], []), [products])
  const aiReady = documents && billReaderAvailable()

  function toRows(lines: Row['read'][]): Row[] {
    return lines.map((read, key) => {
      const m = matchOne(read, index)
      return m
        ? { key, read, product: m.product, qty: m.qty, entryUnit: m.entryUnit, entryQty: m.entryQty, unitUnknown: m.unitUnknown, include: !m.unitUnknown }
        : { key, read, product: null, qty: read.qty, include: false }
    })
  }

  async function pickSheet(file: File | undefined) {
    if (!file) return
    setError(null)
    setStep('reading')
    try {
      const parsed = parseSheetLines(await file.arrayBuffer())
      if (!parsed.lines.length) throw new Error(t('ไม่พบแถวสินค้าในไฟล์ — ต้องมีหัวคอลัมน์ชื่อสินค้า (หรือรหัส) และจำนวน'))
      setSource(`${file.name} · ${parsed.sheet}`)
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
      setRows(toRows(bill.lines))
      setStep('review')
    } catch (e) {
      setError(errText(e, t))
      setStep('pick')
    }
  }

  function choose(key: number, product: Product | null) {
    setRows((cur) =>
      cur.map((r) => {
        if (r.key !== key) return r
        if (!product) return { ...r, product: null, include: false }
        const c = convertFor(r.read, product)
        return { ...r, product, qty: c.qty, entryUnit: c.entryUnit, entryQty: c.entryQty, unitUnknown: c.unitUnknown, include: true }
      }),
    )
  }

  const chosen = rows.filter((r) => r.include && r.product)

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
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            <span className="font-medium text-ink">{source}</span>
            <Badge color="green">{t('ตรงแน่นอน {n}', { n: rows.filter((r) => r.product && !r.unitUnknown).length })}</Badge>
            <Badge color="amber">{t('ต้องเลือก {n}', { n: rows.filter((r) => !r.product).length })}</Badge>
          </div>
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-sunken text-left text-xs text-ink-soft">
                <tr>
                  <th className="w-10 px-2 py-2" />
                  <th className="px-2 py-2 font-semibold">{t('ในไฟล์')}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t('จำนวน')}</th>
                  <th className="px-2 py-2 font-semibold">{t('สินค้าในระบบ')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.key} className={r.include ? '' : 'opacity-70'}>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand"
                        checked={r.include}
                        disabled={!r.product}
                        onChange={(e) => setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, include: e.target.checked } : x)))}
                        aria-label={t('เพิ่มแถวนี้')}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <span className="text-ink">{r.read.name}</span>
                      {r.read.code && r.read.code !== r.read.name && <span className="ml-1 text-xs text-ink-faint">{r.read.code}</span>}
                    </td>
                    <td className="num px-2 py-2 text-right">
                      {fmtQty(r.read.qty)} <span className="text-ink-faint">{r.read.unit ?? ''}</span>
                    </td>
                    <td className="px-2 py-2">
                      <ProductPick products={products} value={r.product} onChange={(p) => choose(r.key, p)} />
                      {r.product && (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {r.entryUnit
                            ? t('{q} {u} = {base} {unit}', { q: fmtQty(r.entryQty ?? 0), u: r.entryUnit, base: fmtQty(r.qty), unit: r.product.unitType })
                            : `${fmtQty(r.qty)} ${r.product.unitType}`}
                          {r.unitUnknown && <span className="ml-1 text-warn">{t('· หน่วย {u} ไม่รู้จัก — ใช้เป็นหน่วยหลัก ตรวจก่อนเพิ่ม', { u: r.unitUnknown })}</span>}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="rounded-lg bg-out-soft px-3 py-2 text-sm text-out">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
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

/** A small product search: type, pick one of the closest names. */
function ProductPick({ products, value, onChange }: { products: readonly Product[]; value: Product | null; onChange: (p: Product | null) => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const hits = useMemo(() => {
    const needle = q.trim()
    if (!needle) return []
    return products
      .map((p) => ({ p, s: looseScore([p.name, p.sku, p.barcode], needle) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.p)
  }, [products, q])

  if (value && !open) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="font-medium text-ink">{value.name}</span>
        <button className="text-xs text-brand hover:underline" onClick={() => setOpen(true)}>
          {t('เปลี่ยน')}
        </button>
      </span>
    )
  }
  return (
    <div className="relative">
      <Input
        value={q}
        autoFocus={open}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('ค้นหาสินค้าเพื่อจับคู่')}
        className="min-h-9 py-1 text-sm"
      />
      {hits.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-surface shadow-md">
          {hits.map((p) => (
            <li key={p.id}>
              <button
                className="block w-full px-3 py-2 text-left text-sm hover:bg-sunken"
                onClick={() => {
                  onChange(p)
                  setQ('')
                  setOpen(false)
                }}
              >
                {p.name} <span className="text-xs text-ink-faint">{p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
