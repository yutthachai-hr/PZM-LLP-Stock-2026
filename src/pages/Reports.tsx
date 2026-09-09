import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { LedgerWindowNotice } from '../components/LedgerWindowNotice'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { Button, Card, EmptyState, Field, Input, Select } from '../components/ui'
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
import type { MovementType } from '../types'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'

const TYPE_LABEL: Record<MovementType, string> = {
  receive: 'รับเข้า', // i18n-key
  issue: 'เบิก/โอน', // i18n-key
  adjust: 'ปรับ', // i18n-key
  consume: 'เบิกใช้', // i18n-key
}

type ReportMode = 'movement' | 'snapshot'

export function ReportsPage() {
  const t = useT()
  const { movements, products, locations, locationById, qtyAt, minFor, ensureMovementsFrom, loading, movementsFrom } =
    useData()
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

  const movementRows = useMemo(
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
  const snapshotRows = useMemo(() => {
    const scope = locationId ? locations.filter((l) => l.id === locationId) : locations
    const rows: {
      name: string
      category: string
      locationName: string
      qty: number
      unit: string
      min: number
      value: number
    }[] = []
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

  const branchName = locationId ? locationById(locationId)?.name ?? '' : t('ทุกคลัง')
  const productName = productId ? products.find((p) => p.id === productId)?.name ?? '' : t('ทุกสินค้า')
  // "All" was a lie by default: the ledger only holds a recent window unless the whole
  // history has been fetched, and the PDF said "all" while showing 90 days.
  const rangeText =
    fromStr || toStr
      ? `${fromStr ? formatThaiDate(dateInputToMs(fromStr)) : t('เริ่มต้น')} - ${
          toStr ? formatThaiDate(dateInputToMs(toStr)) : t('ปัจจุบัน')
        }`
      : movementsFrom > 0
        ? t('ตั้งแต่ {date} (เท่าที่โหลดไว้)', { date: formatThaiDate(movementsFrom) })
        : t('ทั้งหมด')

  const showBalance = !!productId && !!locationId && mode === 'movement'

  function metaLines(): string[] {
    return [
      t('คลัง/สาขา: {name}', { name: branchName }),
      t('สินค้า: {name}', { name: productName }),
      ...(mode === 'movement' ? [t('ช่วงวันที่: {range}', { range: rangeText })] : []),
      t('ออกรายงานโดย: {user} เมื่อ {when}', { user: user?.name ?? '', when: formatThaiDateTime(Date.now()) }),
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
        [t("จาก")]: m.fromLocationId ? locationById(m.fromLocationId)?.name ?? '' : '',
        [t("ไป")]: m.toLocationId ? locationById(m.toLocationId)?.name ?? '' : '',
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
        [t("สถานะ")]: r.qty <= 0 ? t("หมด") : r.min > 0 && r.qty <= r.min ? t("ใกล้หมด") : t("ปกติ"),
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
        m.fromLocationId ? locationById(m.fromLocationId)?.name ?? '' : '-',
        m.toLocationId ? locationById(m.toLocationId)?.name ?? '' : '-',
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
      const head = [t("สินค้า"), t("หมวดหมู่"), t("คลัง"), t("คงเหลือ"), t("หน่วย"), t("ขั้นต่ำ"), t("สถานะ"), t("มูลค่า")]
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t("📄 รายงาน")}</h1>
        <p className="text-sm text-slate-500">{t("ดึงรายงานตามสาขา/วันที่/สินค้า แล้วดาวน์โหลดเป็น Excel หรือ PDF")}</p>
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          <ModeTab label={t("การเคลื่อนไหว")} active={mode === 'movement'} onClick={() => setMode('movement')} />
          <ModeTab label={t("สต๊อกคงเหลือ")} active={mode === 'snapshot'} onClick={() => setMode('snapshot')} />
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="text-sm text-slate-500">
            {loading ? t('กำลังโหลดข้อมูล...') : t('พบ {n} รายการ', { n: count })}
          </span>
          <div className="flex gap-2">
            {/* Exporting mid-load writes yesterday's numbers into a file that outlives the
                screen, so the buttons wait for the data to settle. */}
            <Button variant="success" onClick={excel} disabled={count === 0 || loading || !!busy}>
              {busy === 'excel' ? t('กำลังสร้างไฟล์...') : '⬇️ Excel'}
            </Button>
            <Button variant="danger" onClick={pdf} disabled={count === 0 || loading || !!busy}>
              {busy === 'pdf' ? t('กำลังสร้างไฟล์...') : '⬇️ PDF'}
            </Button>
          </div>
        </div>
      </Card>

      <LedgerWindowNotice />

      {/* preview */}
      {count === 0 ? (
        <Card>
          <EmptyState icon="report" title={t("ไม่มีข้อมูลตามเงื่อนไข")} hint={t("ปรับตัวกรองด้านบน")} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-240px)]">
            {mode === 'movement' ? (
              <table className="w-full min-w-[900px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500 shadow-sm">
                  <tr>
                    <th className="px-3 py-2">{t("วันที่")}</th>
                    <th className="px-3 py-2">{t("เลขที่")}</th>
                    <th className="px-3 py-2">{t("ประเภท")}</th>
                    <th className="px-3 py-2">{t("สินค้า")}</th>
                    <th className="px-3 py-2 text-right">{t("รับเข้า")}</th>
                    <th className="px-3 py-2 text-right">{t("เบิกออก")}</th>
                    {showBalance && <th className="px-3 py-2 text-right">{t("คงเหลือ")}</th>}
                    <th className="px-3 py-2">{t("หมายเหตุ / เลขบิล")}</th>
                    <th className="px-3 py-2">{t("ผู้ทำ")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movementRows.slice(0, 200).map(({ m, inQty, outQty, balance }) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap px-3 py-2">{formatThaiDate(m.date)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.docNo}</td>
                      <td className="px-3 py-2">{t(TYPE_LABEL[m.type])}</td>
                      <td className="px-3 py-2">{m.productName}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">
                        {inQty ? fmtQty(inQty) : ''}
                      </td>
                      <td className="px-3 py-2 text-right text-rose-600">
                        {outQty ? fmtQty(outQty) : ''}
                      </td>
                      {showBalance && (
                        <td className="px-3 py-2 text-right font-semibold">{fmtQty(balance ?? 0)}</td>
                      )}
                      <td className="px-3 py-2 text-xs text-slate-600">{m.note ?? ''}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{m.byUserName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500 shadow-sm">
                  <tr>
                    <th className="px-3 py-2">{t("สินค้า")}</th>
                    <th className="px-3 py-2">{t("คลัง")}</th>
                    <th className="px-3 py-2 text-right">{t("คงเหลือ")}</th>
                    <th className="px-3 py-2 text-right">{t("ขั้นต่ำ")}</th>
                    <th className="px-3 py-2 text-right">{t("มูลค่า")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {snapshotRows.slice(0, 300).map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 text-slate-500">{r.locationName}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {fmtQty(r.qty)} {r.unit}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{fmtQty(r.min)}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {count > (mode === 'movement' ? 200 : 300) && (
            <div className="border-t border-slate-100 p-2 text-center text-xs text-slate-400">
              {t('แสดงตัวอย่าง — ไฟล์ดาวน์โหลดจะมีครบทั้ง {n} รายการ', { n: count })}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-white text-red-700 shadow-sm' : 'text-slate-600'
      }`}
    >
      {label}
    </button>
  )
}

// in/out helpers relative to a chosen location (or by type if no location)

