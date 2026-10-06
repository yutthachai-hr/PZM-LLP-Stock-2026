import { useMemo, useState } from 'react'
import { SectionCard, StatusChip } from '../../components/frame'
import { Button } from '../../components/ui'
import { Why, ConfidenceNote, WhyList } from '../../components/intel/Why'
import { useData } from '../../data/DataContext'
import { useSupplierIntel } from '../../data/useSupplierIntel'
import { useT } from '../../i18n/I18nContext'
import { fmtQty, formatThaiDateShort } from '../../lib/format'
import { RISK_LEVEL_COLOR, RISK_LEVEL_LABEL } from '../../lib/riskCopy'
import { useScheduleConfig } from '../../services/schedules'
import { listSupplierItemsFor, useSuppliers } from '../../services/suppliers'
import { stockoutFor, type StockoutInput } from '../../intel/stockout'
import { transferCandidates } from '../../intel/transfer'
import { purchaseRecommendation } from '../../intel/purchase'
import { alternateSuppliers, type AlternateSupplierIntel } from '../../intel/alternate'
import { detectAnomalies } from '../../intel/anomaly'
import { STEP_TEXT, explain } from '../../intel/copy'
import type { Product, SupplierItem } from '../../types'

const SEVERITY_LABEL = { high: 'สูง', medium: 'ปานกลาง', low: 'ต่ำ' } as const // i18n-key

/**
 * Phase G10 on the product's stock card: where it will run out and why, which location
 * could send some without running short itself, how much to buy (with the arithmetic),
 * what the other suppliers would change, and anything unusual about it lately.
 *
 * Recommendations only. Nothing here creates a transfer, an order or a request; the person
 * acts from the usual screens.
 */
