import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { useData } from '../data/DataContext'
import { LedgerWindowNotice } from '../components/LedgerWindowNotice'
import { SiteChip, SiteSelect } from '../components/SiteChip'
import { ActivityLog } from './reports/ActivityLog'
import { CostReport } from './reports/CostReport'
import { ReportsOverview } from './reports/ReportsOverview'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Card, EmptyState, Field, Input, Select } from '../components/ui'
import { ChipRow, FramePage, PageHero, frameCard } from '../components/frame'
import { dateInputToMs, dayRange, fmtMoney, fmtQty, formatThaiDate, formatThaiDateTime, msToDateInput, todayMs } from '../lib/format'
import { balanceUnit, editorsOf, movedSince, stockCard } from '../lib/ledger'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { DataTable, type Column } from '../components/DataTable'
import type { MovementType, StockMovement } from '../types'
import { useT, type TFn } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { movementNote } from '../lib/receiptLabel'

interface MovementRow {
  m: StockMovement
  inQty: number
  outQty: number
  balance: number | null
}

interface SnapshotRow {
  name: string
  category: string
  locationId: string
  locationName: string
  qty: number
  unit: string
  /**
   * The minimum and the money, for the product's own unit only.
   *
   * Null on a balance someone keyed in another unit: the minimum is set against the
   * product's unit and the cost is per one of them, so pricing a "10 Pack" row would invent
   * a pack size and quietly inflate the report's total.
   */
  min: number | null
  value: number | null
}

/** Shared by the screen, the spreadsheet and the PDF, so the three cannot disagree. */
function snapshotStatus(r: SnapshotRow, t: TFn): string {
  if (r.qty <= 0) return t('หมด') // i18n-key
  if (r.min !== null && r.min > 0 && r.qty <= r.min) return t('ใกล้หมด') // i18n-key
  return t('ปกติ') // i18n-key
}

const TYPE_LABEL: Record<MovementType, string> = {
  receive: 'รับเข้า', // i18n-key
  issue: 'เบิก/โอน', // i18n-key
  adjust: 'ปรับ', // i18n-key
  consume: 'เบิกใช้', // i18n-key
}

type ReportMode = 'overview' | 'movement' | 'snapshot' | 'activity' | 'cost'

