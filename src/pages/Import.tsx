import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { useConfirm } from '../components/Confirm'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SectionHeader,
  Select,
} from '../components/ui'
import { useData } from '../data/DataContext'
import { errText } from '../i18n/AppError'
import { useT } from '../i18n/I18nContext'
import { fmtQty, formatThaiDateShort } from '../lib/format'
import { parseStockWorkbook, type ParsedSheet } from '../lib/stockSheet'
import {
  applyImportPlan,
  buildImportPlan,
  loadLatestCounts,
  type ImportPlan,
  type ImportResult,
  type SheetMapping,
  type SkipReason,
} from '../services/importStock'

/**
 * Load a month's closing-stock sheet.
 *
 * The company keeps this file anyway — it is how the branches report what they counted —
 * so the system reads their file rather than asking anyone to key the same numbers a second
 * time. That means this screen runs every month, not once, which is what shapes it: the
 * columns are matched by reading the sheet's own headings, and every guess it makes is
 * shown back and can be changed before anything is written.
 *
 * Nothing is posted until the summary has been read and confirmed. The plan shown in the
 * summary is the same object that gets applied.
 */
export function ImportPage() {
  const t = useT()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const { brand } = useBrand()
  const { products, locations, levels } = useData()
  const fileRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [sheetErrors, setSheetErrors] = useState<string[]>([])
  const [sheetName, setSheetName] = useState('')
  const [dates, setDates] = useState<Record<string, string>>({})
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  /** Location per column heading. One heading means the same place on every date. */
  const [byHeader, setByHeader] = useState<Record<string, string>>({})
  const [latestCounts, setLatestCounts] = useState<ReadonlyMap<string, number>>(new Map())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [open, setOpen] = useState<SkipReason | 'units' | 'already' | null>(null)

  const isAdmin = user?.role === 'admin'
  const activeLocations = useMemo(
    () => locations.filter((l) => l.active !== false),
    [locations],
  )
  const sheet = sheets.find((s) => s.name === sheetName) ?? null

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    reset()
    try {
      const parsed = parseStockWorkbook(await file.arrayBuffer())
      setFileName(file.name)
      setSheets(parsed.sheets)
      setSheetErrors(parsed.errors.map((err) => errText(err, t)))
      if (parsed.sheets.length === 0) {
        toast.error(t('ไฟล์นี้ไม่มีชีตที่อ่านเป็นใบสต๊อกคงเหลือได้'))
        return
      }
      // Default to the sheet whose name looks like the brand that is open. The workbook
      // keeps a sheet per company, and each one belongs to its own set of books.
      const def = brand ? brandDef(brand) : null
      const guess =
        parsed.sheets.find((s) => sheetMatchesBrand(s.name, def?.sheetKey)) ?? parsed.sheets[0]
      selectSheet(guess)
      setLatestCounts(await loadLatestCounts())
    } catch (err) {
      toast.error(errText(err, t))
    }
  }

  function selectSheet(s: ParsedSheet) {
    setSheetName(s.name)
    setDates(
      Object.fromEntries(
        s.snapshots.map((snap) => [snap.label, snap.date ? toInputDate(snap.date) : '']),
      ),
    )
    setIncluded(Object.fromEntries(s.snapshots.map((snap) => [snap.label, true])))
    const headers = [...new Set(s.snapshots.flatMap((snap) => snap.columns.map((c) => c.header)))]
    setByHeader(Object.fromEntries(headers.map((h) => [h, ''])))
    setResult(null)
  }

  function reset() {
    setFileName('')
    setSheets([])
    setSheetErrors([])
    setSheetName('')
    setDates({})
    setIncluded({})
    setByHeader({})
    setLatestCounts(new Map())
    setResult(null)
    setProgress(null)
    setOpen(null)
  }

  const headers = useMemo(
    () =>
      sheet ? [...new Set(sheet.snapshots.flatMap((s) => s.columns.map((c) => c.header)))] : [],
    [sheet],
  )

  const mapping: SheetMapping | null = useMemo(() => {
    if (!sheet) return null
    return {
      sheetName: sheet.name,
      snapshots: sheet.snapshots.map((snap) => ({
        label: snap.label,
        date: fromInputDate(dates[snap.label] ?? ''),
        include: (included[snap.label] ?? false) && !!dates[snap.label],
        columns: snap.columns.map((c) => ({
          ...c,
          locationId: byHeader[c.header] || null,
        })),
      })),
    }
  }, [sheet, dates, included, byHeader])

  // Absence means a balance of zero: a product that has never moved at a location has no
  // stockLevels document at all.
  const balances = useMemo(
    () => new Map(levels.map((l) => [`${l.locationId}|${l.productId}`, l.qty])),
    [levels],
  )

  const plan: ImportPlan | null = useMemo(() => {
    if (!sheet || !mapping) return null
    return buildImportPlan(sheet, mapping, products, activeLocations, latestCounts, balances)
  }, [sheet, mapping, products, activeLocations, latestCounts, balances])

  const mappedAny = headers.some((h) => byHeader[h])
  const canImport = !!plan && plan.postings.length > 0 && !progress

  async function run() {
    if (!plan || !user) return
    const ok = await confirm({
      title: t('เริ่มนำเข้า?'),
      message: t(
        'จะบันทึกยอดนับ {n} รายการ ที่ {locations} คลัง ลงในสต๊อก — ระบบจะบันทึกเป็นการปรับยอด (ยอดยกมา) ตามวันที่ของแต่ละงวด',
        { n: plan.postings.length, locations: plan.locationCount },
      ),
      confirmText: t('นำเข้า'),
    })
    if (!ok) return
    setProgress({ done: 0, total: plan.postings.length })
    try {
      const res = await applyImportPlan(
        plan,
        { id: user.id, name: user.name },
        t('นำเข้าจากไฟล์ {file}', { file: fileName }),
        (done, total) => setProgress({ done, total }),
      )
      setResult(res)
      setLatestCounts(await loadLatestCounts())
      if (res.failed.length === 0) {
        toast.success(t('นำเข้าสำเร็จ {n} รายการ', { n: res.posted }))
      } else {
        toast.error(t('นำเข้าเสร็จแต่มี {n} รายการที่ล้มเหลว', { n: res.failed.length }))
      }
    } catch (err) {
      toast.error(errText(err, t))
    } finally {
      setProgress(null)
    }
  }

  async function downloadSkipped() {
    if (!plan) return
    const { exportExcel } = await import('../lib/export')
    exportExcel(
      `skipped-${fileName.replace(/\.xlsx?$/i, '')}`,
      'Skipped',
      plan.skipped.map((s) => ({
        [t('แถวใน Excel')]: s.excelRow,
        [t('รหัส')]: s.code,
        [t('ชื่อ')]: s.name,
        [t('ขนาดบรรจุ')]: s.packSize,
        [t('สาเหตุ')]: t(SKIP_LABEL[s.reason]),
        [t('จำนวนช่องที่ข้าม')]: s.droppedCells,
        [t('ตำแหน่ง')]: s.where,
        [t('รายละเอียด')]: s.detail ?? '',
      })),
    )
  }

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader
          icon="upload"
          title={t('นำเข้าสต๊อกจาก Excel')}
          subtitle={t('ลงยอดนับจากไฟล์สต๊อกคงเหลือรายเดือน')}
        />
        <Card className="p-4">
          <EmptyState
            icon="warning"
            title={t('เฉพาะผู้ดูแลระบบ')}
            hint={t('การนำเข้าเขียนทับยอดคงเหลือทุกคลังในไฟล์ จึงจำกัดไว้ที่ผู้ดูแลระบบ')}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon="upload"
        title={t('นำเข้าสต๊อกจาก Excel')}
        subtitle={t('ลงยอดนับจากไฟล์สต๊อกคงเหลือรายเดือน')}
        actions={
          fileName ? (
            <Button variant="secondary" onClick={reset}>
              <Icon name="x" size={16} />
              {t('เริ่มใหม่')}
            </Button>
          ) : undefined
        }
      />

      {/* ---- 1. the file ---- */}
      <Card className="p-4">
        <SectionHeader
          icon="upload"
          title={t('1. เลือกไฟล์')}
          description={t('ไฟล์ .xlsx ที่มีคอลัมน์ Quantity/Unit ต่อสาขาต่องวด')}
          badge={fileName ? <Badge color="green">{fileName}</Badge> : undefined}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={pickFile}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={!!progress}>
          <Icon name="upload" size={16} />
          {fileName ? t('เลือกไฟล์อื่น') : t('เลือกไฟล์ Excel')}
        </Button>
        {sheetErrors.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-warn">
            {sheetErrors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---- 2. the mapping ---- */}
      {sheet && (
        <Card className="p-4">
          <SectionHeader
            icon="swap"
            title={t('2. ตรวจการจับคู่')}
            description={t('ระบบเดาให้จากหัวตารางแล้ว — ตรวจก่อนนำเข้า')}
            badge={
              sheets.length > 1 ? (
                <Badge color="amber">
                  {t('ไฟล์นี้มี {n} ชีต', { n: sheets.length })}
                </Badge>
              ) : undefined
            }
          />

          {sheets.length > 1 && (
            <div className="mb-4 max-w-sm">
              <label className="mb-1 block text-xs font-medium text-ink" htmlFor="sheet">
                {t('ชีตที่จะนำเข้า')}
              </label>
              <Select
                id="sheet"
                value={sheetName}
                onChange={(e) => {
                  const next = sheets.find((s) => s.name === e.target.value)
                  if (next) selectSheet(next)
                }}
              >
                {sheets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-ink-soft">
                {t('นำเข้าได้ทีละแบรนด์ — ชีตของอีกแบรนด์ต้องสลับแบรนด์ก่อนแล้วนำเข้าอีกครั้ง')}
              </p>
            </div>
          )}

          <div className="mb-4">
            <div className="mb-2 text-xs font-medium text-ink">{t('คอลัมน์สาขา')}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {headers.map((h) => (
                <div key={h}>
                  <label className="mb-1 block text-xs text-ink-soft" htmlFor={`h-${h}`}>
                    {h}
                  </label>
                  <Select
                    id={`h-${h}`}
                    value={byHeader[h] ?? ''}
                    onChange={(e) => setByHeader((m) => ({ ...m, [h]: e.target.value }))}
                  >
                    <option value="">{t('— ไม่นำเข้า —')}</option>
                    {activeLocations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-ink">{t('งวดที่นับ')}</div>
            <div className="space-y-2">
              {sheet.snapshots.map((snap) => (
                <div
                  key={snap.label}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-sunken px-3 py-2"
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={included[snap.label] ?? false}
                      onChange={(e) =>
                        setIncluded((m) => ({ ...m, [snap.label]: e.target.checked }))
                      }
                    />
                    <span className="truncate">{snap.label}</span>
                  </label>
                  <input
                    type="date"
                    className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink"
                    value={dates[snap.label] ?? ''}
                    onChange={(e) => setDates((m) => ({ ...m, [snap.label]: e.target.value }))}
                    aria-label={t('วันที่นับของงวด {label}', { label: snap.label })}
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              {t('งวดที่ไม่มีวันที่ในหัวตารางจะเดาไม่ได้ ต้องใส่เอง — ยอดนับจะบันทึกตามวันที่นี้')}
            </p>
          </div>
        </Card>
      )}

      {/* ---- 3. the summary ---- */}
      {plan && mappedAny && (
        <Card tone="raised" className="p-4">
          <SectionHeader
            icon="report"
            title={t('3. สรุปก่อนนำเข้า')}
            description={t('ตัวเลขนี้คือสิ่งที่จะถูกบันทึกจริง')}
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('จะบันทึก')} value={plan.postings.length} tone="in" />
            <Stat label={t('จำนวนสินค้า')} value={plan.productCount} />
            <Stat label={t('ข้ามไว้')} value={plan.skipped.length} tone="warn" />
            <Stat
              label={t('ยอดตรงอยู่แล้ว')}
              value={plan.alreadyCounted.length + plan.unchanged.length}
            />
          </div>

          <div className="mt-4 space-y-2">
            {SKIP_ORDER.map((reason) => {
              const rows = plan.skipped.filter((s) => s.reason === reason)
              if (rows.length === 0) return null
              return (
                <Disclosure
                  key={reason}
                  open={open === reason}
                  onToggle={() => setOpen(open === reason ? null : reason)}
                  tone="warn"
                  title={`${t(SKIP_LABEL[reason])} — ${rows.length}`}
                  hint={t(SKIP_HINT[reason])}
                >
                  <ul className="space-y-1">
                    {rows.map((s) => (
                      <li key={s.excelRow} className="flex flex-wrap gap-x-2 text-xs">
                        <span className="text-ink-faint">{t('แถว')} {s.excelRow}</span>
                        <span className="font-medium text-ink">{s.code || '—'}</span>
                        <span className="text-ink-soft">{s.name}</span>
                        {s.detail && <span className="text-warn">({s.detail})</span>}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              )
            })}

            {plan.unitWarnings.length > 0 && (
              <Disclosure
                open={open === 'units'}
                onToggle={() => setOpen(open === 'units' ? null : 'units')}
                tone="warn"
                title={`${t('หน่วยในไฟล์ไม่ตรงกับแคตตาล็อก')} — ${plan.unitWarnings.length}`}
                hint={t('ยอดจะถูกบันทึกด้วยหน่วยของแคตตาล็อก ถ้าหน่วยต่างกันจริง จำนวนจะผิด')}
              >
                <ul className="space-y-1">
                  {plan.unitWarnings.map((w) => (
                    <li key={`${w.sku}-${w.sheetUnit}`} className="text-xs">
                      <span className="font-medium text-ink">{w.sku}</span>{' '}
                      <span className="text-ink-soft">{w.productName}</span>{' '}
                      <span className="text-warn">
                        {t('ไฟล์')} {w.sheetUnit} → {t('ระบบ')} {w.productUnit}
                      </span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}

            {plan.alreadyCounted.length > 0 && (
              <Disclosure
                open={open === 'already'}
                onToggle={() => setOpen(open === 'already' ? null : 'already')}
                tone="plain"
                title={`${t('มียอดนับที่ใหม่กว่าอยู่แล้ว')} — ${plan.alreadyCounted.length}`}
                hint={t('สินค้านี้ที่คลังนี้มียอดนับวันเดียวกันหรือใหม่กว่าอยู่แล้ว — ลงย้อนหลังจะทับยอดล่าสุด')}
              >
                <ul className="space-y-1">
                  {plan.alreadyCounted.slice(0, 50).map((p) => (
                    <li key={`${p.date}-${p.locationId}-${p.productId}`} className="text-xs">
                      <span className="text-ink-faint">{formatThaiDateShort(p.date)}</span>{' '}
                      <span className="font-medium text-ink">{p.sku}</span>{' '}
                      <span className="text-ink-soft">
                        {p.locationName} · {fmtQty(p.targetQty)} {p.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={run} disabled={!canImport}>
              <Icon name="check" size={16} />
              {progress
                ? t('กำลังนำเข้า {done}/{total}', {
                    done: progress.done,
                    total: progress.total,
                  })
                : t('นำเข้า {n} รายการ', { n: plan.postings.length })}
            </Button>
            {plan.skipped.length > 0 && (
              <Button variant="secondary" onClick={downloadSkipped} disabled={!!progress}>
                <Icon name="download" size={16} />
                {t('ดาวน์โหลดรายการที่ข้าม')}
              </Button>
            )}
          </div>

          {progress && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full bg-brand transition-[width] duration-150"
                style={{
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          )}
        </Card>
      )}

      {/* ---- 4. what happened ---- */}
      {result && (
        <Card className="p-4">
          <SectionHeader
            icon={result.failed.length === 0 ? 'check' : 'warning'}
            title={t('ผลการนำเข้า')}
            badge={
              result.failed.length === 0 ? (
                <Badge color="green">{t('สำเร็จ')}</Badge>
              ) : (
                <Badge color="red">{t('มีรายการล้มเหลว')}</Badge>
              )
            }
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label={t('ลงบัญชีแล้ว')} value={result.posted} tone="in" />
            <Stat label={t('ยอดตรงอยู่แล้ว')} value={result.unchanged} />
            <Stat label={t('ล้มเหลว')} value={result.failed.length} tone="warn" />
          </div>
          {result.failed.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {result.failed.map((f, i) => (
                <li key={i}>
                  <span className="font-medium text-ink">{f.posting.sku}</span>{' '}
                  <span className="text-ink-soft">{f.posting.locationName}</span>{' '}
                  <span className="text-danger">{errText(f.error, t)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!sheet && !fileName && (
        <Card className="p-0">
          <EmptyState
            icon="upload"
            title={t('ยังไม่ได้เลือกไฟล์')}
            hint={t('ไฟล์สต๊อกคงเหลือรายเดือนใช้ได้เลย ไม่ต้องแก้รูปแบบ — ระบบอ่านหัวตารางเองว่าคอลัมน์ไหนเป็นสาขาไหน งวดไหน')}
          />
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- bits

function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string
  value: number
  tone?: 'plain' | 'in' | 'warn'
}) {
  const tones = { plain: 'text-ink', in: 'text-in', warn: 'text-warn' }
  return (
    <div className="rounded-lg border border-line bg-sunken px-3 py-2">
      <div className={`num text-xl font-bold leading-tight ${tones[tone]}`}>{value}</div>
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  )
}

function Disclosure({
  open,
  onToggle,
  title,
  hint,
  tone,
  children,
}: {
  open: boolean
  onToggle: () => void
  title: string
  hint: string
  tone: 'warn' | 'plain'
  children: React.ReactNode
}) {
  return (
    <div
      className={`rounded-lg border ${tone === 'warn' ? 'border-warn/30 bg-warn-soft' : 'border-line bg-sunken'}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <Icon name={open ? 'chevronDown' : 'arrowRight'} size={15} />
        <span className="min-w-0 flex-1">{title}</span>
      </button>
      <div className="px-3 pb-3">
        <p className="mb-2 text-xs text-ink-soft">{hint}</p>
        {open && <div className="max-h-72 overflow-auto">{children}</div>}
      </div>
    </div>
  )
}

const SKIP_ORDER: SkipReason[] = [
  'unknownSku',
  'noSku',
  'duplicate',
  'inactive',
  'negative',
  'badQty',
]

// Labels are translation keys — rendered through t() at the call site. i18n-key
const SKIP_LABEL: Record<SkipReason, string> = {
  unknownSku: 'รหัสสินค้าไม่มีในระบบ', // i18n-key
  noSku: 'ไม่มีรหัสสินค้า', // i18n-key
  duplicate: 'มีรหัสซ้ำในงวดและคลังเดียวกัน', // i18n-key
  inactive: 'สินค้าถูกปิดใช้งาน', // i18n-key
  negative: 'จำนวนติดลบ', // i18n-key
  badQty: 'อ่านจำนวนไม่ได้', // i18n-key
}

const SKIP_HINT: Record<SkipReason, string> = {
  unknownSku: 'รหัสต้องมาจากไฟล์รหัสสินค้าของบริษัท ระบบจะไม่สร้างรหัสใหม่เอง', // i18n-key
  noSku: 'แถวพวกนี้เป็นของระหว่างผลิต (WIP) ที่ยังไม่มีรหัสในไฟล์รหัสสินค้า', // i18n-key
  duplicate: 'ไฟล์ไม่ได้บอกว่าเป็นของกองเดียวกันหรือคนละกอง — รวมกันก็เกิน เอาอันเดียวก็ขาด', // i18n-key
  inactive: 'สินค้าถูกปิดใช้งานไว้ ระบบจะไม่เปิดกลับมาเองจากการนำเข้า', // i18n-key
  negative: 'ยอดคงเหลือติดลบไม่ได้', // i18n-key
  badQty: 'ช่องนั้นไม่ใช่ตัวเลข', // i18n-key
}

function toInputDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fromInputDate(v: string): number {
  if (!v) return 0
  const [y, m, d] = v.split('-').map(Number)
  if (!y || !m || !d) return 0
  return new Date(y, m - 1, d).getTime()
}

function sheetMatchesBrand(sheetName: string, key: string | undefined): boolean {
  if (!key) return false
  return sheetName.trim().toUpperCase() === key.toUpperCase()
}
