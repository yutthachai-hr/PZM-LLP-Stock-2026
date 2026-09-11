import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { useData } from '../data/DataContext'
import { LedgerWindowNotice } from '../components/LedgerWindowNotice'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Card, EmptyState, Field, Input, PageHeader, SegTab, Select } from '../components/ui'
import {
  dateInputToMs,
  dayRange,
  fmtMoney,
  fmtQty,
  formatThaiDate,
  formatThaiDateTime,
} from '../lib/format'
import { stockCard } from '../lib/ledger'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { DataTable, type Column } from '../components/DataTable'
import type { MovementType, StockMovement } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

interface MovementRow {
  m: StockMovement
  inQty: number
  outQty: number
  balance: number | null
}

interface SnapshotRow {
  name: string
  category: string
  locationName: string
  qty: number
  unit: string
  min: number
  value: number
}

const TYPE_LABEL: Record<MovementType, string> = {
  receive: 'รับเข้า', // i18n-key
  issue: 'เบิก/โอน', // i18n-key
  adjust: 'ปรับ', // i18n-key
  consume: 'เบิกใช้', // i18n-key
}

type ReportMode = 'movement' | 'snapshot'

export function ReportsPage() {
  const t = useT()
  const {
    movements,
    products,
    locations,
    locationById,
    qtyAt,
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

  const [mode, setMode] = useState<ReportMode>('movement')
  const [locationId, setLocationId] = useState('')
  const [productId, setProductId] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [fromStr, setFromStr] = useState('')
  const [toStr, setToStr] = useState('')
  const [busy, setBusy] = useState('')

  // Picking a date before the loaded window would silently show nothing, so widen it.
  // Clearing the date does NOT widen: that is the default state, and loading the whole
  // ledger on every visit is the cost this window exists to avoid. The banner below
  // says what is loaded and offers to fetch the rest.
  useEffect(() => {
    if (fromStr) ensureMovementsFrom(dateInputToMs(fromStr))
  }, [fromStr, ensureMovementsFrom])

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
  const snapshotRows = useMemo<SnapshotRow[]>(() => {
    const scope = locationId ? locations.filter((l) => l.id === locationId) : locations
    const rows: SnapshotRow[] = []
    for (const p of products) {
      if (productId && p.id !== productId) continue
      for (const l of scope) {
        const qty = qtyAt(l.id, p.id)
        rows.push({
          name: p.name,
          category: p.category,
          locationName: l.name,
          qty,
          unit: p.unitType,
          min: minFor(p, l.id),
          value: qty * (p.cost ?? 0),
        })
      }
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  }, [products, locations, productId, locationId, qtyAt, minFor])

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
      ...(mode === 'movement' ? [t('ช่วงวันที่: {range}', { range: rangeText })] : []),
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
        [t("หน่วย")]: m.unit,
        ...(showBalance ? { [t("คงเหลือ")]: balance ?? '' } : {}),
        [t("ผู้ทำ")]: m.byUserName,
        // A note is free text, except for the constants the services write ("ตั้งยอดคงเหลือ") —
        // t() translates those and passes anything it does not recognise through unchanged.
        [t("หมายเหตุ")]: m.note ? t(m.note) : '',
      }))
      exportExcel(t('รายงานการเคลื่อนไหว_{ts}', { ts: Date.now() }), 'Movements', rows)
    } else {
      const rows = snapshotRows.map((r) => ({
        [t("สินค้า")]: r.name,
        [t("หมวดหมู่")]: r.category,
        [t("คลัง")]: r.locationName,
        [t("คงเหลือ")]: r.qty,
        [t("หน่วย")]: r.unit,
        [t("ขั้นต่ำ")]: r.min,
        [t("สถานะ")]:
          r.qty <= 0 ? t("หมด") : r.min > 0 && r.qty <= r.min ? t("ใกล้หมด") : t("ปกติ"),
        [t("มูลค่า")]: Math.round(r.value),
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
        m.unit,
        ...(showBalance ? [fmtQty(balance ?? 0)] : []),
        m.note ?? '',
        m.byUserName,
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
        fmtQty(r.min),
        r.qty <= 0 ? t("หมด") : r.min > 0 && r.qty <= r.min ? t("ใกล้หมด") : t("ปกติ"),
        fmtMoney(r.value),
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
        key: 'in',
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
    ]
    if (showBalance) {
      list.push({
        key: 'balance',
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
        cell: ({ m }) => m.note ?? '',
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
      { key: 'location', header: t('คลัง'), className: 'text-ink-soft', cell: (r) => r.locationName },
      {
        key: 'qty',
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
        cell: (r) => fmtQty(r.min),
      },
      {
        key: 'value',
        header: t('มูลค่า'),
        align: 'right',
        className: 'num',
        cell: (r) => fmtMoney(r.value),
      },
    ],
    [t],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        icon="report"
        title={t("รายงาน")}
        subtitle={t("ดึงรายงานตามสาขา/วันที่/สินค้า แล้วดาวน์โหลดเป็น Excel หรือ PDF")}
      />

      <Card className="space-y-4 p-4">
        <div className="flex gap-1 rounded-lg bg-sunken p-1">
          <SegTab
            label={t("การเคลื่อนไหว")}
            active={mode === 'movement'}
            onClick={() => setMode('movement')}
          />
          <SegTab
            label={t("สต๊อกคงเหลือ")}
            active={mode === 'snapshot'}
            onClick={() => setMode('snapshot')}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("คลัง/สาขา")}>
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t("ทุกคลัง")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
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
              rowKey={(r) => `${r.locationName}-${r.name}`}
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
    </div>
  )
}

// in/out helpers relative to a chosen location (or by type if no location)