export function ReportsPage() {
  const t = useT()
  const {
    movements,
    products,
    locations,
    locationById,
    qtyAt,
    qtyByUnit,
    minFor,
    ensureMovementsFrom,
    loading,
    movementsFrom,
  } = useData()
  const { user } = useAuth()
  const toast = useToast()
  const { brand } = useBrand()
  // Reports carry the company's name. Both PDFs used to say Pizza Mania whichever brand
  // was open, so a Le Lapin report went out under the wrong company.
  const company = brand ? brandDef(brand).name : ''

  // The overview opens first (owner's mock-up 07); the detailed reports are one tap away.
  const [mode, setMode] = useState<ReportMode>('overview')
  const [locationId, setLocationId] = useState('')
  const [productId, setProductId] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [fromStr, setFromStr] = useState('')
  const [toStr, setToStr] = useState('')
  // The stock report answers "what was on the shelf at the end of this day" — today when
  // empty. Earlier days are today's figure with everything moved since taken back off.
  const [asOfStr, setAsOfStr] = useState('')
  const [busy, setBusy] = useState('')

  // Picking a date before the loaded window would silently show nothing, so widen it.
  // Clearing the date does NOT widen: that is the default state, and loading the whole
  // ledger on every visit is the cost this window exists to avoid. The banner below
  // says what is loaded and offers to fetch the rest.
  useEffect(() => {
    if (fromStr) ensureMovementsFrom(dateInputToMs(fromStr))
  }, [fromStr, ensureMovementsFrom])
  useEffect(() => {
    if (asOfStr) ensureMovementsFrom(dateInputToMs(asOfStr))
  }, [asOfStr, ensureMovementsFrom])

  // ---------- movement dataset ----------
  // Balances come from every movement in scope, not from the rows that survived the
  // filters — otherwise a period that opens with stock already on the shelf reports its
  // first issue as a negative balance.
  const card = useMemo(() => {
    const { from, to } = dayRange(fromStr, toStr)
    return stockCard(movements, {
      productId: productId || undefined,
      locationId: locationId || undefined,
      from,
      to,
      type: (typeFilter || '') as MovementType | '',
    })
  }, [movements, productId, locationId, typeFilter, fromStr, toStr])

  const movementRows = useMemo<MovementRow[]>(
    () =>
      card.rows.map((r) => ({
        m: r.movement,
        inQty: r.inQty,
        outQty: r.outQty,
        balance: productId && locationId ? r.balance : null,
      })),
    [card, productId, locationId],
  )

  // ---------- snapshot dataset ----------
  const asOfDay = asOfStr ? dateInputToMs(asOfStr) : null
  const rewind = useMemo(() => {
    if (asOfDay === null || asOfDay >= todayMs()) return null
    const byId = new Map(products.map((p) => [p.id, p.unitType]))
    return movedSince(movements, asOfDay, (id) => byId.get(id))
  }, [asOfDay, movements, products])

  const snapshotRows = useMemo<SnapshotRow[]>(() => {
    const scope = locationId ? locations.filter((l) => l.id === locationId) : locations
    const rows: SnapshotRow[] = []
    const at = (loc: string, pid: string, unit: string, now: number) =>
      rewind ? Math.round((now - (rewind.get(`${loc}__${pid}__${unit}`) ?? 0)) * 1000) / 1000 : now
    for (const p of products) {
      if (productId && p.id !== productId) continue
      for (const l of scope) {
        const qty = at(l.id, p.id, '', qtyAt(l.id, p.id))
        const where = { name: p.name, category: p.category, locationId: l.id, locationName: l.name }
        rows.push({ ...where, qty, unit: p.unitType, min: minFor(p, l.id), value: qty * (p.cost ?? 0) })
        // Anything keyed in another unit is its own line rather than folded into the one
        // above. Leaving it out is how a report can say a product is empty while ten Pack of
        // it are on the shelf.
        const seen = new Set<string>()
        for (const other of qtyByUnit(l.id, p.id)) {
          if (other.unit === p.unitType) continue
          seen.add(other.unit)
          rows.push({ ...where, qty: at(l.id, p.id, other.unit, other.qty), unit: other.unit, min: null, value: null })
        }
        // A unit that held stock on that day but is empty now has no balance row left;
        // it still had goods then.
        if (rewind) {
          for (const [key, moved] of rewind) {
            const [loc, pid, unit] = key.split('__')
            if (loc !== l.id || pid !== p.id || !unit || seen.has(unit)) continue
            rows.push({ ...where, qty: Math.round(-moved * 1000) / 1000, unit, min: null, value: null })
          }
        }
      }
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit))
  }, [products, locations, productId, locationId, qtyAt, qtyByUnit, minFor, rewind])

  const branchName = locationId ? (locationById(locationId)?.name ?? '') : t("ทุกคลัง")
  const productName = productId
    ? (products.find((p) => p.id === productId)?.name ?? '')
    : t("ทุกสินค้า")
  // "All" was a lie by default: the ledger only holds a recent window unless the whole
  // history has been fetched, and the PDF said "all" while showing 90 days.
  const rangeText =
    fromStr || toStr
      ? `${fromStr ? formatThaiDate(dateInputToMs(fromStr)) : t('เริ่มต้น')} - ${
          toStr ? formatThaiDate(dateInputToMs(toStr)) : t('ปัจจุบัน')
        }`
      : movementsFrom > 0
        ? t('ตั้งแต่ {date} (เท่าที่โหลดไว้)', { date: formatThaiDate(movementsFrom), })
        : t("ทั้งหมด")

  const showBalance = !!productId && !!locationId && mode === 'movement'

  function metaLines(): string[] {
    return [
      t('คลัง/สาขา: {name}', { name: branchName }),
      t('สินค้า: {name}', { name: productName }),
      ...(mode === 'movement' ? [t('ช่วงวันที่: {range}', { range: rangeText })] : [t('ณ สิ้นวันที่: {date}', { date: asOfDay !== null ? formatThaiDate(asOfDay) : t('ปัจจุบัน') })]),
      t('ออกรายงานโดย: {user} เมื่อ {when}', { user: user?.name ?? '', when: formatThaiDateTime(Date.now()), }),
    ]
  }

  // ---------- exports (libraries lazy-loaded to keep initial load light) ----------
  async function excel() {
    setBusy('excel')
    try {
      await buildExcel()
    } catch (e) {
      // An export that fails silently leaves someone waiting for a file that is not coming.
      toast.error(t('สร้างไฟล์ไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function pdf() {
    setBusy('pdf')
    try {
      await buildPdf()
    } catch (e) {
      toast.error(t('สร้างไฟล์ไม่สำเร็จ:') + ' ' + errText(e, t))
    } finally {
      setBusy('')
    }
  }

  async function buildExcel() {
    const { exportExcel } = await import('../lib/export')
    if (mode === 'movement') {
      const rows = movementRows.map(({ m, inQty, outQty, balance }) => ({
        [t("วันที่")]: formatThaiDate(m.date),
        [t("เลขที่")]: m.docNo,
        [t("ประเภท")]: t(TYPE_LABEL[m.type]),
        [t("สินค้า")]: m.productName,
        [t("จาก")]: m.fromLocationId ? (locationById(m.fromLocationId)?.name ?? '') : '',
        [t("ไป")]: m.toLocationId ? (locationById(m.toLocationId)?.name ?? '') : '',
        [t("รับเข้า")]: inQty || '',
        [t("เบิกออก")]: outQty || '',
        [t("หน่วย")]: balanceUnit(m),
        [t("ที่คีย์")]: m.entryQty !== undefined && m.entryUnit ? `${m.entryQty} ${m.entryUnit}` : '',
        ...(showBalance ? { [t("คงเหลือ")]: balance ?? '' } : {}),
        [t("ผู้ทำ")]: m.byUserName,
        // A note is free text, except for the constants the services write ("ตั้งยอดคงเหลือ") —
        // t() translates those and passes anything it does not recognise through unchanged.
        [t("หมายเหตุ / เลขบิล")]: movementNote(m, t),
        // Every account that has changed this row, not just the last one.
        [t("ผู้แก้ไข")]: editorsOf(m).join(', '),
        [t("จำนวนครั้งที่แก้ไข")]: m.edits?.length ?? 0,
      }))
      exportExcel(t('รายงานการเคลื่อนไหว_{ts}', { ts: Date.now() }), 'Movements', rows)
    } else {
      const rows = snapshotRows.map((r) => ({
        [t("สินค้า")]: r.name,
        [t("หมวดหมู่")]: r.category,
        [t("คลัง")]: r.locationName,
        [t("คงเหลือ")]: r.qty,
        [t("หน่วย")]: r.unit,
        [t("ขั้นต่ำ")]: r.min ?? '',
        [t("สถานะ")]: snapshotStatus(r, t),
        [t("มูลค่า")]: r.value === null ? '' : Math.round(r.value),
      }))
      exportExcel(t('รายงานสต๊อกคงเหลือ_{ts}', { ts: Date.now() }), 'Stock', rows)
    }
  }

  async function buildPdf() {
    const { exportReportPdf } = await import('../lib/export')
    if (mode === 'movement') {
      const head = [
        t("วันที่"),
        t("เลขที่"),
        t("ประเภท"),
        t("สินค้า"),
        t("จาก"),
        t("ไป"),
        t("รับเข้า"),
        t("เบิกออก"),
        t("หน่วย"),
        ...(showBalance ? [t("คงเหลือ")] : []),
        t("หมายเหตุ / เลขบิล"),
        t("ผู้ทำ"),
        t("ผู้แก้ไข"),
      ]
      const body = movementRows.map(({ m, inQty, outQty, balance }) => [
        formatThaiDate(m.date),
        m.docNo,
        t(TYPE_LABEL[m.type]),
        m.productName,
        m.fromLocationId ? (locationById(m.fromLocationId)?.name ?? '') : '-',
        m.toLocationId ? (locationById(m.toLocationId)?.name ?? '') : '-',
        inQty ? fmtQty(inQty) : '',
        outQty ? fmtQty(outQty) : '',
        balanceUnit(m),
        ...(showBalance ? [fmtQty(balance ?? 0)] : []),
        movementNote(m, t),
        m.byUserName,
        editorsOf(m).join(', '),
      ])
      exportReportPdf({
        filename: t('รายงานการเคลื่อนไหว_{ts}', { ts: Date.now() }),
        title: t('รายงานการเคลื่อนไหวสต๊อก — {company}', { company }),
        meta: metaLines(),
        head,
        body,
      })
    } else {
      const head = [
        t("สินค้า"),
        t("หมวดหมู่"),
        t("คลัง"),
        t("คงเหลือ"),
        t("หน่วย"),
        t("ขั้นต่ำ"),
        t("สถานะ"),
        t("มูลค่า"),
      ]
      const body = snapshotRows.map((r) => [
        r.name,
        r.category,
        r.locationName,
        fmtQty(r.qty),
        r.unit,
        r.min === null ? '' : fmtQty(r.min),
        snapshotStatus(r, t),
        r.value === null ? '' : fmtMoney(r.value),
      ])
      exportReportPdf({
        filename: t('รายงานสต๊อกคงเหลือ_{ts}', { ts: Date.now() }),
        title: t('รายงานสต๊อกคงเหลือ — {company}', { company }),
        meta: metaLines(),
        head,
        body,
      })
    }
  }

  const count = mode === 'movement' ? movementRows.length : snapshotRows.length

  const movementColumns = useMemo<Column<MovementRow>[]>(() => {
    const list: Column<MovementRow>[] = [
      {
        key: 'product',
        header: t('สินค้า'),
        primary: true,
        headerClassName: 'min-w-[200px]',
        cell: ({ m }) => m.productName,
      },
      {
        key: 'date',
        header: t('วันที่'),
        className: 'whitespace-nowrap',
        cell: ({ m }) => formatThaiDate(m.date),
      },
      {
        key: 'docNo',
        header: t('เลขที่'),
        className: 'doc-no whitespace-nowrap text-xs text-ink-soft',
        cell: ({ m }) => m.docNo,
      },
      { key: 'type', header: t('ประเภท'), cell: ({ m }) => t(TYPE_LABEL[m.type]) },
      {
        key: 'site',
        header: t('คลัง'),
        cell: ({ m }) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <SiteChip locationId={m.fromLocationId} />
            {m.fromLocationId && m.toLocationId ? <span className="text-ink-faint">→</span> : null}
            <SiteChip locationId={m.toLocationId} />
          </span>
        ),
      },
      {
        key: 'in',
        card: 'value',
        header: t('รับเข้า'),
        align: 'right',
        className: 'num text-in',
        cell: ({ inQty }) => (inQty ? fmtQty(inQty) : ''),
      },
      {
        key: 'out',
        header: t('เบิกออก'),
        align: 'right',
        className: 'num text-out',
        cell: ({ outQty }) => (outQty ? fmtQty(outQty) : ''),
      },
      {
        key: 'unit',
        header: t('หน่วย'),
        className: 'text-ink-soft',
        cell: ({ m }) => (
          <>
            {balanceUnit(m)}
            {m.entryQty !== undefined && m.entryUnit ? <span className="ml-1 text-xs text-ink-faint">({fmtQty(m.entryQty)} {m.entryUnit})</span> : null}
          </>
        ),
      },
      {
        key: 'editors',
        header: t('ผู้แก้ไข'),
        className: 'text-ink-soft',
        // Blank on a row nobody has touched, which is most of them.
        cell: ({ m }) => editorsOf(m).join(', '),
      },
    ]
    if (showBalance) {
      list.push({
        key: 'balance',
        card: 'hidden',
        header: t('คงเหลือ'),
        align: 'right',
        className: 'num font-semibold',
        cell: ({ balance }) => fmtQty(balance ?? 0),
      })
    }
    list.push(
      {
        key: 'note',
        header: t('หมายเหตุ / เลขบิล'),
        className: 'text-xs text-ink-soft',
        cell: ({ m }) => movementNote(m, t),
      },
      {
        key: 'by',
        header: t('ผู้ทำ'),
        className: 'text-xs text-ink-soft',
        cell: ({ m }) => m.byUserName,
      },
    )
    return list
  }, [t, showBalance])

  const snapshotColumns = useMemo<Column<SnapshotRow>[]>(
    () => [
      { key: 'product', header: t('สินค้า'), primary: true, cell: (r) => r.name },
      { key: 'location', header: t('คลัง'), className: 'text-ink-soft', cell: (r) => <SiteChip locationId={r.locationId} /> },
      {
        key: 'qty',
        card: 'value',
        header: t('คงเหลือ'),
        align: 'right',
        className: 'num font-semibold',
        cell: (r) => `${fmtQty(r.qty)} ${r.unit}`,
      },
      {
        key: 'min',
        header: t('ขั้นต่ำ'),
        align: 'right',
        className: 'num text-ink-soft',
        cell: (r) => (r.min === null ? '' : fmtQty(r.min)),
      },
      {
        key: 'value',
        header: t('มูลค่า'),
        align: 'right',
        className: 'num',
        cell: (r) => (r.value === null ? '' : fmtMoney(r.value)),
      },
    ],
    [t],
  )

  const tabs = (
    <div className={`${frameCard} p-3`}>
      <ChipRow<ReportMode>
        label={t('ประเภทรายงาน')}
        value={mode}
        onChange={setMode}
        chips={[
          { key: 'overview', label: t('ภาพรวม') },
          { key: 'movement', label: t('การเคลื่อนไหว') },
          { key: 'snapshot', label: t('สต๊อกคงเหลือ') },
          { key: 'activity', label: t('บันทึกกิจกรรมทั้งระบบ') },
          { key: 'cost', label: t('ราคาต้นทุน') },
        ]}
      />
    </div>
  )

  if (mode === 'overview') {
    return (
      <FramePage>
        <PageHero icon="report" title={t('รายงาน')} subtitle={t('วิเคราะห์ข้อมูลคลังสินค้า เพื่อการตัดสินใจที่ดีขึ้น')} />
        {tabs}
        <LedgerWindowNotice />
        <ReportsOverview />
      </FramePage>
    )
  }

  if (mode === 'cost') {
    return (
      <FramePage>
        <PageHero icon="report" title={t("รายงาน")} subtitle={t('ต้นทุนทุกสินค้า ราคาเก่า-ใหม่ และวันที่ปรับ')} />
        {tabs}
        <CostReport />
      </FramePage>
    )
  }

  if (mode === 'activity') {
    return (
      <FramePage>
        <PageHero icon="report" title={t("รายงาน")} subtitle={t('ทุกการกระทำในระบบ ย้อนดูได้ ดาวน์โหลดได้ แก้ไขไม่ได้')} />
        {tabs}
        <ActivityLog />
      </FramePage>
    )
  }

  return (
    <FramePage>
      <PageHero
        icon="report"
        title={t("รายงาน")}
        subtitle={t("ดึงรายงานตามสาขา/วันที่/สินค้า แล้วดาวน์โหลดเป็น Excel หรือ PDF")}
      />

      {tabs}

      <Card className="space-y-4 p-4">

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Field label={t("คลัง/สาขา")}>
            <SiteSelect value={locationId} onChange={setLocationId} locations={locations} emptyLabel={t("ทุกคลัง")} />
          </Field>
          <Field label={t("สินค้า")}>
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{t("ทุกสินค้า")}</option>
              {[...products]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
          {mode === 'movement' && (
            <Field label={t("ประเภท")}>
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">{t("ทั้งหมด")}</option>
                <option value="receive">{t("รับเข้า")}</option>
                <option value="issue">{t("เบิก/โอน")}</option>
                <option value="consume">{t("เบิกใช้")}</option>
                <option value="adjust">{t("ปรับ")}</option>
              </Select>
            </Field>
          )}
          {mode === 'movement' && (
            <>
              <Field label={t("ตั้งแต่วันที่")}>
                <Input type="date" value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
              </Field>
              <Field label={t("ถึงวันที่")}>
                <Input type="date" value={toStr} onChange={(e) => setToStr(e.target.value)} />
              </Field>
            </>
          )}
          {mode === 'snapshot' && (
            <Field label={t('ณ สิ้นวันที่')} hint={t('ว่างไว้ = ปัจจุบัน ย้อนหลังคำนวณจากประวัติการเคลื่อนไหว')}>
              <Input type="date" value={asOfStr} max={msToDateInput(todayMs())} onChange={(e) => setAsOfStr(e.target.value)} />
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-sm text-ink-soft">
            {loading ? t('กำลังโหลดข้อมูล...') : t('พบ {n} รายการ', { n: count })}
          </span>
          <div className="flex gap-2">
            {/* Exporting mid-load writes yesterday's numbers into a file that outlives the
                screen, so the buttons wait for the data to settle. */}
            <Button variant="success" onClick={excel} disabled={count === 0 || loading || !!busy}>
              {busy === 'excel' ? (
                t('กำลังสร้างไฟล์...')
              ) : (
                <>
                  <Icon name="download" size={16} />
                  Excel
                </>
              )}
            </Button>
            <Button variant="danger" onClick={pdf} disabled={count === 0 || loading || !!busy}>
              {busy === 'pdf' ? (
                t('กำลังสร้างไฟล์...')
              ) : (
                <>
                  <Icon name="download" size={16} />
                  PDF
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>

      <LedgerWindowNotice />

      {/* preview */}
      {count === 0 ? (
        <Card>
          <EmptyState
            icon="report"
            title={t("ไม่มีข้อมูลตามเงื่อนไข")}
            hint={t("ปรับตัวกรองด้านบน")}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {mode === 'movement' ? (
            <DataTable
              rows={movementRows.slice(0, 200)}
              columns={movementColumns}
              rowKey={({ m }) => m.id}
              minWidth={showBalance ? 960 : 900}
              maxHeight="calc(100vh - 240px)"
            />
          ) : (
            <DataTable
              rows={snapshotRows.slice(0, 300)}
              columns={snapshotColumns}
              rowKey={(r) => `${r.locationName}-${r.name}-${r.unit}`}
              minWidth={640}
              maxHeight="calc(100vh - 240px)"
            />
          )}
          {count > (mode === 'movement' ? 200 : 300) && (
            <div className="border-t border-line p-2 text-center text-xs text-ink-faint">
              {t('แสดงตัวอย่าง — ไฟล์ดาวน์โหลดจะมีครบทั้ง {n} รายการ', { n: count, })}
            </div>
          )}
        </Card>
      )}
    </FramePage>
  )
}

// in/out helpers relative to a chosen location (or by type if no location)
