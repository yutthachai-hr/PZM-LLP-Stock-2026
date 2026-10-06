import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { DataTable, type Column } from '../../components/DataTable'
import { DraftNotice } from '../../components/DraftNotice'
import { ChipRow, FramePage, PageHero, SectionCard, StatRow, StatTile } from '../../components/frame'
import { Icon } from '../../components/Icon'
import { SubmitBar } from '../../components/keying/SubmitBar'
import { useToast } from '../../components/Toast'
import { AlertBanner, Button, Modal, SearchInput, blurOnWheel } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { movementCache } from '../../data/movementCache'
import { errText } from '../../i18n/AppError'
import { useT } from '../../i18n/I18nContext'
import { exportExcel } from '../../lib/export'
import { fmtMoney, fmtQty, formatThaiDateShort } from '../../lib/format'
import { bkkDayStart, DAY_MS } from '../../lib/inventoryRules/time'
import { balanceAtDayEnd } from '../../lib/ledger'
import { countRows, monthBefore, monthlyCountId, resultsOf, type CountRow } from '../../lib/monthlyCount'
import { looseMatch } from '../../lib/search'
import { useDraft } from '../../lib/useDraft'
import { getMonthlyCount, postMonthlyCount, recordMonthlyCount, saveCountLines } from '../../services/monthlyCounts'
import type { MonthlyCount, MonthlyCountResult, StockMovement } from '../../types'
import { LineImportModal } from '../../components/import/LineImportModal'
import { CountImport, type ImportedQuestion } from './CountImport'
import { QuestionsCard } from './QuestionsCard'
import { MonthLabel, StatusBadge } from './labels'

type Edits = Record<string, number | null>
type Filter = 'all' | 'diff' | 'big' | 'uncounted'

/** Far enough ahead to catch a row dated forward; day-aligned so the cache keeps one key. */
const horizon = () => bkkDayStart(Date.now()) + 400 * DAY_MS

/**
 * One monthly count sheet (owner, 29 Sep 2026). Figures are typed in, kept on this device
 * as they are typed (lib/useDraft — a tap that closes the page loses nothing), saved to the
 * sheet with one press, and compared with the books at the end of the month's last day.
 * Stock does not move until a manager confirms: either keeps it as a record, or files the
 * differences as one adjustment on that day.
 */
