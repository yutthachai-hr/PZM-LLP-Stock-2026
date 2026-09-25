import { useEffect, useMemo, useRef, useState } from 'react'
import { SiteSelect } from '../components/SiteChip'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Field, Input, Select, blurOnWheel } from '../components/ui'
import { ChipRow, FramePage, PageHero, SectionCard, StatRow, StatTile, WithSidePanel } from '../components/frame'
import { Icon } from '../components/Icon'
import { ProductThumb } from '../components/ProductThumb'
import { QtySheet } from '../components/QtySheet'
import { KeyingSide } from '../components/keying/KeyingSide'
import { SubmitBar } from '../components/keying/SubmitBar'
import { adjustStockLines, type AdjustLine } from '../services/stock'
import { deliver } from '../services/notifications'
import { useScheduleConfig } from '../services/schedules'
import { significance } from '../lib/inventoryRules/adjustments'
import { adjustmentDraft } from '../lib/inventoryRules/notifications'
import { bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { change } from '../lib/stats/periodCompare'
import { dateInputToMs, fmtMoney, fmtQty, msToDateInput, todayMs } from '../lib/format'
import { roundQty } from '../lib/validate'
import { describeQty } from '../lib/uom'
import { ADJUST_REASONS, type Product } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { looseMatch, looseScore } from '../lib/search'
import { findByBarcode, searchFields } from '../lib/barcode'
import { BarcodeScanner } from '../components/BarcodeScanner'
import { useViewport } from '../lib/viewport'
import { useDraft } from '../lib/useDraft'
import { DraftNotice } from '../components/DraftNotice'

/** Enough of the list that the item wanted is on it; the box scrolls. */
const MAX_MATCHES = 40

/**
 * One product on the adjustment document.
 *
 * A row is either a count ("there are 8 on the shelf" — the difference from the system is
 * worked out, and follows the balance if it moves while the form is open) or a change
 * ("2 broken"). Whichever box the person typed in last is the one that holds; the other is
 * shown from it.
 */
interface AdjRow {
  productId: string
  productName: string
  unit: string
  mode: 'count' | 'delta'
  /** The count, or the signed change, in the product's own unit. Null = not keyed yet. */
  value: number | null
  reason: string
  note?: string
  /** As keyed on a phone in another unit — only for a `delta` row. */
  entryUnit?: string
  entryQty?: number
}

function deltaOf(r: AdjRow, system: number): number {
  if (r.value === null) return 0
  return roundQty(r.mode === 'count' ? r.value - system : r.value)
}

/**
 * ปรับสต๊อก, many products at once (owner's mock-up 04, spec §2.5). Filing is immediate —
 * no approval step (owner, 22 Sep) — and every row is still its own `adjust` movement,
 * all under one ADJ- number (services/stock.ts adjustStockLines).
 */
export function AdjustPage() {
  const t = useT()
  const { products, locations, qtyAt, movements } = useData()
  const { user } = useAuth()
  const toast = useToast()
  const { settings } = useScheduleConfig()
  const phone = useViewport() === 'phone'

  const active = useMemo(() => locations.filter((l) => l.active !== false), [locations])
  const [locationId, setLocationId] = useState('')
  const [dateStr, setDateStr] = useState(msToDateInput(todayMs()))
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<AdjRow[]>([])
  const [defaultReason, setDefaultReason] = useState<string>('count')
  const [search, setSearch] = useState('')
  const [sheetFor, setSheetFor] = useState<Product | null>(null)
  const [sheetDir, setSheetDir] = useState<'in' | 'out'>('out')
  const [sheetReason, setSheetReason] = useState<string>('count')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // A half-keyed count survives leaving the screen (lib/useDraft.ts).
  const draft = useMemo(() => ({ locationId, dateStr, note, rows }), [locationId, dateStr, note, rows])
  const isEmpty = (d: typeof draft) => d.rows.length === 0 && !d.note.trim()
  const { restored, clear: clearDraft } = useDraft(
    'adjust-lines',
    draft,
    (d) => {
      if (d.locationId) setLocationId(d.locationId)
      if (d.dateStr) setDateStr(d.dateStr)
      setNote(d.note ?? '')
      setRows(Array.isArray(d.rows) ? d.rows : [])
    },
    isEmpty,
  )
  function discardDraft() {
    setRows([])
    setNote('')
    clearDraft()
  }

  useEffect(() => {
    if (!locationId && active[0]) setLocationId(active[0].id)
  }, [locationId, active])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const system = (productId: string) => (locationId ? qtyAt(locationId, productId) : 0)

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    const chosen = new Set(rows.map((r) => r.productId))
    return products
      .filter((p) => p.active !== false && (phone || !chosen.has(p.id)))
      .filter((p) => looseMatch(searchFields(p), q))
      .sort((a, b) => looseScore([b.name, b.sku], q) - looseScore([a.name, a.sku], q))
      .slice(0, MAX_MATCHES)
  }, [search, products, rows, phone])

  function add(p: Product) {
    setSearch('')
    if (phone) {
      const existing = rows.find((r) => r.productId === p.id)
      setSheetDir(existing && existing.value !== null && deltaOf(existing, system(p.id)) > 0 ? 'in' : 'out')
      setSheetReason(existing?.reason ?? defaultReason)
      setSheetFor(p)
      return
    }
    setRows((rs) => [...rs, { productId: p.id, productName: p.name, unit: p.unitType, mode: 'count', value: null, reason: defaultReason }])
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  function scanned(code: string) {
    setScanning(false)
    const hit = findByBarcode(products, code)
    if (hit) add(hit)
    else setSearch(code)
  }

  const patch = (id: string, p: Partial<AdjRow>) => setRows((rs) => rs.map((r) => (r.productId === id ? { ...r, ...p } : r)))
  const remove = (id: string) => setRows((rs) => rs.filter((r) => r.productId !== id))

  const valueOf = (r: AdjRow) => deltaOf(r, system(r.productId)) * (productById.get(r.productId)?.cost ?? 0)
  const totalValue = rows.reduce((s, r) => s + valueOf(r), 0)
  const bad = rows.find((r) => r.mode === 'count' && r.value !== null && r.value < 0)
  const toFile = rows.filter((r) => deltaOf(r, system(r.productId)) !== 0)

  // ---- today, for the figures at the top ----
  const today = useMemo(() => {
    const day = bkkDayStart(dateInputToMs(dateStr))
    const on = (d: number) => movements.filter((m) => m.type === 'adjust' && !m.voided && bkkDayStart(m.date) === d)
    const cost = (id: string) => productById.get(id)?.cost ?? 0
    const rowsToday = on(day)
    const up = rowsToday.filter((m) => !!m.toLocationId)
    const down = rowsToday.filter((m) => !!m.fromLocationId)
    return {
      docs: new Set(rowsToday.map((m) => m.docNo)).size,
      docsYesterday: new Set(on(day - DAY_MS).map((m) => m.docNo)).size,
      up: up.length,
      upValue: up.reduce((s, m) => s + m.qty * cost(m.productId), 0),
      down: down.length,
      downValue: down.reduce((s, m) => s + m.qty * cost(m.productId), 0),
    }
  }, [movements, dateStr, productById])

  async function submit() {
    if (!locationId) return toast.error(t('เลือกคลัง'))
    if (rows.length === 0) return toast.error(t('เพิ่มรายการสินค้าก่อน'))
    if (bad) return toast.error(t('จำนวนที่นับได้ของ "{name}" ติดลบไม่ได้', { name: bad.productName }))
    if (toFile.length === 0) return toast.error(t('ยังไม่มีบรรทัดที่ยอดเปลี่ยน — ใส่จำนวนที่นับได้หรือจำนวนที่ปรับ'))
    const lines: AdjustLine[] = toFile.map((r) => {
      const d = deltaOf(r, system(r.productId))
      return {
        productId: r.productId,
        productName: r.productName,
        unit: r.unit,
        ...(r.mode === 'delta' && r.entryUnit && r.entryQty ? { entryUnit: r.entryUnit, entryQty: r.entryQty } : {}),
        direction: d > 0 ? 'in' : 'out',
        qty: Math.abs(d),
        reason: r.reason,
        note: r.note?.trim() || undefined,
      }
    })
    setBusy(true)
    try {
      const docNo = await adjustStockLines({
        lines,
        locationId,
        date: dateInputToMs(dateStr),
        actor: { id: user!.id, name: user!.name },
        note: note.trim() || undefined,
      })
      toast.success(t('ปรับสต๊อกเรียบร้อย (เลขที่ {docNo})', { docNo }))
      // A large adjustment or waste is told to the managers now, not at the next job run —
      // one notice per line, as when lines were filed one at a time.
      for (const l of lines) {
        const product = productById.get(l.productId)
        const moved = { docNo, productId: l.productId, productName: l.productName, qty: l.qty, unit: l.unit, reason: l.reason, byUserName: user!.name,
          ...(l.direction === 'out' ? { fromLocationId: locationId } : { toLocationId: locationId }) }
        const before = system(l.productId)
        const now = l.direction === 'out' ? before - l.qty : before + l.qty
        const sig = significance({ ...moved, id: docNo, type: 'adjust', date: Date.now(), byUserId: user!.id, createdAt: Date.now() }, product, now, settings)
        if (sig) void deliver(adjustmentDraft(moved, sig.kind, sig.value, (id) => locations.find((x) => x.id === id)?.name ?? ''), { id: user!.id })
      }
      setRows([])
      setNote('')
      clearDraft()
      setTimeout(() => searchRef.current?.focus(), 0)
    } catch (e) {
      toast.error(t('บันทึกไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const reasonChips = ADJUST_REASONS.map((r) => ({ key: r.value as string, label: t(r.label) }))
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtQty(Math.abs(n))}`
  const money = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}฿ ${fmtMoney(Math.abs(n))}` // i18n-key
  const docTrend = change(today.docs, today.docsYesterday, { unit: t('ใบ') })
  const day = dateInputToMs(dateStr)

  return (
    <FramePage>
      <PageHero
        icon="adjust"
        tone="warn"
        title={t('ปรับสต๊อก')}
        subtitle={t('ปรับปรุงจำนวนสินค้าคงคลัง กรณีสินค้าสูญหาย ชำรุด หมดอายุ หรือนับสต๊อก')}
      />

      <StatRow columns={4}>
        <StatTile
          icon="box"
          tone="red"
          label={t('รายการปรับสต๊อกวันนี้')}
          value={today.docs}
          unit={t('ใบ')}
          trend={docTrend.flat ? undefined : { text: docTrend.text, up: docTrend.up, suffix: t('จากเมื่อวาน'), goodWhenUp: false }}
          hint={t('เมื่อวาน {n} ใบ', { n: today.docsYesterday })}
        />
        <StatTile icon="checkCircle" tone="green" valueTone="green" label={t('ปรับเพิ่ม')} value={`+${today.up}`} unit={t('รายการ')} hint={t('มูลค่า {v} บาท', { v: fmtMoney(today.upValue) })} />
        <StatTile icon="arrowDown" tone="red" valueTone="red" label={t('ปรับลด')} value={`−${today.down}`} unit={t('รายการ')} hint={t('มูลค่า {v} บาท', { v: fmtMoney(today.downValue) })} />
        <StatTile
          icon="chart"
          tone="blue"
          label={t('มูลค่ารวมที่ปรับวันนี้')}
          value={money(today.upValue - today.downValue)}
          valueTone={today.upValue - today.downValue < 0 ? 'red' : undefined}
          hint={t('อิงต้นทุนที่กรอก')}
        />
      </StatRow>

      <WithSidePanel
        side={
          <KeyingSide
            kind="adjust"
            day={day}
            title={t('สรุปการปรับสต๊อก')}
            todayTitle={t('ปรับสต๊อกที่ทำวันนี้')}
            tips={
              <ul className="list-disc space-y-1 pl-4">
                <li>{t('นับของจริงแล้วใส่ "จำนวนที่นับได้" — ระบบคำนวณปรับเพิ่ม/ลดให้')}</li>
                <li>{t('ของเสียทีละไม่กี่ชิ้น ใส่ในช่อง "ปรับเพิ่ม/ลด" ได้ตรง ๆ เช่น −2')}</li>
                <li>{t('บันทึกแล้วมีผลทันที ทุกบรรทัดอยู่ใต้เลขที่ใบเดียวกัน')}</li>
              </ul>
            }
          />
        }
      >
        {restored && <DraftNotice onDiscard={discardDraft} />}

        <SectionCard icon="note" title={t('สร้างรายการปรับสต๊อก')}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <Field label={t('คลัง/สาขา')} required>
              <SiteSelect value={locationId} onChange={setLocationId} locations={active} />
            </Field>
            <Field label={t('วันที่ปรับสต๊อก')} required>
              <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </Field>
            <Field label={t('ผู้รับผิดชอบ (บันทึกอัตโนมัติ)')} className="hidden md:block">
              <Input value={user?.name ?? ''} disabled />
            </Field>
            <Field label={t('หมายเหตุ (ถ้ามี)')} className="col-span-2 md:col-span-1">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('เช่น ตรวจนับประจำเดือน, สินค้าชำรุด')} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          icon="package"
          title={t('รายการสินค้าที่ปรับสต๊อก')}
          count={rows.length ? t('({n} รายการ)', { n: rows.length }) : undefined}
        >
          <div className="space-y-3">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
                <Icon name="search" size={18} />
              </span>
              <Input
                ref={searchRef}
                className="pl-10"
                placeholder={t('ค้นหาสินค้าเพื่อเพิ่มรายการ (ชื่อ / รหัสสินค้า)')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches[0]) {
                    e.preventDefault()
                    add(matches[0])
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
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
                      onClick={() => add(p)}
                      className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm hover:bg-sunken"
                    >
                      <ProductThumb productId={p.id} hasImage={p.hasImage} size={32} zoom={false} />
                      <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                      <span className="doc-no shrink-0 text-xs text-ink-faint">{p.sku}</span>
                      <span className="num shrink-0 text-xs text-ink-soft">
                        {fmtQty(system(p.id))} {p.unitType}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-soft">
                {t('ยังไม่มีรายการ — ค้นหาด้านบนเพื่อเพิ่มสินค้า')}
              </div>
            ) : phone ? (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {rows.map((r) => {
                  const d = deltaOf(r, system(r.productId))
                  const p = productById.get(r.productId)
                  return (
                    <li key={r.productId}>
                      <button
                        type="button"
                        onClick={() => p && add(p)}
                        className="flex w-full items-center gap-3 p-3 text-left active:bg-sunken"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-ink">{r.productName}</div>
                          <div className="text-xs text-ink-soft">
                            {t('ในระบบ')} <span className="num">{fmtQty(system(r.productId))}</span> {r.unit} ·{' '}
                            {t(ADJUST_REASONS.find((x) => x.value === r.reason)?.label ?? r.reason)}
                          </div>
                        </div>
                        <span className={`num shrink-0 text-base font-bold ${d > 0 ? 'text-in' : d < 0 ? 'text-out' : 'text-ink-faint'}`}>
                          {r.entryUnit && r.entryQty ? `${d > 0 ? '+' : '−'}${describeQty({ qty: Math.abs(d), entryQty: r.entryQty, entryUnit: r.entryUnit, unit: r.unit }, fmtQty)}` : `${signed(d)} ${r.unit}`}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation()
                            remove(r.productId)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              remove(r.productId)
                            }
                          }}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-faint active:bg-danger-soft active:text-danger"
                          aria-label={t('ลบ "{name}" ออกจากรายการ', { name: r.productName })}
                        >
                          <Icon name="x" size={18} />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[640px] table-fixed text-sm">
                  <thead className="bg-sunken text-left text-[13px] text-ink-soft">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">{t('สินค้า')}</th>
                      <th className="w-20 px-2 py-2.5 text-right font-semibold">{t('จำนวนในระบบ')}</th>
                      <th className="w-24 px-2 py-2.5 font-semibold">{t('จำนวนที่นับได้')}</th>
                      <th className="w-24 px-2 py-2.5 font-semibold">{t('ปรับเพิ่ม/ลด')}</th>
                      <th className="w-36 px-2 py-2.5 font-semibold">{t('เหตุผลในการปรับ')}</th>
                      <th className="w-24 px-2 py-2.5 text-right font-semibold">{t('มูลค่าที่เปลี่ยนแปลง')}</th>
                      <th className="w-14 px-1 py-2.5">
                        <span className="sr-only">{t('ลบ')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => {
                      const sys = system(r.productId)
                      const d = deltaOf(r, sys)
                      const counted = r.value === null ? '' : r.mode === 'count' ? String(r.value) : String(roundQty(sys + r.value))
                      const deltaText = r.value === null ? '' : r.mode === 'delta' ? String(r.value) : String(d)
                      const v = valueOf(r)
                      const p = productById.get(r.productId)
                      const negative = r.value !== null && sys + d < 0
                      return (
                        <tr key={r.productId} className={negative ? 'bg-danger-soft/40' : ''}>
                          <td className="px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2.5">
                              {p && <ProductThumb productId={p.id} hasImage={p.hasImage} size={36} />}
                              <div className="min-w-0">
                                <div className="truncate font-medium text-ink" title={r.productName}>{r.productName}</div>
                                <div className="doc-no truncate text-xs text-ink-faint">{p?.sku}</div>
                              </div>
                            </div>
                          </td>
                          <td className="num px-2 py-2 text-right text-ink-soft">
                            {fmtQty(sys)} <span className="text-xs">{r.unit}</span>
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              min={0}
                              value={counted}
                              onWheel={blurOnWheel}
                              onChange={(e) => patch(r.productId, { mode: 'count', value: e.target.value === '' ? null : Number(e.target.value), entryUnit: undefined, entryQty: undefined })}
                              className="num text-right"
                              aria-label={t('จำนวนที่นับได้ของ "{name}"', { name: r.productName })}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              value={deltaText}
                              onWheel={blurOnWheel}
                              onChange={(e) => patch(r.productId, { mode: 'delta', value: e.target.value === '' ? null : Number(e.target.value), entryUnit: undefined, entryQty: undefined })}
                              className={`num text-right font-semibold ${d > 0 ? '!text-in' : d < 0 ? '!text-out' : ''}`}
                              aria-label={t('จำนวนที่ปรับของ "{name}"', { name: r.productName })}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Select value={r.reason} onChange={(e) => patch(r.productId, { reason: e.target.value })} aria-label={t('เหตุผล')}>
                              {ADJUST_REASONS.map((x) => (
                                <option key={x.value} value={x.value}>
                                  {t(x.label)}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className={`num whitespace-nowrap px-2 py-2 text-right font-semibold ${v > 0 ? 'text-in' : v < 0 ? 'text-out' : 'text-ink-faint'}`}>
                            {p?.cost ? money(v) : '–'}
                          </td>
                          <td className="px-1 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => remove(r.productId)}
                              className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-danger/80 hover:bg-danger-soft hover:text-danger"
                              aria-label={t('ลบ "{name}" ออกจากรายการ', { name: r.productName })}
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

            {rows.length > 0 && (
              <div className="flex items-center justify-end gap-3 text-sm">
                <span className="text-ink-soft">{t('รวมการเปลี่ยนแปลงมูลค่า')}</span>
                <span className={`num text-xl font-bold ${totalValue < 0 ? 'text-out' : totalValue > 0 ? 'text-in' : 'text-ink'}`}>
                  {money(totalValue)}
                </span>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard icon="info" title={t('เหตุผลในการปรับสต๊อก')}>
          <p className="mb-3 text-sm text-ink-soft">{t('เลือกเหตุผลที่ใช้กับสินค้าที่เพิ่มต่อจากนี้ — กดอีกครั้งเพื่อใช้กับทุกบรรทัดที่มีอยู่')}</p>
          <ChipRow
            label={t('เหตุผลในการปรับสต๊อก')}
            chips={reasonChips}
            value={defaultReason}
            onChange={(k) => {
              if (k === defaultReason) setRows((rs) => rs.map((r) => ({ ...r, reason: k })))
              setDefaultReason(k)
            }}
          />
        </SectionCard>

        <SubmitBar hasDraft={!isEmpty(draft)}>
          <Button variant="secondary" onClick={discardDraft} disabled={busy || isEmpty(draft)} className="hidden sm:inline-flex">
            <Icon name="trash" size={16} />
            {t('ยกเลิกรายการ')}
          </Button>
          <Button onClick={submit} disabled={busy || toFile.length === 0 || !!bad} className="w-full sm:w-auto sm:min-w-64">
            <Icon name="check" size={18} />
            {busy ? t('กำลังบันทึก...') : t('บันทึกการปรับสต๊อก ({n} รายการ)', { n: toFile.length })}
          </Button>
        </SubmitBar>
      </WithSidePanel>

      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onRead={scanned} />

      {phone && (
        <QtySheet
          open={!!sheetFor}
          product={sheetFor}
          initial={(() => {
            const r = sheetFor && rows.find((x) => x.productId === sheetFor.id)
            if (!r || r.value === null) return undefined
            const d = Math.abs(deltaOf(r, system(r.productId)))
            return r.entryUnit && r.entryQty ? { qty: d, entryQty: r.entryQty, entryUnit: r.entryUnit } : { qty: d }
          })()}
          available={sheetFor && sheetDir === 'out' ? system(sheetFor.id) : undefined}
          direction={sheetDir}
          submitLabel={t('ตกลง')}
          extra={
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('ทิศทาง')}>
                <Select value={sheetDir} onChange={(e) => setSheetDir(e.target.value as 'in' | 'out')}>
                  <option value="out">{t('ลดออก (−)')}</option>
                  <option value="in">{t('เพิ่มเข้า (+)')}</option>
                </Select>
              </Field>
              <Field label={t('เหตุผล')}>
                <Select value={sheetReason} onChange={(e) => setSheetReason(e.target.value)}>
                  {ADJUST_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {t(r.label)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          }
          onClose={() => setSheetFor(null)}
          onSubmit={(e) => {
            if (!sheetFor) return
            const row: AdjRow = {
              productId: sheetFor.id,
              productName: sheetFor.name,
              unit: sheetFor.unitType,
              mode: 'delta',
              value: sheetDir === 'in' ? e.qty : -e.qty,
              reason: sheetReason,
              ...(e.entryUnit ? { entryUnit: e.entryUnit, entryQty: e.entryQty } : {}),
            }
            setRows((rs) => (rs.some((r) => r.productId === row.productId) ? rs.map((r) => (r.productId === row.productId ? row : r)) : [...rs, row]))
            setSheetFor(null)
          }}
        />
      )}
    </FramePage>
  )
}
