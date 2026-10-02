import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useConfirm } from '../../components/Confirm'
import { SectionCard, StatusChip } from '../../components/frame'
import { Icon } from '../../components/Icon'
import { SiteSelect } from '../../components/SiteChip'
import { ThaiDateField } from '../../components/ThaiDateField'
import { useToast } from '../../components/Toast'
import { AlertBanner, Button, Field, Select } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { dateInputToMs, fmtQty, formatThaiDate, msToDateInput, todayMs } from '../../lib/format'
import { guessColumns, matchSales, readSales, type ColumnMap, type Row } from '../../lib/posImport'
import { useRecipes } from '../../services/recipes'
import { consumeStock } from '../../services/stock'

/** Written on the consume document as data — the same words in either screen language. */
const POS_NOTE = 'ยอดขาย POS' // i18n-key

/**
 * ตัดตามยอดขาย POS (Automation Plan Phase 3 — owner, 25 Sep 2026): the day's sales export
 * dropped here becomes one consume document — every ingredient the recipes say those sales
 * used, at the branch that sold them. The person sees every number before anything moves,
 * picks which lines to file, and a second import of the same day and branch is flagged.
 */
export function PosImportForm({ modeCards }: { modeCards: ReactNode }) {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const { locations, qtyAt, movements } = useData()
  const recipes = useRecipes()
  const fileRef = useRef<HTMLInputElement>(null)

  const sites = useMemo(() => locations.filter((l) => l.active !== false && l.type !== 'transit'), [locations])
  const defaultSite = sites.find((l) => l.type === 'branch') ?? sites[0]
  const [locationId, setLocationId] = useState(defaultSite?.id ?? '')
  // The sites may arrive after the screen opens; take the default once they do.
  useEffect(() => {
    if (!locationId && defaultSite) setLocationId(defaultSite.id)
  }, [locationId, defaultSite])
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<{ name: string; rows: Row[] }[]>([])
  const [sheetIdx, setSheetIdx] = useState(0)
  const [map, setMap] = useState<ColumnMap | null>(null)
  const [off, setOff] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)

  const rows = sheets[sheetIdx]?.rows ?? []
  const sales = useMemo(() => (map ? readSales(rows, map) : []), [rows, map])
  const result = useMemo(() => matchSales(sales, recipes), [sales, recipes])
  const header = map ? (rows[map.header] ?? []) : []
  const colOptions = useMemo(() => {
    const width = Math.max(0, ...rows.slice(0, 30).map((r) => r.length))
    return Array.from({ length: width }, (_, i) => ({ i, label: `${colName(i)}: ${String(header[i] ?? '').trim() || '—'}` }))
  }, [rows, header])

  const date = dateInputToMs(dateStr)
  const dayText = formatThaiDate(date)
  const note = `${POS_NOTE} ${dayText}${fileName ? ` · ${fileName}` : ''}`
  // Already filed for this branch and day? The note is how an import names itself.
  const earlier = movements.find((m) => m.type === 'consume' && !m.voided && m.fromLocationId === locationId && (m.note ?? '').startsWith(`${POS_NOTE} ${dayText}`))

  const lines = result.usage.map((u) => {
    const have = qtyAt(locationId, u.productId)
    const short = u.qty > have
    return { ...u, have, short, on: off[u.productId] === undefined ? !short : !off[u.productId] }
  })
  const chosen = lines.filter((l) => l.on)

  async function pick(file: File) {
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const read = wb.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { header: 1, raw: true, defval: null }),
      })).filter((s) => s.rows.length > 0)
      if (read.length === 0) throw new Error(t('ไฟล์นี้ไม่มีข้อมูล'))
      setSheets(read)
      setSheetIdx(0)
      setMap(guessColumns(read[0].rows))
      setOff({})
      setFileName(file.name)
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  async function file() {
    if (!user) return
    if (chosen.length === 0) return toast.error(t('ยังไม่ได้เลือกวัตถุดิบที่จะตัด'))
    const over = chosen.find((l) => l.short)
    if (over) return toast.error(t('สต๊อกไม่พอสำหรับ "{name}"', { name: over.productName }))
    const ok = await confirm({
      title: t('ตัดสต๊อกตามยอดขาย'),
      message: t('ตัดวัตถุดิบ {n} รายการ ออกจาก {site} วันที่ {date} เป็นเอกสารเบิกใช้ 1 ใบ?', {
        n: chosen.length,
        site: sites.find((s) => s.id === locationId)?.name ?? '',
        date: dayText,
      }),
      confirmText: t('ยืนยันตัดสต๊อก'),
    })
    if (!ok) return
    setBusy(true)
    try {
      const docNo = await consumeStock({
        lines: chosen.map((l) => ({ productId: l.productId, productName: l.productName, unit: l.unit, qty: l.qty })),
        fromLocationId: locationId,
        date,
        actor: { id: user.id, name: user.name },
        note,
      })
      toast.success(t('ตัดสต๊อกตามยอดขายแล้ว (เลขที่ {docNo})', { docNo }))
      setSheets([])
      setMap(null)
      setFileName('')
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const soldTotal = result.matched.reduce((n, m) => n + m.sale.qty, 0)

  return (
    <div className="space-y-4 xl:space-y-5">
      {modeCards}

      <SectionCard
        icon="upload"
        title={t('นำเข้ายอดขาย POS')}
        actions={
          <Link to="/recipes" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-brand hover:underline">
            {t('จัดการสูตรอาหาร ({n})', { n: recipes.filter((r) => r.active).length })}
            <Icon name="arrowRight" size={15} />
          </Link>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('สาขาที่ขาย')} required>
              <SiteSelect value={locationId} onChange={setLocationId} locations={sites} />
            </Field>
            <Field label={t('วันที่ขาย')} required>
              <ThaiDateField value={dateStr} onChange={setDateStr} ariaLabel={t('วันที่ขาย')} />
            </Field>
            <Field label={t('ไฟล์ยอดขาย (CSV / Excel)')}>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void pick(f)
                  e.target.value = ''
                }}
              />
              <Button variant="secondary" onClick={() => fileRef.current?.click()} className="w-full">
                <Icon name="upload" size={16} />
                <span className="truncate">{fileName || t('เลือกไฟล์')}</span>
              </Button>
            </Field>
          </div>

          {earlier && (
            <AlertBanner tone="warn">
              {t('สาขานี้นำเข้ายอดขายวันที่ {date} ไปแล้วใน {docNo} — ตรวจให้แน่ใจว่าไม่ใช่ไฟล์เดิม', { date: dayText, docNo: earlier.docNo })}
            </AlertBanner>
          )}

          {sheets.length > 0 && map && (
            <div className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
              {sheets.length > 1 && (
                <Field label={t('ชีต')}>
                  <Select
                    value={String(sheetIdx)}
                    onChange={(e) => {
                      const i = Number(e.target.value)
                      setSheetIdx(i)
                      setMap(guessColumns(sheets[i].rows))
                    }}
                  >
                    {sheets.map((s, i) => (
                      <option key={s.name} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {(['code', 'name', 'qty'] as const).map((k) => (
                <Field key={k} label={k === 'code' ? t('คอลัมน์รหัสเมนู') : k === 'name' ? t('คอลัมน์ชื่อเมนู') : t('คอลัมน์จำนวนที่ขาย')} required={k === 'qty'}>
                  <Select value={map[k] === null ? '' : String(map[k])} onChange={(e) => setMap({ ...map, [k]: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">{t('— ไม่มี —')}</option>
                    {colOptions.map((c) => (
                      <option key={c.i} value={c.i}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      {sheets.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            <StatusChip tone="green">{t('จับคู่สูตรได้ {n} เมนู · ขาย {sold}', { n: result.matched.length, sold: fmtQty(soldTotal) })}</StatusChip>
            {result.unmatched.length > 0 && <StatusChip tone="amber">{t('ไม่มีสูตร {n} เมนู', { n: result.unmatched.length })}</StatusChip>}
            {result.empty.length > 0 && <StatusChip tone="amber">{t('สูตรยังไม่มีส่วนผสม {n} เมนู', { n: result.empty.length })}</StatusChip>}
          </div>

          {(result.unmatched.length > 0 || result.empty.length > 0) && (
            <SectionCard icon="alertCircle" tone="amber" title={t('ยังไม่ถูกตัดสต๊อก')}>
              <p className="mb-2 text-sm text-ink-soft">{t('ยอดขายของเมนูเหล่านี้จะไม่ถูกตัด จนกว่าจะเพิ่มสูตรหรือใส่ส่วนผสม')}</p>
              <ul className="flex flex-wrap gap-2 text-sm">
                {result.unmatched.map((s) => (
                  <li key={`u-${s.code}-${s.name}`} className="rounded-lg bg-sunken px-2 py-1">
                    {s.code ? `${s.code} · ` : ''}
                    {s.name || '—'} × {fmtQty(s.qty)}
                  </li>
                ))}
                {result.empty.map((m) => (
                  <li key={`e-${m.recipe.id}`} className="rounded-lg bg-warn-soft px-2 py-1 text-warn">
                    {m.recipe.code} · {m.recipe.name} × {fmtQty(m.sale.qty)}
                  </li>
                ))}
              </ul>
              <Link to="/recipes" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                {t('ไปที่สูตรอาหาร')}
                <Icon name="arrowRight" size={15} />
              </Link>
            </SectionCard>
          )}

          <SectionCard icon="package" title={t('วัตถุดิบที่จะตัด')} count={t('({n} รายการ)', { n: lines.length })}>
            {lines.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-faint">{t('ยังไม่มีวัตถุดิบ — ตรวจคอลัมน์ที่เลือก หรือเพิ่มสูตร')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {lines.map((l) => (
                  <li key={l.productId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 md:grid-cols-[auto_minmax(0,1fr)_8rem_8rem_9rem]">
                    <input
                      type="checkbox"
                      checked={l.on}
                      onChange={(e) => setOff((c) => ({ ...c, [l.productId]: !e.target.checked }))}
                      aria-label={t('เลือก {name}', { name: l.productName })}
                      className="h-5 w-5 cursor-pointer accent-[var(--color-brand)]"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{l.productName}</div>
                      <div className="truncate text-xs text-ink-faint">{l.from.join(', ')}</div>
                    </div>
                    <div className="num text-right text-sm font-semibold text-ink">
                      −{fmtQty(l.qty)} {l.unit}
                    </div>
                    <div className="num col-span-2 col-start-2 text-xs text-ink-soft md:col-span-1 md:col-start-auto md:text-right">
                      {t('มี {n} {unit}', { n: fmtQty(l.have), unit: l.unit })}
                    </div>
                    <div className="col-span-3 md:col-span-1 md:text-right">
                      {l.short && <StatusChip tone="red" size="sm">{t('สต๊อกไม่พอ')}</StatusChip>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <span className="text-xs text-ink-faint">{t('บันทึกเป็นเอกสารเบิกใช้ 1 ใบ หมายเหตุ "{note}"', { note })}</span>
              <Button variant="danger" onClick={() => void file()} disabled={busy || chosen.length === 0 || !locationId} className="w-full sm:w-auto">
                <Icon name="check" size={16} />
                {busy ? t('กำลังบันทึก...') : t('ตัดสต๊อก {n} รายการ', { n: chosen.length })}
              </Button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  )
}

/** A, B, … Z, AA — the column letters a spreadsheet shows. */
function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