export function MonthlyCountSheet() {
  const t = useT()
  const toast = useToast()
  const { id = '' } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { products, locationById, qtyAt, tracksProduct, movements } = useData()
  const isManager = user?.role === 'admin' || user?.role === 'manager'
  const [sheet, setSheet] = useState<MonthlyCount | null | undefined>(undefined)
  const [last, setLast] = useState<Record<string, MonthlyCountResult> | undefined>(undefined)
  const [edits, setEdits] = useState<Edits>({})
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<'record' | 'post' | null>(null)
  const [importing, setImporting] = useState(false)
  const [photoImport, setPhotoImport] = useState(false)
  const [asOpening, setAsOpening] = useState(false)
  // Plan E2: the manager says they looked at the big differences before they are filed.
  const [bigOk, setBigOk] = useState(false)

  useEffect(() => {
    let alive = true
    getMonthlyCount(id)
      .then(async (s) => {
        if (!alive) return
        setSheet(s)
        if (!s) return
        const prev = await getMonthlyCount(monthlyCountId(s.locationId, monthBefore(s.month))).catch(() => null)
        if (alive && prev && prev.status !== 'counting') setLast(prev.results)
      })
      .catch((e) => {
        if (alive) setSheet(null)
        toast.error(errText(e, t))
      })
    return () => {
      alive = false
    }
  }, [id, toast, t])

  // What is typed and not yet saved stays on this device (the app's usual draft).
  const { restored, clear: clearDraft } = useDraft(
    `monthly-count:${id}`,
    { edits },
    (d) => setEdits(d.edits && typeof d.edits === 'object' ? d.edits : {}),
    (d) => !d.edits || Object.keys(d.edits).length === 0,
  )
  const pending = Object.keys(edits).length
  useEffect(() => {
    if (!pending) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])

  // ---- the books at the end of the month's last day ----
  const locationId = sheet?.locationId ?? ''
  const after = sheet ? sheet.countDate + DAY_MS : 0
  const backdated = !!sheet && after <= Date.now()
  const [later, setLater] = useState<{ after: number; rows: StockMovement[] } | null>(null)
  useEffect(() => {
    if (!backdated) return
    let alive = true
    movementCache
      .fetchRange(after, horizon())
      .then((rows) => alive && setLater({ after, rows }))
      .catch((e) => toast.error(errText(e, t)))
    return () => {
      alive = false
    }
  }, [backdated, after, toast, t])
  const ready = !backdated || later?.after === after
  const laterRows = useMemo(() => {
    if (!backdated || later?.after !== after) return []
    const byId = new Map(later.rows.map((m) => [m.id, m]))
    for (const m of movements) byId.set(m.id, m)
    return [...byId.values()]
  }, [backdated, later, after, movements])
  const systemAt = useCallback(
    (productId: string, rows: StockMovement[] = laterRows) =>
      !backdated ? qtyAt(locationId, productId) : balanceAtDayEnd(qtyAt(locationId, productId), rows, { productId, locationId }, after),
    [backdated, qtyAt, locationId, laterRows, after],
  )

  const counting = sheet?.status === 'counting'
  // Plan E2: on a blind sheet the counter sees only what they count; a manager reviews.
  const blind = !!sheet?.blind && counting && !isManager
  const lines = useMemo(() => {
    const out = { ...(sheet?.lines ?? {}) }
    for (const [pid, v] of Object.entries(edits)) {
      if (v === null) delete out[pid]
      else out[pid] = { qty: v, by: user?.id ?? '', byName: user?.name ?? '', at: 0 }
    }
    return out
  }, [sheet, edits, user])
  const productIds = useMemo(
    () => products.filter((p) => p.active !== false && locationId && tracksProduct(locationId, p.id)).map((p) => p.id),
    [products, locationId, tracksProduct],
  )
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const { rows, summary } = useMemo(() => {
    if (!sheet || !ready) return { rows: [] as CountRow[], summary: null }
    // A confirmed sheet shows what it was confirmed against, not today's books.
    const frozen = !counting ? sheet.results : undefined
    return countRows({
      productIds,
      lines,
      systemQty: (pid) => frozen?.[pid]?.systemQty ?? systemAt(pid),
      cost: (pid) => byId.get(pid)?.cost ?? 0,
      last,
    })
  }, [sheet, ready, counting, productIds, lines, systemAt, byId, last])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) =>
        filter === 'diff' ? !!r.diff : filter === 'big' ? r.big : filter === 'uncounted' ? r.countedQty === null : true,
      )
      .filter((r) => {
        if (!q) return true
        const p = byId.get(r.productId)
        return looseMatch([p?.name ?? '', p?.sku ?? '', p?.category ?? ''], q)
      })
      .sort((a, b) => {
        const pa = byId.get(a.productId)
        const pb = byId.get(b.productId)
        return (pa?.category ?? '').localeCompare(pb?.category ?? '') || (pa?.name ?? '').localeCompare(pb?.name ?? '')
      })
  }, [rows, filter, query, byId])

  const setCount = useCallback(
    (productId: string, value: number | null) => {
      setEdits((e) => {
        const saved = sheet?.lines[productId]?.qty ?? null
        const next = { ...e }
        if (value === saved) delete next[productId]
        else next[productId] = value
        return next
      })
    },
    [sheet],
  )

  const openQuestions = Object.keys(sheet?.questions ?? {}).length

  /** Questions are notes, not counts: they go to the sheet straight away, for everyone. */
  async function saveQuestions(questions: Record<string, ImportedQuestion | null>) {
    if (!user) return
    setBusy(true)
    try {
      setSheet(await saveCountLines({ id, changes: {}, questions, actor: { id: user.id, name: user.name } }))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!user || !pending) return
    setBusy(true)
    try {
      const changes: Record<string, { qty: number } | null> = {}
      for (const [pid, v] of Object.entries(edits)) changes[pid] = v === null ? null : { qty: v }
      const next = await saveCountLines({ id, changes, actor: { id: user.id, name: user.name } })
      setSheet(next)
      setEdits({})
      clearDraft()
      toast.success(t('บันทึกยอดนับแล้ว {n} รายการ — ยังไม่ปรับสต๊อก', { n: Object.keys(changes).length }))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  /** The books may have moved since the figures were read: read them again before confirming. */
  async function freshRows(): Promise<CountRow[]> {
    if (!backdated) return rows
    const fresh = await movementCache.fetchRange(after, horizon(), { force: true })
    const merged = new Map(fresh.map((m) => [m.id, m]))
    for (const m of movements) merged.set(m.id, m)
    const all = [...merged.values()]
    setLater({ after, rows: fresh })
    return countRows({
      productIds,
      lines,
      systemQty: (pid) => systemAt(pid, all),
      cost: (pid) => byId.get(pid)?.cost ?? 0,
      last,
    }).rows
  }

  async function confirm(kind: 'record' | 'post') {
    if (!user || !sheet) return
    setBusy(true)
    try {
      const now = await freshRows()
      const results = resultsOf(now)
      const actor = { id: user.id, name: user.name }
      if (kind === 'record') {
        await recordMonthlyCount({ id, results, actor })
        toast.success(t('บันทึกผลนับไว้แล้ว — สต๊อกไม่ถูกปรับ'))
      } else {
        // The sheet's own figures are posted; each difference is worked out again inside its
        // transaction from the books as they are then (plan A10, src/commands/countPost.ts).
        const docs = await postMonthlyCount({
          id,
          actor,
          reason: asOpening ? 'opening' : 'count',
          approveBig: bigOk,
          note: asOpening
            ? t('ตั้งยอดเริ่มต้นระบบจากยอดนับ {month}', { month: sheet.month })
            : t('นับสต๊อกประจำเดือน {month}', { month: sheet.month }),
        })
        toast.success(docs.length ? t('ปรับสต๊อกแล้ว: {docs}', { docs: docs.join(', ') }) : t('ยืนยันแล้ว — ไม่มีรายการที่ต้องปรับ'))
      }
      setAsking(null)
      setSheet(await getMonthlyCount(id))
    } catch (e) {
      toast.error(errText(e, t))
      setSheet(await getMonthlyCount(id).catch(() => sheet))
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<CountRow>[] = useMemo(
    () => ([
      {
        key: 'product',
        header: t('สินค้า'),
        primary: true,
        cell: (r) => {
          const p = byId.get(r.productId)
          return (
            <div className="min-w-0">
              <div className="font-medium text-ink">
                {p?.name ?? r.productId} {r.big && <span className="ml-1 rounded bg-danger-soft px-1.5 text-[11px] text-danger">{t('ต่างมาก')}</span>}
              </div>
              <div className="text-xs text-ink-faint">
                {p?.sku} · {p?.category}
              </div>
            </div>
          )
        },
      },
      {
        key: 'system',
        header: t('ระบบ ณ สิ้นเดือน'),
        align: 'right',
        cell: (r) => (
          <span className="num">
            {fmtQty(r.systemQty)} <span className="text-xs text-ink-faint">{byId.get(r.productId)?.unitType}</span>
          </span>
        ),
      },
      {
        key: 'counted',
        header: t('นับได้'),
        align: 'right',
        card: 'value',
        headerClassName: 'w-36',
        cell: (r) =>
          counting ? (
            <CountBox productId={r.productId} value={r.countedQty} onChange={setCount} label={byId.get(r.productId)?.name ?? ''} />
          ) : (
            <span className="num font-semibold">{r.countedQty === null ? '—' : fmtQty(r.countedQty)}</span>
          ),
      },
      {
        key: 'diff',
        header: t('ผลต่าง'),
        align: 'right',
        cell: (r) =>
          r.diff === null ? (
            <span className="text-xs text-ink-faint">{t('ยังไม่นับ')}</span>
          ) : (
            <span className={`num font-semibold ${r.diff < 0 ? 'text-danger' : r.diff > 0 ? 'text-in' : 'text-ink-faint'}`}>
              {r.diff > 0 ? '+' : ''}
              {fmtQty(r.diff)}
            </span>
          ),
      },
      {
        key: 'value',
        header: t('มูลค่า'),
        align: 'right',
        cell: (r) =>
          r.value === null || r.value === 0 ? (
            <span className="text-ink-faint">—</span>
          ) : (
            <span className={`num ${r.value < 0 ? 'text-danger' : 'text-in'}`}>{fmtMoney(r.value)}</span>
          ),
      },
      {
        key: 'last',
        header: t('เดือนก่อน'),
        align: 'right',
        cell: (r) => <span className="num text-ink-faint">{r.lastDiff === undefined ? '—' : `${r.lastDiff > 0 ? '+' : ''}${fmtQty(r.lastDiff)}`}</span>,
      },
    ] satisfies Column<CountRow>[]).filter((c) => !blind || c.key === 'product' || c.key === 'counted'),
    [t, byId, counting, setCount, blind],
  )

  if (sheet === undefined) return <p className="p-6 text-sm text-ink-faint">{t('กำลังโหลด...')}</p>
  if (sheet === null)
    return (
      <FramePage>
        <AlertBanner>{t('ไม่พบใบนับนี้')}</AlertBanner>
        <Link to="/counts" className="text-sm text-brand hover:underline">
          {t('กลับไปหน้านับสต๊อกประจำเดือน')}
        </Link>
      </FramePage>
    )

  const dayLabel = formatThaiDateShort(sheet.countDate)
  const monthOver = bkkDayStart(Date.now()) >= sheet.countDate
  const toPost = rows.filter((r) => r.diff).length

  function download() {
    exportExcel(`monthly-count-${sheet!.id}`, t('นับสต๊อก'), shown.map((r) => {
      const p = byId.get(r.productId)
      return {
        SKU: p?.sku ?? '',
        [t('สินค้า')]: p?.name ?? r.productId,
        [t('หน่วย')]: p?.unitType ?? '',
        ...(blind ? {} : { [t('ระบบ ณ สิ้นเดือน')]: r.systemQty }),
        [t('นับได้')]: r.countedQty ?? '',
        ...(blind ? {} : { [t('ผลต่าง')]: r.diff ?? '', [t('มูลค่า')]: r.value ?? '', [t('เดือนก่อน')]: r.lastDiff ?? '' }),
      }
    }))
  }

  return (
    <FramePage>
      <PageHero
        icon="clipboardList"
        title={t('นับสต๊อกประจำเดือน')}
        subtitle={
          <>
            <MonthLabel month={sheet.month} /> · {locationById(sheet.locationId)?.name ?? sheet.locationId} · <StatusBadge status={sheet.status} />
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {counting && (
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <Icon name="upload" size={16} />
                {t('นำเข้าจาก Excel')}
              </Button>
            )}
            {counting && (
              <Button variant="secondary" onClick={() => setPhotoImport(true)}>
                <Icon name="camera" size={16} />
                {t('อ่านใบนับ (รูป / PDF)')}
              </Button>
            )}
            <Link to="/counts" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-ink-soft hover:bg-sunken">
              <Icon name="chevronLeft" size={16} />
              {t('ใบนับทั้งหมด')}
            </Link>
            <Button variant="secondary" onClick={download} disabled={!ready}>
              <Icon name="download" size={16} />
              Excel
            </Button>
          </div>
        }
      />

      {restored && counting && <DraftNotice onDiscard={() => { setEdits({}); clearDraft() }} />}

      {blind ? (
        <AlertBanner tone="info" icon="info">
          {t('นับแบบไม่เห็นยอด — ใส่จำนวนที่นับได้จริงทุกช่อง ช่องที่เว้นว่าง = ยังไม่นับ หัวหน้าจะเทียบกับยอดในระบบตอนตรวจ')}
        </AlertBanner>
      ) : counting ? (
        <AlertBanner tone="info" icon="info">
          {t('ยอดที่คีย์ยังไม่ปรับสต๊อก — ผลต่างเทียบกับยอดในระบบ ณ สิ้นวัน {date} ช่องที่เว้นว่าง = ยังไม่นับ (ไม่ถูกปรับ) ใส่ 0 ถ้านับแล้วไม่มีของ', { date: dayLabel })}
        </AlertBanner>
      ) : sheet.status === 'recorded' ? (
        <AlertBanner tone="info" icon="checkCircle">
          {t('บันทึกผลนับไว้ดูแล้ว โดย {name} — สต๊อกไม่ถูกปรับ', { name: sheet.confirmedByName ?? '' })}
        </AlertBanner>
      ) : (
        <AlertBanner tone={sheet.status === 'posting' ? 'warn' : 'info'} icon="checkCircle">
          {sheet.status === 'posting'
            ? t('ปรับสต๊อกไปแล้วบางส่วน — กด "ยืนยันและปรับสต๊อก" อีกครั้งเพื่อทำต่อ')
            : t('ปรับสต๊อกแล้ว ลงวันที่ {date} โดย {name}', { date: dayLabel, name: sheet.confirmedByName ?? '' })}{' '}
          {(sheet.adjDocNos ?? []).map((d) => (
            <Link key={d} to={`/movements?doc=${encodeURIComponent(d)}`} className="ml-1 font-semibold underline">
              {d}
            </Link>
          ))}
        </AlertBanner>
      )}

      {summary && blind && (
        <StatRow columns={4}>
          <StatTile icon="clipboardList" label={t('นับแล้ว')} value={`${summary.counted} / ${summary.total}`} />
        </StatRow>
      )}
      {summary && !blind && (
        <StatRow columns={4}>
          <StatTile icon="clipboardList" label={t('นับแล้ว')} value={`${summary.counted} / ${summary.total}`} />
          <StatTile icon="adjust" label={t('มีผลต่าง')} value={summary.withDiff} tone="amber" />
          <StatTile icon="trendDown" label={t('มูลค่าขาด')} value={fmtMoney(summary.shortValue)} tone="red" />
          <StatTile icon="trendUp" label={t('มูลค่าเกิน')} value={fmtMoney(summary.overValue)} tone="green" />
        </StatRow>
      )}

      {Object.keys(sheet.questions ?? {}).length > 0 && (
        <QuestionsCard
          questions={sheet.questions ?? {}}
          products={products}
          editable={counting}
          busy={busy}
          onAnswer={async (key, answer) => {
            if (answer) setCount(answer.productId, answer.qty)
            await saveQuestions({ [key]: null })
          }}
        />
      )}

      <SectionCard icon="package" title={t('รายการนับ')} count={shown.length} flush>
        <div className="flex flex-wrap items-center gap-3 px-4 pb-3 pt-1 md:px-5">
          <ChipRow
            label={t('ตัวกรอง')}
            value={filter}
            onChange={setFilter}
            chips={[
              { key: 'all' as Filter, label: t('ทั้งหมด'), count: summary?.total },
              { key: 'diff' as Filter, label: t('มีผลต่าง'), count: summary?.withDiff },
              { key: 'big' as Filter, label: t('ต่างมาก'), count: summary?.big },
              { key: 'uncounted' as Filter, label: t('ยังไม่นับ'), count: summary ? summary.total - summary.counted : undefined },
            ].filter((c) => !blind || c.key === 'all' || c.key === 'uncounted')}
          />
          <SearchInput value={query} onChange={setQuery} placeholder={t('ค้นหาสินค้า...')} className="w-full sm:ml-auto sm:w-72" />
        </div>
        {!ready ? (
          <p className="px-5 py-6 text-sm text-ink-faint">{t('กำลังคำนวณยอด ณ สิ้นเดือน...')}</p>
        ) : (
          <DataTable rows={shown} columns={columns} rowKey={(r) => r.productId} minWidth={820} empty={<p className="px-5 py-6 text-sm text-ink-faint">{t('ไม่มีรายการ')}</p>} />
        )}
      </SectionCard>

      {/* A manager's two decisions: beside the save button from a tablet up; on a phone,
          stacked under the list, where each label has the full width to be read. */}
      {isManager && sheet.status !== 'posted' && (
        <div className="grid gap-2 md:hidden">
          {counting && (
            <Button variant="secondary" onClick={() => setAsking('record')} disabled={busy || !!pending || !monthOver || !summary?.counted || openQuestions > 0}>
              {t('บันทึกผลนับไว้ดู (ไม่ปรับ)')}
            </Button>
          )}
          <Button onClick={() => setAsking('post')} disabled={busy || !!pending || !monthOver || !summary?.counted || openQuestions > 0}>
            <Icon name="checkCircle" size={16} />
            {t('ยืนยันและปรับสต๊อก')}
          </Button>
        </div>
      )}
      {(counting || (isManager && sheet.status !== 'posted')) && (
        <SubmitBar hasDraft={pending > 0}>
          {counting && (
            <Button variant={isManager ? 'secondary' : 'primary'} onClick={() => void save()} disabled={busy || !pending}>
              <Icon name="check" size={16} />
              {t('บันทึกยอดนับ ({n})', { n: pending })}
            </Button>
          )}
          {isManager && sheet.status !== 'posted' && (
            <span className="hidden gap-2 md:flex">
              {counting && (
                <Button variant="secondary" onClick={() => setAsking('record')} disabled={busy || !!pending || !monthOver || !summary?.counted || openQuestions > 0}>
                  {t('บันทึกผลนับไว้ดู (ไม่ปรับ)')}
                </Button>
              )}
              <Button onClick={() => setAsking('post')} disabled={busy || !!pending || !monthOver || !summary?.counted || openQuestions > 0}>
                <Icon name="checkCircle" size={16} />
                {t('ยืนยันและปรับสต๊อก')}
              </Button>
            </span>
          )}
        </SubmitBar>
      )}
      {openQuestions > 0 && counting && (
        <p className="text-xs text-warn">{t('ยังมีคำถามจากไฟล์ {n} รายการ — ตอบให้ครบก่อนยืนยันใบนับ', { n: openQuestions })}</p>
      )}
      {isManager && !monthOver && sheet.status !== 'posted' && (
        <p className="text-xs text-ink-faint">{t('ยืนยันได้ตั้งแต่วันสุดท้ายของเดือน ({date})', { date: dayLabel })}</p>
      )}

      <Modal open={asking !== null} onClose={() => !busy && setAsking(null)} title={asking === 'post' ? t('ยืนยันและปรับสต๊อก') : t('บันทึกผลนับไว้ดู (ไม่ปรับ)')} compact>
        <div className="space-y-3 text-sm text-ink">
          {asking === 'post' ? (
            <>
              <p>
                {t('ระบบจะปรับ {n} รายการที่มีผลต่าง เป็นใบปรับสต๊อกลงวันที่ {date} เหตุผล "ปรับตามการนับ" — รายการรับ/เบิก/โอนหลังวันนั้นอยู่ครบ รายการที่ยังไม่นับจะไม่ถูกปรับ', { n: toPost, date: dayLabel })}
              </p>
              {!asOpening && (summary?.big ?? 0) > 0 && (
                <label className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={bigOk} onChange={(e) => setBigOk(e.target.checked)} />
                  <span>
                    <b>{t('ตรวจผลต่างมาก {n} รายการแล้ว อนุมัติให้ปรับ', { n: summary?.big ?? 0 })}</b>
                    <span className="block text-xs text-ink-soft">
                      {t('ผลต่างเกิน 10% ของยอดในระบบ หรือเกิน 500 บาท — ดูได้จากตัวกรอง "ต่างมาก" ชื่อผู้อนุมัติจะถูกบันทึกไว้กับผลนับ')}
                    </span>
                  </span>
                </label>
              )}
              <label className="flex items-start gap-2 rounded-lg border border-line bg-sunken px-3 py-2">
                <input type="checkbox" className="mt-1" checked={asOpening} onChange={(e) => setAsOpening(e.target.checked)} />
                <span>
                  <b>{t('ตั้งยอดเริ่มต้นระบบ')}</b>
                  <span className="block text-xs text-ink-soft">
                    {t('ใช้ครั้งแรกที่เริ่มใช้ระบบจริง — ลงเหตุผลเป็น "ตั้งยอด/ยอดยกมา" แทน "ปรับตามการนับ" ผลต่างจากช่วงทดลองระบบจะไม่ถูกนับเป็นของหาย/ของเสียในรายงาน')}
                  </span>
                </span>
              </label>
            </>
          ) : (
            <p>{t('เก็บผลนับไว้เป็นประวัติ สต๊อกไม่ถูกปรับ และแก้ยอดนับในใบนี้ไม่ได้อีก — กดยืนยันและปรับสต๊อกทีหลังได้')}</p>
          )}
          {summary && (
            <p className="text-ink-soft">
              {t('นับแล้ว {n} รายการ · ขาด {short} · เกิน {over}', { n: summary.counted, short: fmtMoney(summary.shortValue), over: fmtMoney(summary.overValue) })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAsking(null)} disabled={busy}>
              {t('ยกเลิก')}
            </Button>
            <Button onClick={() => asking && void confirm(asking)} disabled={busy || (asking === 'post' && !asOpening && (summary?.big ?? 0) > 0 && !bigOk)}>
              {busy ? t('กำลังบันทึก...') : t('ยืนยัน')}
            </Button>
          </div>
        </div>
      </Modal>
      {photoImport && (
        // A photographed or scanned count sheet, read by AI: each counted line fills its box,
        // and the person reviews the sheet before confirming as always.
        <LineImportModal
          title={t('อ่านใบนับสต๊อก')}
          products={products}
          onClose={() => setPhotoImport(false)}
          onImport={(imported) => {
            for (const i of imported) setCount(i.product.id, i.qty)
          }}
        />
      )}
      {importing && (
        <CountImport
          open
          draftKey={id}
          onClose={() => setImporting(false)}
          locationName={locationById(sheet.locationId)?.name ?? ''}
          month={sheet.month}
          products={products}
          existing={Object.fromEntries(Object.entries(lines).map(([pid, l]) => [pid, l.qty]))}
          onApply={async ({ counts, questions }) => {
            for (const [pid, qty] of Object.entries(counts)) setCount(pid, qty)
            if (Object.keys(questions).length) await saveQuestions(questions)
          }}
        />
      )}
    </FramePage>
  )
}

/**
 * The counted figure, in the product's own unit. Empty is "not counted" — kept apart from 0,
 * which is a real count of an empty shelf. Memoised: a sheet has hundreds of these and only
 * the one being typed in should re-render.
 */
const CountBox = memo(function CountBox({
  productId,
  value,
  onChange,
  label,
}: {
  productId: string
  value: number | null
  onChange: (productId: string, value: number | null) => void
  label: string
}) {
  const t = useT()
  const [text, setText] = useState(value === null ? '' : String(value))
  useEffect(() => {
    const n = text === '' ? null : Number(text)
    if (n !== value) setText(value === null ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      value={text}
      onWheel={blurOnWheel}
      aria-label={t('จำนวนที่นับได้ของ "{name}"', { name: label })}
      onChange={(e) => {
        setText(e.target.value)
        const v = e.target.value.trim()
        const n = Number(v)
        onChange(productId, v === '' ? null : Number.isFinite(n) && n >= 0 ? n : null)
      }}
      className="num min-h-11 w-28 rounded-lg border border-line-strong px-3 text-right text-base font-semibold outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
    />
  )
})
