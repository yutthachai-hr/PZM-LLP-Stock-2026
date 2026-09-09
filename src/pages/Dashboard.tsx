import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useData } from '../data/DataContext'
import { Badge, Card, EmptyState, Input, PageHeader, Spinner } from '../components/ui'
import { ProductThumb } from '../components/ProductThumb'
import { fmtMoney, fmtQty, formatThaiDate, todayMs } from '../lib/format'
import type { Product, StockLocation } from '../types'
import { useT } from '../i18n/I18nContext'
import { Icon, type IconName } from '../components/Icon'

const ALL = '__all__'

export function DashboardPage() {
  const t = useT()
  const { products, locations, qtyAt, minFor, movements, loading } = useData()
  const [scope, setScope] = useState<string>(ALL)
  const [search, setSearch] = useState('')
  // Recomputed on the hour so a screen left open overnight rolls over to the new day.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const scopeLocations = useMemo(
    () => (scope === ALL ? locations : locations.filter((l) => l.id === scope)),
    [scope, locations],
  )

  const totalQtyOf = (p: Product) =>
    scopeLocations.reduce((s, l) => s + qtyAt(l.id, p.id), 0)

  // low-stock items within the selected scope
  const lowStock = useMemo(() => {
    const items: { product: Product; location: StockLocation; qty: number; min: number }[] = []
    for (const p of products) {
      for (const l of scopeLocations) {
        const min = minFor(p, l.id)
        if (min > 0) {
          const qty = qtyAt(l.id, p.id)
          if (qty <= min) items.push({ product: p, location: l, qty, min })
        }
      }
    }
    return items.sort((a, b) => a.qty - a.min - (b.qty - b.min))
  }, [products, scopeLocations, qtyAt, minFor])

  const stats = useMemo(() => {
    let value = 0
    let outCount = 0
    for (const p of products) {
      const q = totalQtyOf(p)
      value += q * (p.cost ?? 0)
      if (q <= 0) outCount++
    }
    // `date >= today` had no upper bound, so a receipt dated next week counted as today's
    // activity, and it ignored the location filter every other number on this screen obeys.
    const today = todayMs()
    const tomorrow = today + 86_400_000
    const inScope = new Set(scopeLocations.map((l) => l.id))
    const todayMoves = movements.filter(
      (m) =>
        !m.voided &&
        m.date >= today &&
        m.date < tomorrow &&
        (scope === ALL ||
          (m.fromLocationId && inScope.has(m.fromLocationId)) ||
          (m.toLocationId && inScope.has(m.toLocationId))),
    ).length
    return { value, outCount, todayMoves }
  }, [products, scopeLocations, movements, qtyAt, scope])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of products) {
      const q = totalQtyOf(p)
      const val = q * (p.cost ?? 0)
      map.set(p.category, (map.get(p.category) ?? 0) + val)
    }
    return [...map.entries()]
      .map(([category, value]) => ({ category, value: Math.round(value) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [products, scopeLocations, qtyAt])

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .map((p) => ({ p, total: totalQtyOf(p) }))
      .sort((a, b) => a.p.name.localeCompare(b.p.name))
  }, [products, search, scopeLocations, qtyAt])

  if (loading) return <Spinner label={t("กำลังโหลดภาพรวม...")} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader icon="dashboard" title={t("ภาพรวมสต๊อก")} />
        <div className="flex flex-wrap gap-1 rounded-lg bg-sunken p-1">
          <ScopeTab label={t("รวมทุกคลัง")} active={scope === ALL} onClick={() => setScope(ALL)} />
          {locations.map((l) => (
            <ScopeTab
              key={l.id}
              label={l.name}
              active={scope === l.id}
              onClick={() => setScope(l.id)}
            />
          ))}
        </div>
      </div>

      {/* summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("มูลค่าสต๊อก")} value={`฿ ${fmtMoney(stats.value)}`} /* ฿ is a currency symbol — i18n-key */ icon="report" hint={t("อิงต้นทุนที่กรอก")} />
        <StatCard label={t("จำนวนสินค้า")} value={`${products.length}`} icon="package" hint={t("รายการทั้งหมด")} />
        <StatCard
          label={t("ใกล้/ต่ำกว่าขั้นต่ำ")}
          value={`${lowStock.length}`}
          icon="warning"
          danger={lowStock.length > 0}
        />
        <StatCard label={t("เคลื่อนไหววันนี้")} value={`${stats.todayMoves}`} icon="history" hint={formatThaiDate(todayMs())} />
      </div>

      {/* low stock alert */}
      {lowStock.length > 0 && (
        <Card className="border-rose-200 bg-rose-50/50 p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold text-rose-700">
            <Icon name="warning" size={16} />
            {t('แจ้งเตือนสินค้าเหลือน้อย ({n})', { n: lowStock.length })}
          </div>
          <div className="flex flex-wrap gap-2">
            {lowStock.slice(0, 20).map((it) => (
              <div
                key={`${it.location.id}-${it.product.id}`}
                className="flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm"
              >
                <ProductThumb productId={it.product.id} hasImage={it.product.hasImage} size={24} />
                <span className="font-medium text-slate-700">{it.product.name}</span>
                <span className="text-rose-600">
                  {fmtQty(it.qty)}/{fmtQty(it.min)} {it.product.unitType}
                </span>
                {scope === ALL && <Badge color="slate">{it.location.name}</Badge>}
              </div>
            ))}
            {lowStock.length > 20 && (
              <span className="self-center text-sm text-rose-600">
                {t('และอีก {n} รายการ...', { n: lowStock.length - 20 })}
              </span>
            )}
          </div>
        </Card>
      )}

      {/* chart */}
      {byCategory.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 font-semibold text-slate-700">{t("มูลค่าสต๊อกตามหมวดหมู่ (บาท)")}</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byCategory} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `฿ ${fmtMoney(Number(v))}`} /* i18n-key */ />
              <Bar dataKey="value" fill="#b91c1c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-slate-400">
            {t("* มูลค่าจะแสดงเมื่อกรอกต้นทุนต่อหน่วยในหน้าสินค้า")}
          </p>
        </Card>
      )}

      {/* stock table */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 p-3">
          <Input
            placeholder={t("ค้นหาสินค้าในคลังนี้…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>
        {tableRows.length === 0 ? (
          <EmptyState icon="package" title={t("ไม่พบสินค้า")} />
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-260px)]">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500 shadow-sm">
                <tr>
                  <th className="px-3 py-2">{t("สินค้า")}</th>
                  {scope === ALL &&
                    locations.map((l) => (
                      <th key={l.id} className="px-3 py-2 text-right">
                        {l.name}
                      </th>
                    ))}
                  <th className="px-3 py-2 text-right">
                    {scope === ALL ? t("รวม") : t("คงเหลือ")}
                  </th>
                  <th className="px-3 py-2 text-right">{t("ขั้นต่ำ")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tableRows.map(({ p, total }) => {
                  const min =
                    scope === ALL ? p.minStock : minFor(p, scope)
                  const low = min > 0 && total <= min
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <ProductThumb productId={p.id} hasImage={p.hasImage} size={32} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-700">{p.name}</div>
                            <div className="text-xs text-slate-400">{p.category}</div>
                          </div>
                        </div>
                      </td>
                      {scope === ALL &&
                        locations.map((l) => (
                          <td key={l.id} className="px-3 py-2 text-right text-slate-600">
                            {fmtQty(qtyAt(l.id, p.id))}
                          </td>
                        ))}
                      <td className="px-3 py-2 text-right font-semibold">
                        <span className={low ? 'text-rose-600' : 'text-slate-800'}>
                          {fmtQty(total)}
                        </span>{' '}
                        <span className="text-xs text-slate-400">{p.unitType}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{fmtQty(min)}</td>
                      <td className="px-3 py-2 text-right">
                        {total <= 0 ? (
                          <Badge color="slate">{t("หมด")}</Badge>
                        ) : low ? (
                          <Badge color="red">{t("ใกล้หมด")}</Badge>
                        ) : (
                          <Badge color="green">{t("ปกติ")}</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function ScopeTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-white text-red-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * One headline figure.
 *
 * The number is the largest thing in the card and set in fixed-width figures, because the
 * job of this row is to be read at a glance from standing distance — and because a value
 * that changes should not shuffle the digits beside it sideways.
 */
function StatCard({
  label,
  value,
  icon,
  hint,
  danger,
}: {
  label: string
  value: string
  icon: IconName
  hint?: string
  danger?: boolean
}) {
  return (
    <Card
      tone={danger ? 'plain' : 'plain'}
      className={`p-4 ${danger ? 'border-danger/30 bg-danger-soft' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-ink-soft">{label}</div>
        <Icon name={icon} size={18} className={danger ? 'text-danger' : 'text-ink-faint'} />
      </div>
      <div className={`num mt-1 text-3xl font-bold ${danger ? 'text-danger' : 'text-ink'}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>}
    </Card>
  )
}
