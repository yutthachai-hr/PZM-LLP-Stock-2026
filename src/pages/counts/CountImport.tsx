import { useMemo, useState } from 'react'
import { useDraft } from '../../lib/useDraft'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { useToast } from '../../components/Toast'
import { AlertBanner, Button, Field, Modal, Select } from '../../components/ui'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { answeredQty, guessHeader, importColumns, importRows, type ImportRow } from '../../lib/countImport'
import { fmtQty } from '../../lib/format'
import { resolveFactor } from '../../lib/inventoryRules/uom'
import { monthOf } from '../../lib/monthlyCount'
import { buildMatchIndex, matchProduct } from '../../lib/productMatch'
import { parseStockWorkbook, type ParsedSheet } from '../../lib/stockSheet'
import { sameUnit } from '../../lib/units'
import { addConversion } from '../../services/products'
import type { MonthlyCountQuestion, Product } from '../../types'

type Mode = 'perFile' | 'filePerOne'
/**
 * The answer for a line in another unit: the count itself in the product's own unit (the
 * default), or a rate from the file's unit. The owner typed his count into what used to be
 * the only box, a rate, twice on 30 Sep 2026 — so the count is what is asked first.
 */
interface Rate {
  how: 'count' | 'rate'
  /** The count in the product's own unit, as typed. */
  count: string
  value: string
  mode: Mode
  remember: boolean
}
type Decision =
  | ({ kind: 'rate' } & Rate)
  | ({ kind: 'map'; productId: string } & Rate)
  | { kind: 'question'; note: string }
  | { kind: 'exclude' }

export type ImportedQuestion = Omit<MonthlyCountQuestion, 'by' | 'byName' | 'at'>

/**
 * Fill a monthly count sheet from the company's closing-stock workbook (owner, 29 Sep 2026).
 *
 * One column of the file — one location on one counting date — goes into the sheet's
 * figures as counts to check, never as stock moved. The owner's rule: nothing in the file
 * is passed over. A line in the product's own unit goes in as it is; every other line waits
 * for a decision — a rate, the product it really is, a question kept on the sheet for later
 * ("what is this?"), or an explicit "leave it out". A sheet with an open question cannot be
 * confirmed. A rate can be kept on the product so next month's file does not ask again.
 */
