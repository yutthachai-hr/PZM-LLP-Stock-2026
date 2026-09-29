import { useMemo, useState } from 'react'
import { useBrand } from '../../brand/BrandContext'
import { brandDef } from '../../brand/brand'
import { useToast } from '../../components/Toast'
import { AlertBanner, Button, Field, Modal, Select } from '../../components/ui'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { countIn, guessHeader, importColumns, importRows, rateOf, type ImportRow } from '../../lib/countImport'
import { fmtQty } from '../../lib/format'
import { monthOf } from '../../lib/monthlyCount'
import { parseStockWorkbook, type ParsedSheet } from '../../lib/stockSheet'
import { addConversion } from '../../services/products'
import type { Product } from '../../types'

type Mode = 'perFile' | 'filePerOne'
interface Answer {
  value: string
  mode: Mode
  remember: boolean
  skip: boolean
}

/**
 * Fill a monthly count sheet from the company's closing-stock workbook (owner, 29 Sep 2026).
 *
 * One column of the file — one location on one counting date — goes into this sheet's
 * figures as counts to check, never as stock moved; they land in the sheet's draft and are
 * saved with its own button. Every line counted in a unit that is not the product's own is
 * asked about before anything goes in (the owner's rule), and the answer can be kept on the
 * product so next month's file does not ask again. Unknown codes and rows without a code
 * are shown and left out; a product counted twice in the column waits for a choice.
 */
