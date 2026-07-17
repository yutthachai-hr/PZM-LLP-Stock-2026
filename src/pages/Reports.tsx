import { useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, EmptyState, Field, Input, Select } from '../components/ui'
import {
  dateInputToMs,
  fmtMoney,
  fmtQty,
  formatThaiDate,
  formatThaiDateTime,
} from '../lib/format'
import type { MovementType, StockMovement } from '../types'

const TYPE_LABEL: Record<MovementType, string> = {
  receive: 'รับเข้า',
  issue: 'เบิก/โอน',
  adjust: 'ปรับ',
  consume: 'เบิกใช้',
}

type ReportMode = 'movement' | 'snapshot'

export function ReportsPage() {
  const { movements, products, locations, locationById, qtyAt, minFor } = useData()
  const { user } = useAuth()

  const [mode, setMode] = useState<ReportMode>('movement')
  const [locationId, setLocationId] = useState('')
  const [productId, setProductId] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [fromStr, setFromStr] = useState('')
  const [toStr, setToStr] = useState('')

  // ---------- movement dataset ----------
  const movementRows = useMemo(() => {
    const fromMs = fromStr ? dateInputToMs(fromStr) : -Infinity
    const toMs = toStr ? dateInputToMs(toStr) + 86_400_000 : Infinity
    const list = movements
      .filter((m) => !m.voided)
      .filter((m) => (productId ? m.productId === productId : true))
      .filter((m) =>
        locationId ? m.fromLocationId === locationId || m.toLocationId === locationId : true,
      )
      .filter((m) => (typeFilter ? m.type === typeFilter : true))
      .filter((m) => m.date >= fromMs && m.date <= toMs)
      .sort((a, b) => a.date - b.date || a.createdAt - b.createdAt)

    // running balance only meaningful for a single product + single location
    const withBalance = !!productId && !!locationId
    let bal = 0
    return list.map((m) => {
      const inQty = inAt(m, locationId, typeFilter)
      const outQty = outAt(m, locationId, typeFilter)
      if (withBalance) bal += inQty - outQty
      return {
        m,
        inQty,
        outQty,
        balance: withBalance ? bal : null,
      }
    })
  }, [movements, productId, locationId, typeFilter, fromStr, toStr])

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

  const branchName = locationId ? locationById(locationId)?.name ?? '' : 'ทุกคลัง'
  const productName = productId ? products.find((p) => p.id === productId)?.name ?? '' : 'ทุกสินค้า'
  const rangeText =
    fromStr || toStr
      ? `${fromStr ? formatThaiDate(dateInputToMs(fromStr)) : 'เริ่มต้น'} - ${
          toStr ? formatThaiDate(dateInputToMs(toStr)) : 'ปัจจุบัน'
        }`
      : 'ทั้งหมด'

  const showBalance = !!productId && !!locationId && mode === 'movement'

  function metaLines(): string[] {
    return [
      `คลัง/สาขา: ${branchName}`,
      `สินค้า: ${productName}`,
      ...(mode === 'movement' ? [`ช่วงวันที่: ${rangeText}`] : []),
      `ออกรายงานโดย: ${user?.name ?? ''} เมื่อ ${formatThaiDateTime(Date.now())}`,
    ]
  }

  // ---------- exports (libraries lazy-loaded to keep initial load light) ----------
  async function excel() {
    const { exportExcel } = await import('../lib/export')
    if (mode === 'movement') {
      const rows = movementRows.map(({ m, inQty, outQty, balance }) => ({
        วันที่: formatThaiDate(m.date),
        เลขที่: m.docNo,
        ประเภท: TYPE_LABEL[m.type],
        สินค้า: m.productName,
        จาก: m.fromLocationId ? locationById(m.fromLocationId)?.name ?? '' : '',
        ไป: m.toLocationId ? locationById(m.toLocationId)?.name ?? '' : '',
        รับเข้า: inQty || '',
        เบิกออก: outQty || '',
        หน่วย: m.unit,
        ...(showBalance ? { คงเหลือ: balance ?? '' } : {}),
        ผู้ทำ: m.byUserName,
        หมายเหตุ: m.note ?? '',
      }))
      exportExcel(`รายงานการเคลื่อนไหว_${Date.now()}`, 'Movements', rows)
    } else {
      const rows = snapshotRows.map((r) => ({
        สินค้า: r.name,
        หมวดหมู่: r.category,
        คลัง: r.locationName,
        คงเหลือ: r.qty,
        หน่วย: r.unit,
        ขั้นต่ำ: r.min,
        สถานะ: r.qty <= 0 ? 'หมด' : r.min > 0 && r.qty <= r.min ? 'ใกล้หมด' : 'ปกติ',
        มูลค่า: Math.round(r.value),
      }))
      exportExcel(`รายงานสต๊อกคงเหลือ_${Date.now()}`, 'Stock', rows)
    }
  }

  async function pdf() {
    const { exportReportPdf } = await import('../lib/export')
    if (mode === 'movement') {
      const head = [
        'วันที่',
        'เลขที่',
        'ประเภท',
        'สินค้า',
        'จาก',
        'ไป',
        'รับเข้า',
        'เบิกออก',
        'หน่วย',
        ...(showBalance ? ['คงเหลือ'] : []),
        'หมายเหตุ / เลขบิล',
        'ผู้ทำ',
      ]
      const body = movementRows.map(({ m, inQty, outQty, balance }) => [
        formatThaiDate(m.date),
        m.docNo,
        TYPE_LABEL[m.type],
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
        filename: `รายงานการเคลื่อนไหว_${Date.now()}`,
        title: 'รายงานการเคลื่อนไหวสต๊อก — Pizza Mania',
        meta: metaLines(),
        head,
        body,
      })
    } else {
      const head = ['สินค้า', 'หมวดหมู่', 'คลัง', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'สถานะ', 'มูลค่า']
      const body = snapshotRows.map((r) => [
        r.name,
        r.category,
        r.locationName,
        fmtQty(r.qty),
        r.unit,
        fmtQty(r.min),
        r.qty <= 0 ? 'หมด' : r.min > 0 && r.qty <= r.min ? 'ใกล้หมด' : 'ปกติ',
        fmtMoney(r.value),
      ])
      exportReportPdf({
        filename: `รายงานสต๊อกคงเหลือ_${Date.now()}`,
        title: 'รายงานสต๊อกคงเหลือ — Pizza Mania',
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
        <h1 className="text-2xl font-bold text-slate-800">📄 รายงาน</h1>
        <p className="text-sm text-slate-500">ดึงรายงานตามสาขา/วันที่/สินค้า แล้วดาวน์โหลดเป็น Excel หรือ PDF</p>
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          <ModeTab label="การเคลื่อนไหว" active={mode === 'movement'} onClick={() => setMode('movement')} />
          <ModeTab label="สต๊อกคงเหลือ" active={mode === 'snapshot'} onClick={() => setMode('snapshot')} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="คลัง/สาขา">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">ทุกคลัง</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="สินค้า">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">ทุกสินค้า</option>
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
            <Field label="ประเภท">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">ทั้งหมด</option>
                <option value="receive">รับเข้า</option>
                <option value="issue">เบิก/โอน</option>
                <option value="consume">เบิกใช้</option>
                <option value="adjust">ปรับ</option>
              </Select>
            </Field>
          )}
          {mode === 'movement' && (
            <>
              <Field label="ตั้งแต่วันที่">
                <Input type="date" value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
              </Field>
              <Field label="ถึงวันที่">
                <Input type="date" value={toStr} onChange={(e) => setToStr(e.target.value)} />
              </Field>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="text-sm text-slate-500">พบ {count} รายการ</span>
          <div className="flex gap-2">
            <Button variant="success" onClick={excel} disabled={count === 0}>
              ⬇️ Excel
            </Button>
            <Button variant="danger" onClick={pdf} disabled={count === 0}>
              ⬇️ PDF
            </Button>
          </div>
        </div>
      </Card>

      {/* preview */}
      {count === 0 ? (
        <Card>
          <EmptyState icon="📄" title="ไม่มีข้อมูลตามเงื่อนไข" hint="ปรับตัวกรองด้านบน" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-240px)]">
            {mode === 'movement' ? (
              <table className="w-full min-w-[900px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500 shadow-sm">
                  <tr>
                    <th className="px-3 py-2">วันที่</th>
                    <th className="px-3 py-2">เลขที่</th>
                    <th className="px-3 py-2">ประเภท</th>
                    <th className="px-3 py-2">สินค้า</th>
                    <th className="px-3 py-2 text-right">รับเข้า</th>
                    <th className="px-3 py-2 text-right">เบิกออก</th>
                    {showBalance && <th className="px-3 py-2 text-right">คงเหลือ</th>}
                    <th className="px-3 py-2">หมายเหตุ / เลขบิล</th>
                    <th className="px-3 py-2">ผู้ทำ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movementRows.slice(0, 200).map(({ m, inQty, outQty, balance }) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap px-3 py-2">{formatThaiDate(m.date)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.docNo}</td>
                      <td className="px-3 py-2">{TYPE_LABEL[m.type]}</td>
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
                    <th className="px-3 py-2">สินค้า</th>
                    <th className="px-3 py-2">คลัง</th>
                    <th className="px-3 py-2 text-right">คงเหลือ</th>
                    <th className="px-3 py-2 text-right">ขั้นต่ำ</th>
                    <th className="px-3 py-2 text-right">มูลค่า</th>
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
              แสดงตัวอย่าง — ไฟล์ดาวน์โหลดจะมีครบทั้ง {count} รายการ
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
function inAt(m: StockMovement, locationId: string, _typeFilter: string): number {
  if (locationId) return m.toLocationId === locationId ? m.qty : 0
  if (m.type === 'receive') return m.qty
  if (m.toLocationId && !m.fromLocationId) return m.qty // adjust-in
  return 0
}
function outAt(m: StockMovement, locationId: string, _typeFilter: string): number {
  if (locationId) return m.fromLocationId === locationId ? m.qty : 0
  if (m.type === 'issue') return m.qty
  if (m.fromLocationId && !m.toLocationId) return m.qty // adjust-out
  return 0
}
