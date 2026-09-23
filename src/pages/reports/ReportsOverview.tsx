import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData, useLedgerWindow } from '../../data/DataContext'
import { useT, type TFn } from '../../i18n/I18nContext'
import { useSuppliers } from '../../services/suppliers'
import { AreaTrendChart, BarsChart, CATEGORY_COLORS, DonutChart, HBarList } from '../../components/charts'
import { FilterBar, FilterField, SectionCard, StatRow, StatTile, frameCard, toneIcon, type Tone } from '../../components/frame'
import { Icon, type IconName } from '../../components/Icon'
import { SiteSelect } from '../../components/SiteChip'
import { Input, Select } from '../../components/ui'
import { dateInputToMs, fmtMoney, fmtQty, msToDateInput } from '../../lib/format'
import { bkkDayStart, DAY_MS } from '../../lib/inventoryRules/time'
import { shortages } from '../../lib/inventoryRules/lowStock'
import { change, covers, valueAsOf } from '../../lib/stats/periodCompare'
import { insights, type Insight } from '../../lib/stats/insights'
import type { StockMovement } from '../../types'

/**
 * รายงาน → ภาพรวม (owner's mock-up 07, spec §2.8): the period's receipts and usage against
 * the period before, four charts, a table per site with a total row, and four sentences the
 * figures support.
 *
 * Everything is worked out from the ledger window already loaded — nothing is read for this
 * tab. A comparison whose earlier period starts before that window is not shown (the tile
 * keeps its figure and drops the arrow). The filters apply as they change; there is no
 * separate "ดูรายงาน" button (spec §2.8).
 */
const DEFAULT_DAYS = 14