export function CountImport({
  open,
  onClose,
  locationName,
  month,
  products,
  existing,
  onApply,
}: {
  open: boolean
  onClose: () => void
  locationName: string
  month: string
  products: Product[]
  /** Figures already on the sheet or in its draft, to say what an import would replace. */
  existing: Record<string, number>
  onApply: (counts: Record<string, number>) => void
}) {
  const t = useT()
  const toast = useToast()
  const { brand } = useBrand()
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [fileName, setFileName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [colKey, setColKey] = useState('')
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [dupPick, setDupPick] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const sheet = sheets.find((s) => s.name === sheetName) ?? null
  const columns = useMemo(() => (sheet ? importColumns(sheet) : []), [sheet])
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

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
      // The counting date that closes this sheet's month, at the heading that names this location.
      const cols = importColumns(s)
      const inMonth = cols.filter((c) => {
        const d = s.snapshots[c.snapshot].date
        return d !== null && monthOf(d) === month
      })
      const pool = inMonth.length ? inMonth : cols
      const header = guessHeader([...new Set(pool.map((c) => c.header))], locationName)
      const guess = pool.filter((c) => !header || c.header === header).pop() ?? pool[pool.length - 1]
      setColKey(guess ? `${guess.snapshot}:${guess.column}` : '')
      setAnswers({})
      setDupPick({})
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  const at = colKey ? { snapshot: Number(colKey.split(':')[0]), column: Number(colKey.split(':')[1]) } : null
  const rows = useMemo(() => (sheet && at ? importRows(sheet, at, products) : []), [sheet, colKey, products]) // eslint-disable-line react-hooks/exhaustive-deps

  // A duplicate, once a line is chosen, is judged like any other line.
  const resolved: ImportRow[] = useMemo(
    () =>
      rows.flatMap((r) => {
        if (r.status !== 'duplicate') return [r]
        const pick = dupPick[r.productId ?? '']
        if (!pick || pick === 'skip') return []
        const lines = r.alsoRows ?? []
        const p = byId.get(r.productId ?? '')
        const chosen =
          pick === 'sum'
            ? { excelRow: lines[0].excelRow, qty: lines.reduce((s, l) => s + l.qty, 0), fileUnit: lines[0].fileUnit }
            : lines.find((l) => String(l.excelRow) === pick)
        if (!chosen || !p) return []
        const same = !!chosen.fileUnit && chosen.fileUnit.trim().toLowerCase() === p.unitType.trim().toLowerCase()
        return [{ ...r, ...chosen, status: same ? ('ready' as const) : ('unit' as const) }]
      }),
    [rows, dupPick, byId],
  )

  const ready = resolved.filter((r) => r.status === 'ready')
  const unit = resolved.filter((r) => r.status === 'unit')
  const dups = rows.filter((r) => r.status === 'duplicate')
  const unknown = rows.filter((r) => r.status === 'unknown')
  const nosku = rows.filter((r) => r.status === 'nosku')

  const answerFor = (r: ImportRow): Answer =>
    answers[r.productId!] ?? {
      value: r.knownRate !== undefined ? String(r.knownRate) : '',
      mode: 'perFile',
      remember: r.knownRate === undefined && !!r.fileUnit,
      skip: false,
    }
  const setAnswer = (r: ImportRow, patch: Partial<Answer>) =>
    setAnswers((a) => ({ ...a, [r.productId!]: { ...answerFor(r), ...patch } }))
  const rateFor = (r: ImportRow) => {
    const a = answerFor(r)
    return a.skip ? null : rateOf({ value: Number(a.value), mode: a.mode })
  }
  const open_ = unit.filter((r) => !answerFor(r).skip && rateFor(r) === null)
  const undecided = dups.filter((r) => !dupPick[r.productId ?? ''])
  const going = [...ready, ...unit.filter((r) => rateFor(r) !== null)]
  const replacing = going.filter((r) => existing[r.productId!] !== undefined).length

  async function apply() {
    setBusy(true)
    try {
      // Rates kept on the product first, so a refusal stops before the sheet is filled.
      for (const r of unit) {
        const a = answerFor(r)
        const rate = rateFor(r)
        if (rate === null || !a.remember || !r.fileUnit || r.knownRate !== undefined) continue
        const p = byId.get(r.productId!)
        if (!p) continue
        const v = Number(a.value)
        await addConversion(p, r.fileUnit, a.mode === 'perFile' ? v : 1, a.mode === 'perFile' ? {} : { per: v })
      }
      const counts: Record<string, number> = {}
      for (const r of ready) counts[r.productId!] = r.qty
      for (const r of unit) {
        const rate = rateFor(r)
        if (rate !== null) counts[r.productId!] = countIn(r.qty, rate)
      }
      onApply(counts)
      toast.success(t('เติมยอดนับ {n} รายการลงใบนับแล้ว — ตรวจแล้วกดบันทึกยอดนับ', { n: Object.keys(counts).length }))
      onClose()
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const input = 'num min-h-10 w-24 rounded-lg border border-line-strong px-2 text-right outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={t('นำเข้ายอดนับจาก Excel')} wide>
      <div className="space-y-4 text-sm">
        <AlertBanner tone="info" icon="info">
          {t('ยอดจากไฟล์จะเติมลงใบนับนี้เท่านั้น ยังไม่ปรับสต๊อก — รายการที่หน่วยไม่ตรงกับระบบต้องยืนยันอัตราทีละรายการก่อน')}
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

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-in-soft px-3 py-1 text-in">{t('หน่วยตรง {n}', { n: ready.length })}</span>
              <span className="rounded-full bg-warn-soft px-3 py-1 text-warn">
                {t('ต้องยืนยันหน่วย {n} (เหลือ {left})', { n: unit.length, left: open_.length })}
              </span>
              {dups.length > 0 && <span className="rounded-full bg-warn-soft px-3 py-1 text-warn">{t('ซ้ำ {n}', { n: dups.length })}</span>}
              <span className="rounded-full bg-sunken px-3 py-1 text-ink-soft">{t('ไม่พบรหัสในระบบ {n}', { n: unknown.length })}</span>
              <span className="rounded-full bg-sunken px-3 py-1 text-ink-soft">{t('ไม่มีรหัส {n}', { n: nosku.length })}</span>
            </div>

            {unit.length > 0 && (
              <section>
                <h3 className="mb-2 font-semibold text-ink">{t('ยืนยันอัตราแปลงหน่วย')}</h3>
                <div className="max-h-[45vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                  {unit.map((r) => {
                    const a = answerFor(r)
                    const rate = rateFor(r)
                    const p = byId.get(r.productId!)
                    const fileU = r.fileUnit || t('(ไม่ระบุหน่วย)')
                    return (
                      <div key={r.productId} className={`grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center ${a.skip ? 'opacity-50' : ''}`}>
                        <div className="min-w-0">
                          <div className="font-medium text-ink">{p?.name ?? r.name}</div>
                          <div className="text-xs text-ink-faint">
                            {r.code} · {t('แถว {n}', { n: r.excelRow })}
                            {r.packSize && ` · ${t('ขนาดบรรจุ {size}', { size: r.packSize })}`} · {t('ในไฟล์')}{' '}
                            <b className="text-ink">
                              {fmtQty(r.qty)} {fileU}
                            </b>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {!r.fileUnit ? (
                            <button type="button" className="rounded-lg border border-line px-2 py-1.5 text-xs hover:bg-sunken" onClick={() => setAnswer(r, { value: '1', mode: 'perFile', skip: false })}>
                              {t('เป็น {unit} อยู่แล้ว', { unit: r.unitType ?? '' })}
                            </button>
                          ) : (
                            <Select value={a.mode} onChange={(e) => setAnswer(r, { mode: e.target.value as Mode })} className="!min-h-10 !w-auto" disabled={a.skip}>
                              <option value="perFile">{t('1 {file} =', { file: r.fileUnit })}</option>
                              <option value="filePerOne">{t('{file} ต่อ 1 {unit}:', { file: r.fileUnit, unit: r.unitType ?? '' })}</option>
                            </Select>
                          )}
                          <input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            value={a.value}
                            disabled={a.skip}
                            aria-label={t('อัตราแปลงของ "{name}"', { name: p?.name ?? r.name })}
                            onChange={(e) => setAnswer(r, { value: e.target.value })}
                            className={input}
                          />
                          <span className="text-xs text-ink-soft">{a.mode === 'perFile' ? r.unitType : r.fileUnit}</span>
                          <span className="num min-w-24 text-right text-xs font-semibold text-ink">
                            {rate === null ? '' : `= ${fmtQty(countIn(r.qty, rate))} ${r.unitType}`}
                          </span>
                          {r.fileUnit && r.knownRate === undefined && (
                            <label className="flex items-center gap-1 text-xs text-ink-soft">
                              <input type="checkbox" checked={a.remember} disabled={a.skip} onChange={(e) => setAnswer(r, { remember: e.target.checked })} />
                              {t('จำไว้ที่สินค้า')}
                            </label>
                          )}
                          <label className="flex items-center gap-1 text-xs text-ink-soft">
                            <input type="checkbox" checked={a.skip} onChange={(e) => setAnswer(r, { skip: e.target.checked })} />
                            {t('ข้าม')}
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {dups.length > 0 && (
              <section>
                <h3 className="mb-2 font-semibold text-ink">{t('สินค้าที่นับซ้ำในคอลัมน์นี้ — เลือกว่าใช้ยอดไหน')}</h3>
                <div className="divide-y divide-line rounded-xl border border-line">
                  {dups.map((r) => {
                    const lines = r.alsoRows ?? []
                    const sameUnits = lines.every((l) => l.fileUnit.trim().toLowerCase() === lines[0].fileUnit.trim().toLowerCase())
                    return (
                      <div key={r.productId} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                        <span className="min-w-0 flex-1 font-medium text-ink">
                          {byId.get(r.productId!)?.name ?? r.name}{' '}
                          <span className="text-xs text-ink-faint">
                            ({lines.map((l) => `${t('แถว {n}', { n: l.excelRow })}: ${fmtQty(l.qty)} ${l.fileUnit}`).join(' · ')})
                          </span>
                        </span>
                        <Select value={dupPick[r.productId!] ?? ''} onChange={(e) => setDupPick((d) => ({ ...d, [r.productId!]: e.target.value }))} className="!w-auto">
                          <option value="">{t('— เลือก —')}</option>
                          {sameUnits && <option value="sum">{t('รวมกัน')}</option>}
                          {lines.map((l) => (
                            <option key={l.excelRow} value={String(l.excelRow)}>
                              {t('ใช้แถว {n}', { n: l.excelRow })}
                            </option>
                          ))}
                          <option value="skip">{t('ข้าม')}</option>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {(unknown.length > 0 || nosku.length > 0) && (
              <details className="rounded-xl border border-line px-3 py-2">
                <summary className="cursor-pointer text-ink-soft">{t('ไม่นำเข้า {n} แถว (ไม่พบรหัสในระบบ / ไม่มีรหัส)', { n: unknown.length + nosku.length })}</summary>
                <ul className="mt-2 space-y-1 text-xs text-ink-soft">
                  {[...unknown, ...nosku].map((r) => (
                    <li key={r.excelRow}>
                      {t('แถว {n}', { n: r.excelRow })} · {r.code || '—'} · {r.name} · {fmtQty(r.qty)} {r.fileUnit}
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
          <Button onClick={() => void apply()} disabled={busy || !rows.length || open_.length > 0 || undecided.length > 0 || going.length === 0}>
            {busy ? t('กำลังบันทึก...') : t('เติมลงใบนับ ({n} รายการ)', { n: going.length })}
          </Button>
        </div>
        {(open_.length > 0 || undecided.length > 0) && rows.length > 0 && (
          <p className="text-right text-xs text-ink-faint">{t('ยืนยันอัตราหรือกดข้ามให้ครบทุกรายการก่อน')}</p>
        )}
      </div>
    </Modal>
  )
}