export function CountImport({
  open,
  draftKey,
  onClose,
  locationName,
  month,
  products,
  existing,
  onApply,
}: {
  open: boolean
  /** The count sheet this import fills: its answers are kept on this device under it. */
  draftKey: string
  onClose: () => void
  locationName: string
  month: string
  products: Product[]
  /** Figures already on the sheet or in its draft, to say what an import would replace. */
  existing: Record<string, number>
  onApply: (result: { counts: Record<string, number>; questions: Record<string, ImportedQuestion> }) => Promise<void> | void
}) {
  const t = useT()
  const toast = useToast()
  const { brand } = useBrand()
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [fileName, setFileName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [colKey, setColKey] = useState('')
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [dupPick, setDupPick] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  // Everything answered so far, kept on this device as it is typed (owner, 30 Sep 2026: "ทำไม
  // ไม่มี Draft" — the dialog closed three times under him and took every answer with it). The
  // file itself is kept as read, so coming back needs no file picked again.
  const { restored, clear: clearDraft } = useDraft(
    `count-import:${draftKey}`,
    { fileName, sheets, sheetName, colKey, decisions, dupPick },
    (d) => {
      if (!Array.isArray(d.sheets) || d.sheets.length === 0) return
      setSheets(d.sheets)
      setFileName(d.fileName ?? '')
      setSheetName(d.sheetName ?? '')
      setColKey(d.colKey ?? '')
      setDecisions(d.decisions && typeof d.decisions === 'object' ? d.decisions : {})
      setDupPick(d.dupPick && typeof d.dupPick === 'object' ? d.dupPick : {})
    },
    (d) => !Array.isArray(d.sheets) || d.sheets.length === 0,
  )

  function startOver() {
    clearDraft()
    setSheets([])
    setFileName('')
    setSheetName('')
    setColKey('')
    setDecisions({})
    setDupPick({})
  }
  // Answers belong to one column of one sheet: a count typed for SKV.23 is not SRS.'s.
  /** Which duplicate line is meant — per column, like every other answer. */
  const dupKey = (productId: string | undefined) => `${sheetName}|${colKey}|${productId ?? ''}`

  const sheet = sheets.find((s) => s.name === sheetName) ?? null
  const columns = useMemo(() => (sheet ? importColumns(sheet) : []), [sheet])
  const active = useMemo(() => products.filter((p) => p.active !== false), [products])
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const bySkuLabel = useMemo(() => new Map(active.map((p) => [`${p.sku} · ${p.name}`, p])), [active])
  const index = useMemo(() => buildMatchIndex(products, []), [products])

  async function pickFile(file: File | null) {
    if (!file) return
    try {
      const { sheets: parsed, errors } = parseStockWorkbook(await file.arrayBuffer())
      if (!parsed.length) throw errors[0] ?? new Error(t('ไฟล์นี้ไม่มีชีตสต๊อกที่อ่านได้'))
      setSheets(parsed)
      setFileName(file.name)
      const key = brand ? brandDef(brand).sheetKey : ''
      const s = parsed.find((x) => x.name.trim().toUpperCase() === key) ?? parsed[0]
      setSheetName(s.name)
      const cols = importColumns(s)
      const inMonth = cols.filter((c) => {
        const d = s.snapshots[c.snapshot].date
        return d !== null && monthOf(d) === month
      })
      const pool = inMonth.length ? inMonth : cols
      const header = guessHeader([...new Set(pool.map((c) => c.header))], locationName)
      const guess = pool.filter((c) => !header || c.header === header).pop() ?? pool[pool.length - 1]
      setColKey(guess ? `${guess.snapshot}:${guess.column}` : '')
      setDecisions({})
      setDupPick({})
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  const at = colKey ? { snapshot: Number(colKey.split(':')[0]), column: Number(colKey.split(':')[1]) } : null
  const column = at ? columns.find((c) => c.snapshot === at.snapshot && c.column === at.column) : undefined
  const source = sheet && column ? `${sheet.name} · ${column.header} · ${column.label}` : ''
  const rows = useMemo(() => (sheet && at ? importRows(sheet, at, products) : []), [sheet, colKey, products]) // eslint-disable-line react-hooks/exhaustive-deps

  // A duplicate, once a line is chosen, is judged like any other line.
  const resolved: ImportRow[] = useMemo(
    () =>
      rows.flatMap((r) => {
        if (r.status !== 'duplicate') return [r]
        const pick = dupPick[dupKey(r.productId)]
        if (!pick || pick === 'skip') return []
        const lines = r.alsoRows ?? []
        const p = byId.get(r.productId ?? '')
        const chosen =
          pick === 'sum'
            ? { excelRow: lines[0].excelRow, qty: lines.reduce((s, l) => s + l.qty, 0), fileUnit: lines[0].fileUnit }
            : lines.find((l) => String(l.excelRow) === pick)
        if (!chosen || !p) return []
        const same = !!chosen.fileUnit && sameUnit(chosen.fileUnit, p.unitType)
        const known = !same && chosen.fileUnit ? resolveFactor(p, chosen.fileUnit) : null
        return [{ ...r, ...chosen, status: same ? ('ready' as const) : ('unit' as const), ...(known !== null ? { knownRate: known } : {}) }]
      }),
    [rows, dupPick, byId, sheetName, colKey], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const ready = resolved.filter((r) => r.status === 'ready')
  const asking = resolved.filter((r) => r.status === 'unit' || r.status === 'unknown' || r.status === 'nosku')
  const dups = rows.filter((r) => r.status === 'duplicate')
  const key = (r: ImportRow) => `${sheetName}|${colKey}|${r.excelRow}`

  const initial = (r: ImportRow): Decision | undefined =>
    r.status === 'unit'
      ? r.knownRate !== undefined
        ? { kind: 'rate', how: 'rate', count: '', value: String(r.knownRate), mode: 'perFile', remember: false }
        : { kind: 'rate', how: 'count', count: '', value: '', mode: 'perFile', remember: !!r.fileUnit }
      : undefined
  const decisionOf = (r: ImportRow) => decisions[key(r)] ?? initial(r)
  const decide = (r: ImportRow, d: Decision) => setDecisions((all) => ({ ...all, [key(r)]: d }))

  /** The product a line lands on, and its count in that product's own unit. */
  function landing(r: ImportRow): { product: Product; qty: number } | null {
    const d = decisionOf(r)
    if (!d || d.kind === 'question' || d.kind === 'exclude') return null
    const product = byId.get(d.kind === 'map' ? d.productId : r.productId!)
    if (!product) return null
    if (d.kind === 'map' && r.fileUnit && sameUnit(r.fileUnit, product.unitType)) return { product, qty: r.qty }
    const qty =
      d.how === 'count'
        ? answeredQty(r.qty, { how: 'count', count: d.count.trim() === '' ? Number.NaN : Number(d.count) })
        : answeredQty(r.qty, { how: 'rate', value: Number(d.value), mode: d.mode })
    return qty === null ? null : { product, qty }
  }
  const decided = (r: ImportRow) => {
    const d = decisionOf(r)
    return !!d && (d.kind === 'question' || d.kind === 'exclude' || landing(r) !== null)
  }
  const openRows = asking.filter((r) => !decided(r))
  const undecidedDups = dups.filter((r) => !dupPick[dupKey(r.productId)])
  const landed = asking.map((r) => [r, landing(r)] as const).filter((x): x is readonly [ImportRow, { product: Product; qty: number }] => x[1] !== null)
  const goingIds = new Set([...ready.map((r) => r.productId!), ...landed.map(([, l]) => l.product.id)])
  const questionsCount = asking.filter((r) => decisionOf(r)?.kind === 'question').length
  const replacing = [...goingIds].filter((id) => existing[id] !== undefined).length

  async function apply() {
    setBusy(true)
    try {
      // Rates kept on products first, so a refusal stops before the sheet is filled.
      for (const [r, l] of landed) {
        const d = decisionOf(r)
        if (!d || (d.kind !== 'rate' && d.kind !== 'map') || d.how !== 'rate' || !d.remember || !r.fileUnit) continue
        if (sameUnit(r.fileUnit, l.product.unitType) || resolveFactor(l.product, r.fileUnit) !== null) continue
        const v = Number(d.value)
        await addConversion(l.product, r.fileUnit, d.mode === 'perFile' ? v : 1, d.mode === 'perFile' ? {} : { per: v })
      }
      // Two lines of the file landing on one product (a code-less row placed on a product that
      // also had its own line) are two piles counted: they add up.
      const counts: Record<string, number> = {}
      const add = (id: string, qty: number) => (counts[id] = Math.round(((counts[id] ?? 0) + qty) * 1000) / 1000)
      for (const r of ready) add(r.productId!, r.qty)
      for (const [, l] of landed) add(l.product.id, l.qty)
      const questions: Record<string, ImportedQuestion> = {}
      for (const r of asking) {
        const d = decisionOf(r)
        if (d?.kind !== 'question') continue
        questions[`${sheet?.name ?? ''}|${column?.header ?? ''}|${column?.label ?? ''}|${r.excelRow}`] = {
          source,
          excelRow: r.excelRow,
          code: r.code,
          name: r.name,
          packSize: r.packSize,
          qty: r.qty,
          fileUnit: r.fileUnit,
          note: d.note.trim(),
        }
      }
      await onApply({ counts, questions })
      clearDraft()
      toast.success(
        t('เติมยอดนับ {n} รายการลงใบนับ และตั้งคำถาม {q} รายการ — ตรวจแล้วกดบันทึกยอดนับ', { n: Object.keys(counts).length, q: Object.keys(questions).length }),
      )
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const input = 'num min-h-10 w-24 rounded-lg border border-line-strong px-2 text-right outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'
  const statusLabel = (r: ImportRow) =>
    r.status === 'unit' ? t('หน่วยไม่ตรง') : r.status === 'unknown' ? t('รหัสไม่มีในระบบ') : t('ไม่มีรหัส')

  /** A line placed on a product: a rate that product already knows is offered; otherwise the count is asked. */
  function mapTo(r: ImportRow, d: Extract<Decision, { kind: 'map' }>, p: Product): Decision {
    const known = r.fileUnit ? resolveFactor(p, r.fileUnit) : null
    return { ...d, productId: p.id, ...(known !== null ? { how: 'rate' as const, value: String(known), mode: 'perFile' as const } : { how: 'count' as const, value: '' }) }
  }

  // A plain render function, not a component: a component declared in here would be a new
  // type every render, and React would remount its inputs under the cursor.
  function rateInputs(r: ImportRow, d: Extract<Decision, { kind: 'rate' | 'map' }>, product: Product) {
    const l = landing(r)
    const known = r.fileUnit ? resolveFactor(product, r.fileUnit) : null
    const unit = product.unitType
    const ways: { how: Rate['how']; label: string }[] = [
      { how: 'count', label: t('นับได้กี่ {unit}', { unit }) },
      ...(r.fileUnit ? [{ how: 'rate' as const, label: t('ใช้อัตราแปลงจาก {file}', { file: r.fileUnit }) }] : []),
    ]
    return (
      <div className="space-y-2 rounded-lg bg-sunken/60 p-2">
        {ways.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('วิธีใส่ยอด')}>
            {ways.map((w) => (
              <button
                key={w.how}
                type="button"
                role="radio"
                aria-checked={d.how === w.how}
                onClick={() => decide(r, { ...d, how: w.how })}
                className={`rounded-lg border px-2.5 py-1 text-xs ${d.how === w.how ? 'border-brand bg-surface font-semibold text-brand' : 'border-line text-ink-soft hover:bg-surface'}`}
              >
                {w.label}
              </button>
            ))}
          </div>
        )}
        {d.how === 'count' ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-soft">{t('ยอดนับ')}</span>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={d.count}
              aria-label={t('ยอดนับของ "{name}" เป็น {unit}', { name: product.name, unit })}
              onChange={(e) => decide(r, { ...d, count: e.target.value })}
              className={input}
            />
            <span className="text-xs font-semibold text-ink">{unit}</span>
            {!r.fileUnit && (
              <button type="button" className="rounded-lg border border-line px-2 py-1.5 text-xs hover:bg-surface" onClick={() => decide(r, { ...d, count: String(r.qty) })}>
                {t('ใช้ {qty} ตามไฟล์ (ไฟล์นับเป็น {unit} อยู่แล้ว)', { qty: fmtQty(r.qty), unit })}
              </button>
            )}
            <span className="text-xs text-ink-faint">
              {t('ในไฟล์')} {fmtQty(r.qty)} {r.fileUnit || t('(ไม่ระบุหน่วย)')}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={d.mode} onChange={(e) => decide(r, { ...d, mode: e.target.value as Mode })} className="!min-h-10 !w-auto">
              <option value="perFile">{t('1 {file} =', { file: r.fileUnit })}</option>
              <option value="filePerOne">{t('{file} ต่อ 1 {unit}:', { file: r.fileUnit, unit })}</option>
            </Select>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={d.value}
              aria-label={t('อัตราแปลงของ "{name}"', { name: product.name })}
              onChange={(e) => decide(r, { ...d, value: e.target.value })}
              className={input}
            />
            <span className="text-xs text-ink-soft">{d.mode === 'perFile' ? unit : r.fileUnit}</span>
            {/* The arithmetic spelt out, so a rate typed as a count is plain to see. */}
            <span className="num text-xs font-semibold text-ink">
              {l ? `${fmtQty(r.qty)} ${r.fileUnit} → ${fmtQty(l.qty)} ${unit}` : ''}
            </span>
            {known === null && (
              <label className="flex items-center gap-1 text-xs text-ink-soft">
                <input type="checkbox" checked={d.remember} onChange={(e) => decide(r, { ...d, remember: e.target.checked })} />
                {t('จำไว้ที่สินค้า')}
              </label>
            )}
          </div>
        )}
      </div>
    )
  }


  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={t('นำเข้ายอดนับจาก Excel')} wide keepOnOverlay>
      <div className="space-y-4 text-sm">
        <AlertBanner tone="info" icon="info">
          {t('ยอดจากไฟล์เติมลงใบนับนี้เท่านั้น ยังไม่ปรับสต๊อก — ทุกแถวในไฟล์ต้องมีคำตอบ: หน่วยไม่ตรงใส่อัตรา, ไม่มีรหัสหรือรหัสไม่มีในระบบให้จับคู่สินค้า, ถ้ายังไม่แน่ใจตั้งเป็นคำถามไว้ก่อน (ยืนยันใบนับไม่ได้จนกว่าจะตอบ)')}
        </AlertBanner>

        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t('ไฟล์ปิดสต๊อก (.xlsx)')}>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
          </Field>
          {sheets.length > 0 && (
            <Field label={t('ชีต')}>
              <Select value={sheetName} onChange={(e) => setSheetName(e.target.value)}>
                {sheets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {columns.length > 0 && (
            <Field label={t('คอลัมน์ของ "{name}"', { name: locationName })}>
              <Select value={colKey} onChange={(e) => setColKey(e.target.value)}>
                {columns.map((c) => (
                  <option key={`${c.snapshot}:${c.column}`} value={`${c.snapshot}:${c.column}`}>
                    {c.header} · {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {fileName && <p className="text-xs text-ink-faint">{fileName}</p>}
        {restored && sheets.length > 0 && (
          <AlertBanner tone="info" icon="info">
            <span className="flex flex-wrap items-center gap-2">
              {t('ทำต่อจากร่างที่ค้างไว้ในเครื่องนี้ — คำตอบเดิมอยู่ครบ')}
              <button type="button" onClick={startOver} className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-sunken">
                {t('ล้างร่าง เริ่มใหม่')}
              </button>
            </span>
          </AlertBanner>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-in-soft px-3 py-1 text-in">{t('หน่วยตรง {n}', { n: ready.length })}</span>
              <span className="rounded-full bg-warn-soft px-3 py-1 text-warn">
                {t('ต้องตัดสินใจ {n} (เหลือ {left})', { n: asking.length + dups.length, left: openRows.length + undecidedDups.length })}
              </span>
              {questionsCount > 0 && <span className="rounded-full bg-sunken px-3 py-1 text-ink-soft">{t('ตั้งเป็นคำถาม {n}', { n: questionsCount })}</span>}
            </div>

            {asking.length > 0 && (
              <section>
                <h3 className="mb-2 font-semibold text-ink">{t('รายการที่ต้องตัดสินใจ')}</h3>
                <div className="max-h-[48vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                  {asking.map((r) => {
                    const d = decisionOf(r)
                    const own = r.productId ? byId.get(r.productId) : undefined
                    const mapped = d?.kind === 'map' ? byId.get(d.productId) : undefined
                    const hint = r.status !== 'unit' ? matchProduct(r.name, index) : null
                    const suggestions = hint ? (hint.product ? [hint.product] : hint.candidates.map((c) => c.product)).slice(0, 3) : []
                    const choices: { k: Decision['kind']; label: string }[] =
                      r.status === 'unit'
                        ? [
                            { k: 'rate', label: t('ใส่ยอดนับ') },
                            { k: 'question', label: t('ถามไว้ก่อน') },
                            { k: 'exclude', label: t('ไม่นำเข้า') },
                          ]
                        : [
                            { k: 'map', label: t('จับคู่สินค้า') },
                            { k: 'question', label: t('ถามไว้ก่อน') },
                            { k: 'exclude', label: t('ไม่นำเข้า') },
                          ]
                    const pickKind = (k: Decision['kind']) =>
                      decide(
                        r,
                        k === 'question'
                          ? { kind: 'question', note: d?.kind === 'question' ? d.note : '' }
                          : k === 'exclude'
                            ? { kind: 'exclude' }
                            : k === 'map'
                              ? { kind: 'map', productId: d?.kind === 'map' ? d.productId : '', how: 'count', count: '', value: '', mode: 'perFile', remember: true }
                              : (initial(r) as Decision),
                      )
                    return (
                      <div key={key(r)} className={`space-y-2 px-3 py-3 ${decided(r) ? '' : 'bg-warn-soft/40'}`}>
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium text-ink">{own?.name ?? r.name}</span>
                          <span className="rounded bg-sunken px-1.5 text-[11px] text-ink-soft">{statusLabel(r)}</span>
                          <span className="text-xs text-ink-faint">
                            {r.code || '—'} · {t('แถว {n}', { n: r.excelRow })}
                            {r.packSize && ` · ${t('ขนาดบรรจุ {size}', { size: r.packSize })}`} · {t('ในไฟล์')}{' '}
                            <b className="text-ink">
                              {fmtQty(r.qty)} {r.fileUnit || t('(ไม่ระบุหน่วย)')}
                            </b>
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('การตัดสินใจ')}>
                          {choices.map((c) => (
                            <button
                              key={c.k}
                              type="button"
                              role="radio"
                              aria-checked={d?.kind === c.k}
                              onClick={() => pickKind(c.k)}
                              className={`rounded-full border px-3 py-1 text-xs ${d?.kind === c.k ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line text-ink-soft hover:bg-sunken'}`}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                        {d?.kind === 'rate' && own && rateInputs(r, d, own)}
                        {d?.kind === 'map' && (
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                list="count-import-products"
                                placeholder={t('พิมพ์ค้นหารหัสหรือชื่อสินค้า')}
                                defaultValue={mapped ? `${mapped.sku} · ${mapped.name}` : ''}
                                onChange={(e) => {
                                  const p = bySkuLabel.get(e.target.value)
                                  if (p) decide(r, mapTo(r, d, p))
                                }}
                                className="min-h-10 min-w-0 flex-1 rounded-lg border border-line-strong px-3 outline-none focus-visible:border-brand"
                              />
                              {suggestions.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => decide(r, mapTo(r, d, p))}
                                  className={`rounded-lg border px-2 py-1 text-xs ${d.productId === p.id ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-sunken'}`}
                                >
                                  {t('ใช่ {name}?', { name: p.name })}
                                </button>
                              ))}
                            </div>
                            {mapped && (
                              <div className="text-xs text-ink-soft">
                                {t('จับคู่กับ')} <b className="text-ink">{mapped.sku} · {mapped.name}</b> ({mapped.unitType})
                              </div>
                            )}
                            {mapped && !(r.fileUnit && sameUnit(r.fileUnit, mapped.unitType)) && rateInputs(r, d, mapped)}
                          </div>
                        )}
                        {d?.kind === 'question' && (
                          <input
                            value={d.note}
                            onChange={(e) => decide(r, { kind: 'question', note: e.target.value })}
                            placeholder={t('คืออะไร / ต้องถามใคร (ไม่บังคับ)')}
                            className="min-h-10 w-full rounded-lg border border-line-strong px-3 outline-none focus-visible:border-brand"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
                <datalist id="count-import-products">
                  {active.map((p) => (
                    <option key={p.id} value={`${p.sku} · ${p.name}`} />
                  ))}
                </datalist>
              </section>
            )}

            {dups.length > 0 && (
              <section>
                <h3 className="mb-2 font-semibold text-ink">{t('สินค้าที่นับซ้ำในคอลัมน์นี้ — เลือกว่าใช้ยอดไหน')}</h3>
                <div className="divide-y divide-line rounded-xl border border-line">
                  {dups.map((r) => {
                    const lines = r.alsoRows ?? []
                    const sameUnits = lines.every((l) => sameUnit(l.fileUnit, lines[0].fileUnit))
                    return (
                      <div key={r.productId} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                        <span className="min-w-0 flex-1 font-medium text-ink">
                          {byId.get(r.productId!)?.name ?? r.name}{' '}
                          <span className="text-xs text-ink-faint">
                            ({lines.map((l) => `${t('แถว {n}', { n: l.excelRow })}: ${fmtQty(l.qty)} ${l.fileUnit}`).join(' · ')})
                          </span>
                        </span>
                        <Select value={dupPick[dupKey(r.productId)] ?? ''} onChange={(e) => setDupPick((x) => ({ ...x, [dupKey(r.productId)]: e.target.value }))} className="!w-auto">
                          <option value="">{t('— เลือก —')}</option>
                          {sameUnits && <option value="sum">{t('รวมกัน')}</option>}
                          {lines.map((l) => (
                            <option key={l.excelRow} value={String(l.excelRow)}>
                              {t('ใช้แถว {n}', { n: l.excelRow })}
                            </option>
                          ))}
                          <option value="skip">{t('ไม่นำเข้า')}</option>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {ready.length > 0 && (
              <details className="rounded-xl border border-line px-3 py-2">
                <summary className="cursor-pointer text-ink-soft">{t('หน่วยตรงกับระบบ {n} รายการ — เติมให้ตามไฟล์', { n: ready.length })}</summary>
                <ul className="mt-2 space-y-1 text-xs text-ink-soft">
                  {ready.map((r) => (
                    <li key={key(r)}>
                      {t('แถว {n}', { n: r.excelRow })} · {r.code} · {byId.get(r.productId!)?.name ?? r.name} · {fmtQty(r.qty)} {r.fileUnit}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {replacing > 0 && <p className="text-xs text-warn">{t('จะแทนที่ยอดนับที่มีอยู่แล้วในใบนี้ {n} รายการ', { n: replacing })}</p>}
          </>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('ยกเลิก')}
          </Button>
          <Button onClick={() => void apply()} disabled={busy || !rows.length || openRows.length > 0 || undecidedDups.length > 0}>
            {busy ? t('กำลังบันทึก...') : t('เติมลงใบนับ ({n} รายการ)', { n: goingIds.size })}
          </Button>
        </div>
        {(openRows.length > 0 || undecidedDups.length > 0) && rows.length > 0 && (
          <p className="text-right text-xs text-ink-faint">{t('ตัดสินใจให้ครบทุกแถวก่อน (เหลือ {n})', { n: openRows.length + undecidedDups.length })}</p>
        )}
      </div>
    </Modal>
  )
}