export function IntelPanel({ product, locationId }: { product: Product; locationId: string }) {
  const t = useT()
  const data = useData()
  const intel = useSupplierIntel()
  const suppliers = useSuppliers()
  const { settings } = useScheduleConfig()
  const [items, setItems] = useState<SupplierItem[] | null>(null)
  const [comparing, setComparing] = useState(false)

  const input = useMemo<(StockoutInput & { minFor: typeof data.minFor }) | null>(() => {
    if (!intel.ready) return null
    return {
      products: data.products,
      locations: data.locations,
      qtyAt: data.qtyAt,
      tracksProduct: data.tracksProduct,
      usage: intel.usage,
      orders: intel.orders,
      transfers: intel.transfers,
      risks: intel.risks,
      p90DelayOf: (id) => intel.supplierIntel.get(id)?.stats.delay.p90,
      leadTimeOf: (id) => suppliers.find((s) => s.id === id)?.leadTimeDays,
      minFor: data.minFor,
      now: Date.now(),
    }
  }, [intel, data.products, data.locations, data.qtyAt, data.tracksProduct, data.minFor, suppliers])

  const states = useMemo(() => {
    if (!input) return []
    const sites = data.locations.filter((l) => l.active !== false && l.type !== 'transit' && (!locationId || l.id === locationId) && data.tracksProduct(l.id, product.id))
    return sites.map((l) => stockoutFor(input, product, l))
  }, [input, data.locations, data.tracksProduct, locationId, product])
  const anomalies = useMemo(
    () =>
      detectAnomalies({ movements: data.movements, products: [product], orders: intel.orders, counts: [], supplierIntel: intel.supplierIntel, now: Date.now() }).anomalies.filter(
        (a) => a.entity.id === product.id || a.entity.name.includes(product.name),
      ),
    [data.movements, product, intel.orders, intel.supplierIntel],
  )
  const unit = product.unitType
  const supplier = suppliers.find((s) => s.id === product.supplierId)

  async function compare() {
    setComparing(true)
    try {
      setItems(await listSupplierItemsFor(product.id))
    } catch {
      setItems([])
    }
  }

  if (!intel.ready) return null
  return (
    <SectionCard icon="chart" title={t('การวิเคราะห์ (แนะนำเท่านั้น)')}>
      <div className="space-y-4 px-4 pb-4 md:px-5">
        {states.length === 0 && <p className="text-sm text-ink-faint">{t('ยังไม่มีการใช้สินค้านี้ในคลังที่เลือก')}</p>}
        {states.map((s) => {
          const p = s.prediction
          const loc = data.locationById(s.locationId)
          const transfers = input && p ? transferCandidates(input, s).slice(0, 3) : []
          const rec = purchaseRecommendation(s, {
            supplierId: product.supplierId,
            leadTimeDays: supplier?.leadTimeDays,
            coverDays: settings.coverDays,
            min: data.minFor(product, s.locationId),
            transferQty: transfers[0]?.qty,
            now: Date.now(),
          })
          let alt: AlternateSupplierIntel | null = null
          if (items && p) alt = alternateSuppliers({ product, shortage: s, qty: rec.qty ?? 0, suppliers, items, intel: intel.supplierIntel, now: Date.now() })
          return (
            <div key={s.key} className="space-y-3 rounded-xl border border-line p-3">
              <div className="text-sm font-semibold text-ink">{loc?.name ?? s.locationName}</div>
              <Why
                meta={s.meta}
                reasons={s.reasons}
                headline={
                  !p ? (
                    <span className="text-sm text-ink-soft">{t('ยังคาดการณ์ไม่ได้ — ข้อมูลไม่พอ')}</span>
                  ) : p.estimatedStockoutDate === null && p.riskLevel === 'LOW' ? (
                    <span className="text-sm text-ink">{t('ไม่คาดว่าจะหมดใน 14 วัน (พอ {d} วัน)', { d: fmtQty(s.daysOfCover ?? 0) })}</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <StatusChip tone={RISK_LEVEL_COLOR[p.riskLevel]} size="sm">
                        {t(RISK_LEVEL_LABEL[p.riskLevel])}
                      </StatusChip>
                      {p.estimatedStockoutDate !== null
                        ? t('คาดว่าหมด {date} · ขาด {qty} {unit} ({gap} วัน)', { date: formatThaiDateShort(p.estimatedStockoutDate), qty: p.estimatedShortageQty, unit, gap: p.gapDays })
                        : t('ถ้าของที่สั่งมาช้าตามปกติ จะขาด {gap} วัน', { gap: p.riskAdjusted.gapDays })}
                    </span>
                  )
                }
              />

              {transfers.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-ink-soft">{t('ตัวเลือกโอนจากคลังอื่น')}</div>
                  {transfers.map((r) => (
                    <Why
                      key={r.source.locationId}
                      meta={r.meta}
                      reasons={r.reasons}
                      headline={
                        <span className="text-sm text-ink">
                          {t('{from} → {to}: {qty} {unit} · ต้นทาง {before} → {after} (เก็บไว้ ≥ {req}) · ปลายทางขาด {sb} → {sa}', {
                            from: r.source.locationName,
                            to: r.destination.locationName,
                            qty: r.qty,
                            unit,
                            before: fmtQty(r.source.before),
                            after: fmtQty(r.source.after),
                            req: fmtQty(r.source.required),
                            sb: r.destination.shortageBefore,
                            sa: r.destination.shortageAfter,
                          })}
                        </span>
                      }
                    />
                  ))}
                </div>
              )}

              <Why
                meta={rec.meta}
                reasons={rec.reasons}
                headline={
                  <span className="text-sm text-ink">
                    {rec.qty === null
                      ? t('ยังแนะนำจำนวนสั่งซื้อไม่ได้')
                      : rec.qty === 0
                        ? t('ยังไม่ต้องสั่งเพิ่ม')
                        : t('แนะนำสั่ง {qty} {unit}', { qty: rec.packs ? `${rec.packs.count} ${rec.packs.label}` : fmtQty(rec.qty), unit: rec.packs ? '' : unit })}
                  </span>
                }
              >
                {rec.steps.length > 0 && (
                  <table className="w-full text-xs">
                    <tbody>
                      {rec.steps.map((st) => (
                        <tr key={st.code} className={st.code === 'need' || st.code === 'recommended' ? 'font-semibold text-ink' : 'text-ink-soft'}>
                          <td className="py-0.5 pr-2">{t(STEP_TEXT[st.code], st.params)}</td>
                          <td className="num py-0.5 text-right">{fmtQty(st.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {rec.unreliable.length > 0 && (
                  <p className="text-[11px] text-ink-faint">
                    {t('ไม่นับ: {list}', { list: rec.unreliable.map((u) => `${u.docNo} (${fmtQty(u.qty)})`).join(', ') })}
                  </p>
                )}
              </Why>

              {p && (product.alternateSupplierIds?.length ?? 0) > 0 && !items && (
                <Button variant="secondary" size="sm" onClick={() => void compare()} disabled={comparing}>
                  {t('เทียบผู้ขายสำรอง')}
                </Button>
              )}
              {alt && (
                <div className="space-y-1.5">
                  <table className="w-full text-xs">
                    <thead className="text-left text-ink-soft">
                      <tr>
                        <th className="py-1">{t('ผู้ขาย')}</th>
                        <th className="py-1 text-right">{t('ราคา/หน่วย')}</th>
                        <th className="py-1 text-right">{t('ส่งใน (วัน)')}</th>
                        <th className="py-1 text-right">{t('ขาด (วัน)')}</th>
                        <th className="py-1 text-right">{t('คะแนน')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alt.options.map((o) => (
                        <tr key={o.supplierId} className="border-t border-line">
                          <td className="py-1">
                            {o.supplierName} {o.primary && <span className="text-ink-faint">({t('ผู้ขายประจำ')})</span>}
                          </td>
                          <td className="num py-1 text-right">
                            {o.price === null ? '—' : fmtQty(o.price)}
                            {o.priceDiff ? <span className="ml-1 text-ink-faint">({o.priceDiff > 0 ? '+' : ''}{fmtQty(o.priceDiff)})</span> : null}
                          </td>
                          <td className="num py-1 text-right">{o.leadTimeDays + o.expectedDelayDays}</td>
                          <td className="num py-1 text-right">{o.gapDaysIfOrdered}</td>
                          <td className="num py-1 text-right">{o.score === null ? '—' : Math.round(o.score)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <WhyList reasons={alt.tradeoffs} />
                  <ConfidenceNote meta={alt.meta} />
                </div>
              )}
            </div>
          )
        })}

        {anomalies.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-ink-soft">{t('สิ่งที่ผิดปกติช่วงนี้')}</div>
            <ul className="space-y-1 text-xs text-ink">
              {anomalies.slice(0, 5).map((a) => (
                <li key={a.id} className="flex gap-2">
                  <StatusChip tone={a.severity === 'high' ? 'red' : a.severity === 'medium' ? 'amber' : 'slate'} size="sm" icon={null}>
                    {t(SEVERITY_LABEL[a.severity])}
                  </StatusChip>
                  <span>
                    {explain(a.why, t)} <span className="text-ink-faint">({a.reference.basis})</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-ink-faint">{t('คำแนะนำเท่านั้น — ระบบไม่สร้างใบโอน ใบสั่งซื้อ หรือเปลี่ยนผู้ขายเอง')}</p>
      </div>
    </SectionCard>
  )
}