export function ReportsOverview() {
  const t = useT()
  const { movements, movementsFrom, products, locations, qtyAt, minFor, tracksProduct } = useData()
  // Every figure here is compared with the period before it.
  useLedgerWindow()
  const suppliers = useSuppliers()
  const today = bkkDayStart(Date.now())
  const [fromStr, setFromStr] = useState(msToDateInput(today - (DEFAULT_DAYS - 1) * DAY_MS))
  const [toStr, setToStr] = useState(msToDateInput(today))
  const [locationId, setLocationId] = useState('')
  const [category, setCategory] = useState('')
  const [supplierId, setSupplierId] = useState('')

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products])

  const r = useMemo(() => {
    const from = bkkDayStart(dateInputToMs(fromStr))
    const to = bkkDayStart(dateInputToMs(toStr))
    const days = Math.max(1, Math.round((to - from) / DAY_MS) + 1)
    const prevFrom = from - days * DAY_MS
    const inProducts = new Set(
      products
        .filter((p) => p.active !== false)
        .filter((p) => !category || p.category === category)
        .filter((p) => !supplierId || p.supplierId === supplierId)
        .map((p) => p.id),
    )
    const byId = new Map(products.map((p) => [p.id, p]))
    const sites = locationId ? locations.filter((l) => l.id === locationId) : locations.filter((l) => l.active !== false)
    const siteIds = new Set(sites.map((l) => l.id))
    const touches = (m: StockMovement) => (m.toLocationId && siteIds.has(m.toLocationId)) || (m.fromLocationId && siteIds.has(m.fromLocationId))
    const scoped = movements.filter((m) => !m.voided && inProducts.has(m.productId) && touches(m))
    const within = (m: StockMovement, a: number, b: number) => {
      const d = bkkDayStart(m.date)
      return d >= a && d <= b
    }
    const receipts = (a: number, b: number) => scoped.filter((m) => m.type === 'receive' && within(m, a, b))
    const used = (a: number, b: number) => scoped.filter((m) => m.type === 'consume' && within(m, a, b))
    const comparable = covers(movementsFrom, prevFrom)

    const cost = (id: string) => byId.get(id)?.cost ?? 0
    const valueAt = (siteId: string) => {
      let v = 0
      for (const id of inProducts) v += Math.max(0, qtyAt(siteId, id)) * cost(id)
      return v
    }
    const siteValues = sites.map((l) => ({ location: l, value: valueAt(l.id) }))
    const valueNow = siteValues.reduce((s, x) => s + x.value, 0)
    const valueBefore = valueAsOf(valueNow, scoped, from, movementsFrom, cost, siteIds)

    const low = shortages({ products: products.filter((p) => inProducts.has(p.id)), locations: sites, qtyAt, minFor, tracksProduct })

    // Receipts per day, for the trend.
    const perDay = Array.from({ length: days }, (_, i) => ({ day: from + i * DAY_MS, n: 0 }))
    const index = new Map(perDay.map((p) => [p.day, p]))
    for (const m of receipts(from, to)) {
      const row = index.get(bkkDayStart(m.date))
      if (row) row.n++
    }

    // Usage by category — by value when costs are known, otherwise by lines.
    const usedNow = used(from, to)
    const usedValue = usedNow.reduce((s, m) => s + m.qty * cost(m.productId), 0)
    const byValue = usedValue > 0
    const catTotals = new Map<string, number>()
    const prodTotals = new Map<string, number>()
    for (const m of usedNow) {
      const amt = byValue ? m.qty * cost(m.productId) : 1
      const c = byId.get(m.productId)?.category ?? '—'
      catTotals.set(c, (catTotals.get(c) ?? 0) + amt)
      prodTotals.set(m.productName, (prodTotals.get(m.productName) ?? 0) + amt)
    }
    const catList = [...catTotals].sort((a, b) => b[1] - a[1])
    const donut = [
      ...catList.slice(0, 5).map(([label, value], i) => ({ key: label, label, value, color: CATEGORY_COLORS[i] })),
      ...(catList.length > 5
        ? [{ key: '__other', label: t('อื่น ๆ'), value: catList.slice(5).reduce((s, [, v]) => s + v, 0), color: CATEGORY_COLORS[5] }]
        : []),
    ]

    const branchRows = sites.map((l) => {
      const at = (m: StockMovement) => m.toLocationId === l.id || m.fromLocationId === l.id
      let stocked = 0
      for (const id of inProducts) if (qtyAt(l.id, id) > 0) stocked++
      return {
        location: l,
        received: receipts(from, to).filter(at).length,
        used: usedNow.filter(at).length,
        stocked,
        value: siteValues.find((x) => x.location.id === l.id)?.value ?? 0,
        low: low.filter((s) => s.location.id === l.id).length,
      }
    })

    const receivedNow = receipts(from, to).length
    const receivedBefore = comparable ? receipts(prevFrom, from - DAY_MS).length : null
    const usedBefore = comparable ? used(prevFrom, from - DAY_MS).length : null

    return {
      days,
      receivedNow,
      receivedBefore,
      usedNow: usedNow.length,
      usedBefore,
      valueNow,
      valueBefore,
      low: [...low].sort((a, b) => a.qty / a.min - b.qty / b.min),
      trend: perDay.map((p) => {
        const d = new Date(p.day + 7 * 3_600_000)
        return { label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, n: p.n }
      }),
      donut,
      donutTotal: donut.reduce((s, x) => s + x.value, 0),
      byValue,
      siteBars: siteValues.map((x) => ({ label: x.location.name, value: Math.round(x.value) })),
      branchRows,
      insights: insights({
        receiptsNow: receivedNow,
        receiptsBefore: receivedBefore,
        issued: [...prodTotals].map(([name, amount]) => ({ name, amount })),
        valueNow,
        valueBefore,
        lowCount: low.length,
      }),
    }
  }, [fromStr, toStr, locationId, category, supplierId, movements, movementsFrom, products, locations, qtyAt, minFor, tracksProduct, t])

  const trend = (now: number, before: number | null, goodWhenUp = true) => {
    if (before === null) return undefined
    const c = change(now, before, { unit: t('รายการ') })
    return c.flat ? undefined : { text: c.text, up: c.up, suffix: t('จากช่วงก่อนหน้า'), goodWhenUp }
  }
  const valueTrend = r.valueBefore !== null && r.valueBefore > 0 ? change(r.valueNow, r.valueBefore) : null
  const totals = r.branchRows.reduce(
    (s, b) => ({ received: s.received + b.received, used: s.used + b.used, stocked: s.stocked + b.stocked, value: s.value + b.value, low: s.low + b.low }),
    { received: 0, used: 0, stocked: 0, value: 0, low: 0 },
  )

  return (
    <div className="space-y-4 xl:space-y-5">
      <FilterBar
        onReset={() => {
          setFromStr(msToDateInput(today - (DEFAULT_DAYS - 1) * DAY_MS))
          setToStr(msToDateInput(today))
          setLocationId('')
          setCategory('')
          setSupplierId('')
        }}
      >
        <FilterField label={t('ตั้งแต่วันที่')}>
          <Input type="date" value={fromStr} max={toStr} onChange={(e) => e.target.value && setFromStr(e.target.value)} />
        </FilterField>
        <FilterField label={t('ถึงวันที่')}>
          <Input type="date" value={toStr} min={fromStr} max={msToDateInput(today)} onChange={(e) => e.target.value && setToStr(e.target.value)} />
        </FilterField>
        <FilterField label={t('สาขา')}>
          <SiteSelect value={locationId} onChange={setLocationId} locations={locations} emptyLabel={t('ทุกสาขา')} className="w-full" />
        </FilterField>
        <FilterField label={t('ประเภทสินค้า')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('ทั้งหมด')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label={t('ผู้ขาย')}>
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{t('ทั้งหมด')}</option>
            {suppliers
              .filter((s) => s.active !== false)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </FilterField>
      </FilterBar>

      <StatRow columns={4}>
        <StatTile icon="truck" tone="blue" label={t('รับสินค้าเข้า (รวม)')} value={r.receivedNow} unit={t('รายการ')} trend={trend(r.receivedNow, r.receivedBefore)} hint={t('{n} วัน', { n: r.days })} />
        <StatTile icon="report" tone="green" label={t('เบิกใช้ (รวม)')} value={r.usedNow} unit={t('รายการ')} trend={trend(r.usedNow, r.usedBefore)} hint={t('{n} วัน', { n: r.days })} />
        <StatTile
          icon="box"
          tone="amber"
          label={t('มูลค่าสินค้าคงคลัง')}
          value={`฿ ${fmtMoney(r.valueNow)}`} /* ฿ is a currency symbol — i18n-key */
          trend={valueTrend && !valueTrend.flat ? { text: valueTrend.text, up: valueTrend.up, suffix: t('จากต้นช่วง') } : undefined}
          hint={t('อิงต้นทุนที่กรอก')}
        />
        <StatTile icon="warning" tone="red" valueTone={r.low.length ? 'red' : undefined} label={t('สินค้าคงเหลือน้อย')} value={r.low.length} unit={t('รายการ')} hint={t('ต่ำกว่าหรือเท่าขั้นต่ำ')} />
      </StatRow>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        <SectionCard icon="chart" title={t('แนวโน้มการรับสินค้าเข้า')}>
          <AreaTrendChart data={r.trend} xKey="label" height={200} series={[{ key: 'n', label: t('จำนวนรายการ'), color: 'var(--color-brand)' }]} />
        </SectionCard>
        <SectionCard icon="report" title={t('การเบิกใช้ตามประเภทสินค้า')} count={r.byValue ? t('(ตามมูลค่า)') : t('(ตามจำนวนรายการ)')}>
          {r.donutTotal > 0 ? (
            <DonutChart
              slices={r.donut}
              height={170}
              centerLabel={t('รวมทั้งหมด')}
              centerValue={r.byValue ? `฿ ${fmtMoney(r.donutTotal)}` : fmtQty(r.donutTotal)} /* i18n-key */
              format={(v) => (r.byValue ? `฿ ${fmtMoney(v)}` : fmtQty(v))} /* i18n-key */
            />
          ) : (
            <p className="py-10 text-center text-sm text-ink-faint">{t('ไม่มีการเบิกใช้ในช่วงนี้')}</p>
          )}
        </SectionCard>
        <SectionCard icon="building" title={t('มูลค่าสินค้าคงคลังรายสาขา')}>
          <BarsChart
            data={r.siteBars}
            xKey="label"
            height={200}
            series={[{ key: 'value', label: t('มูลค่า'), color: 'var(--color-brand)' }]}
            format={(v) => (v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))}
          />
        </SectionCard>
        <SectionCard icon="warning" tone="red" title={t('5 สินค้าคงเหลือน้อยที่สุด')}>
          {r.low.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-faint">{t('ไม่มีรายการที่ต่ำกว่าขั้นต่ำ')}</p>
          ) : (
            <HBarList
              rows={r.low.slice(0, 5).map((s) => ({
                key: `${s.location.id}-${s.product.id}`,
                label: s.product.name,
                value: s.qty,
                max: s.min,
                display: (
                  <span className="text-danger">
                    {t('คงเหลือ')} {fmtQty(s.qty)} {s.product.unitType}
                  </span>
                ),
                color: 'var(--color-danger)',
              }))}
            />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] xl:gap-5">
        <SectionCard icon="building" title={t('สรุปรายงานตามสาขา')} flush>
          <div className="overflow-x-auto px-4 pb-4 md:px-5">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-sunken text-[13px] text-ink-soft">
                <tr>
                  <th className="rounded-l-lg px-3 py-2.5 text-left font-semibold">{t('สาขา')}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t('รับสินค้าเข้า (รายการ)')}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t('เบิกใช้ (รายการ)')}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t('สินค้าที่มีของ (รายการ)')}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{t('มูลค่าสินค้าคงคลัง (บาท)')}</th>
                  <th className="rounded-r-lg px-3 py-2.5 text-right font-semibold">{t('สินค้าคงเหลือน้อย (รายการ)')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.branchRows.map((b) => (
                  <tr key={b.location.id}>
                    <td className="px-3 py-2.5 font-medium text-ink">{b.location.name}</td>
                    <td className="num px-3 py-2.5 text-right">{fmtQty(b.received)}</td>
                    <td className="num px-3 py-2.5 text-right">{fmtQty(b.used)}</td>
                    <td className="num px-3 py-2.5 text-right">{fmtQty(b.stocked)}</td>
                    <td className="num px-3 py-2.5 text-right">฿ {fmtMoney(b.value)}</td> {/* i18n-key */}
                    <td className="num px-3 py-2.5 text-right">{fmtQty(b.low)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-brand-soft font-bold text-brand">
                  <td className="rounded-l-lg px-3 py-2.5">{t('รวมทั้งหมด')}</td>
                  <td className="num px-3 py-2.5 text-right">{fmtQty(totals.received)}</td>
                  <td className="num px-3 py-2.5 text-right">{fmtQty(totals.used)}</td>
                  <td className="num px-3 py-2.5 text-right">{fmtQty(totals.stocked)}</td>
                  <td className="num px-3 py-2.5 text-right">฿ {fmtMoney(totals.value)}</td> {/* i18n-key */}
                  <td className="num rounded-r-lg px-3 py-2.5 text-right">{fmtQty(totals.low)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SectionCard>

        <SectionCard icon="lightbulb" title={t('ข้อมูลเชิงลึก')}>
          <ul className="space-y-2">
            {r.insights.map((i) => (
              <InsightRow key={i.kind} insight={i} t={t} />
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  )
}

function InsightRow({ insight: i, t }: { insight: Insight; t: TFn }) {
  const look: Record<Insight['kind'], { icon: IconName; tone: Tone; title: string; to?: string }> = {
    receiptsUp: { icon: 'trendUp', tone: 'green', title: t('การรับสินค้าเพิ่มขึ้น') },
    receiptsDown: { icon: 'trendDown', tone: 'amber', title: t('การรับสินค้าลดลง') },
    receiptsFlat: { icon: 'chart', tone: 'slate', title: t('การรับสินค้าเท่าเดิม') },
    topIssue: { icon: 'chart', tone: 'blue', title: t('สินค้าที่เบิกใช้มากที่สุด') },
    valueUp: { icon: 'box', tone: 'amber', title: t('มูลค่าคงคลังเพิ่มขึ้น') },
    valueDown: { icon: 'box', tone: 'amber', title: t('มูลค่าคงคลังลดลง') },
    valueFlat: { icon: 'box', tone: 'slate', title: t('มูลค่าคงคลังทรงตัว') },
    lowStock: { icon: 'warning', tone: 'red', title: t('ควรสั่งซื้อเพิ่ม'), to: '/products' },
    allStocked: { icon: 'checkCircle', tone: 'green', title: t('ไม่มีสินค้าต่ำกว่าขั้นต่ำ') },
  }
  const body =
    i.kind === 'receiptsUp'
      ? t('จำนวนรายการรับเข้าเพิ่มขึ้น {pct}% จากช่วงก่อนหน้า', { pct: i.pct })
      : i.kind === 'receiptsDown'
        ? t('จำนวนรายการรับเข้าลดลง {pct}% จากช่วงก่อนหน้า', { pct: i.pct })
        : i.kind === 'receiptsFlat'
          ? t('จำนวนรายการรับเข้าเท่ากับช่วงก่อนหน้า')
          : i.kind === 'topIssue'
            ? t('{name} คิดเป็น {pct}% ของการเบิกใช้ทั้งหมด', { name: i.name, pct: i.pct })
            : i.kind === 'valueUp'
              ? t('มูลค่าสินค้าคงคลังเพิ่มขึ้น {pct}% จากต้นช่วง', { pct: i.pct })
              : i.kind === 'valueDown'
                ? t('มูลค่าสินค้าคงคลังลดลง {pct}% จากต้นช่วง', { pct: i.pct })
                : i.kind === 'valueFlat'
                  ? t('มูลค่าสินค้าคงคลังเท่ากับต้นช่วง')
                  : i.kind === 'lowStock'
                    ? t('มี {n} รายการที่คงเหลือต่ำกว่าหรือเท่าขั้นต่ำ ควรพิจารณาสั่งซื้อ', { n: i.count })
                    : t('ทุกรายการยังอยู่เหนือขั้นต่ำ')
  const l = look[i.kind]
  const inner = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneIcon[l.tone]}`}>
        <Icon name={l.icon} size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{l.title}</span>
        <span className="block text-xs leading-relaxed text-ink-soft">{body}</span>
      </span>
      {l.to && <Icon name="chevronRight" size={16} className="text-ink-faint" />}
    </>
  )
  return (
    <li>
      {l.to ? (
        <Link to={l.to} className={`${frameCard} flex items-center gap-3 p-3 hover:border-line-strong`}>
          {inner}
        </Link>
      ) : (
        <div className={`${frameCard} flex items-center gap-3 p-3`}>{inner}</div>
      )}
    </li>
  )
}
