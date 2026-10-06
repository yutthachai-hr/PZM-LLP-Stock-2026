import { useEffect, useMemo, useState } from 'react'
import { SectionCard } from '../../components/frame'
import { useData } from '../../data/DataContext'
import { useT } from '../../i18n/I18nContext'
import { fmtQty } from '../../lib/format'
import { supplyPosition, type SupplyPosition } from '../../lib/inventoryRules/supply'
import { loadSupplyInputs } from '../../services/supply'
import type { Product } from '../../types'

type Inputs = Awaited<ReturnType<typeof loadSupplyInputs>>

/**
 * On hand → reserved → available, then what is coming: placed orders, and what is decided
 * but not yet ordered (plan E1). One location, or every location added up.
 */
export function SupplyPanel({ product, locationId }: { product: Product; locationId: string }) {
  const t = useT()
  const { locations, qtyAt } = useData()
  const [inputs, setInputs] = useState<Inputs | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadSupplyInputs()
      .then((r) => alive && setInputs(r))
      .catch((e) => {
        console.error('[supply] cannot read open orders', e)
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const pos = useMemo<SupplyPosition | null>(() => {
    if (!inputs) return null
    const sites = locationId ? [locationId] : locations.map((l) => l.id)
    const each = sites.map((id) => supplyPosition({ productId: product.id, locationId: id, onHand: qtyAt(id, product.id), product, ...inputs }))
    const add = (k: keyof Omit<SupplyPosition, 'unknownUnits'>) => Math.round(each.reduce((n, p) => n + p[k], 0) * 1000) / 1000
    return {
      onHand: add('onHand'),
      reserved: add('reserved'),
      available: add('available'),
      incoming: add('incoming'),
      plannedInbound: add('plannedInbound'),
      requestedOut: add('requestedOut'),
      unknownUnits: each.some((p) => p.unknownUnits),
    }
  }, [inputs, locationId, locations, qtyAt, product])

  const unit = product.unitType
  const cell = (label: string, value: number | null, hint: string, strong = false) => (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`num text-lg ${strong ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>
        {value === null ? '…' : fmtQty(value)} <span className="text-xs font-normal text-ink-soft">{unit}</span>
      </div>
      <div className="text-[11px] text-ink-faint">{hint}</div>
    </div>
  )

  return (
    <SectionCard icon="package" title={t('สถานะสินค้า: มี / จอง / พร้อมใช้ / กำลังมา')}>
      {failed ? (
        <p className="px-4 pb-4 text-sm text-danger md:px-5">{t('อ่านใบสั่งซื้อ/คำขอที่เปิดอยู่ไม่สำเร็จ — ยังบอกยอดที่กำลังมาไม่ได้')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 md:grid-cols-5 md:px-5">
          {cell(t('มีในคลัง'), pos?.onHand ?? null, t('ยอดคงเหลือตอนนี้'))}
          {cell(t('จองแล้ว'), pos?.reserved ?? null, t('ผูกกับรายการที่อนุมัติแล้วแต่ยังไม่ออก'))}
          {cell(t('พร้อมใช้'), pos?.available ?? null, t('มีในคลัง − จองแล้ว'), true)}
          {cell(t('กำลังมา'), pos?.incoming ?? null, t('ใบสั่งซื้อที่สั่งแล้ว ยังค้างรับ'))}
          {cell(t('วางแผนเข้า'), pos?.plannedInbound ?? null, t('ขอซื้ออนุมัติแล้ว + ใบสั่งซื้อร่าง (ยังไม่สั่ง)'))}
        </div>
      )}
      {pos && (pos.requestedOut > 0 || pos.unknownUnits) && (
        <ul className="space-y-1 px-4 pb-4 text-xs text-ink-soft md:px-5">
          {pos.requestedOut > 0 && <li>{t('มีคำขอโอนออกรออนุมัติ {qty} {unit} — ยังไม่หักจากพร้อมใช้', { qty: fmtQty(pos.requestedOut), unit })}</li>}
          {pos.unknownUnits && <li className="text-warn">{t('บางรายการใช้หน่วยที่ยังไม่มีอัตราแปลง จึงไม่ได้นับรวม')}</li>}
        </ul>
      )}
    </SectionCard>
  )
}
