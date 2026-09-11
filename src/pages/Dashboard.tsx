import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { useData } from '../data/DataContext'
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  Input,
  PageHeader,
  SegTab,
  Spinner,
  StatGroup,
  StatTile,
} from '../components/ui'
import { DataTable, type Column } from '../components/DataTable'
import { ProductThumb } from '../components/ProductThumb'
import { fmtMoney, fmtQty, formatThaiDateShort, todayMs } from '../lib/format'
import type { Product, StockLocation } from '../types'
import { useT } from '../i18n/I18nContext'

const ALL = '__all__'
const WEEK = 7 * 86_400_000

interface Row {
  p: Product
  total: number
  min: number
}

interface LowItem {
  product: Product
  location: StockLocation
  qty: number
  min: number
}

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

  const totalQtyOf = (p: Product) => scopeLocations.reduce((s, l) => s + qtyAt(l.id, p.id), 0)

  const lowStock = useMemo(() => {
    const items: LowItem[] = []
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
    let inStock = 0
    for (const p of products) {
      const q = totalQtyOf(p)
      value += q * (p.cost ?? 0)
      if (q > 0) inStock++
    }
    const inScope = new Set(scopeLocations.map((l) => l.id))
    const mine = movements.filter(
      (m) =>
        !m.voided &&
        (scope === ALL ||
          (m.fromLocationId && inScope.has(m.fromLocationId)) ||
          (m.toLocationId && inScope.has(m.toLocationId))),
    )
    // A week rather than today. "Movements today" reads zero on any morning before the
    // first receipt is keyed, and on a Monday it reads zero for the whole weekend — which
    // says nothing about whether the system is being used.
    const since = todayMs() - WEEK
    const recent = mine.filter((m) => m.date >= since).length
    const lastAt = mine.reduce((max, m) => (m.date > max ? m.date : max), 0)
    return { value, inStock, recent, lastAt }
  }, [products, scopeLocations, movements, qtyAt, scope])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of products) {
      const val = totalQtyOf(p) * (p.cost ?? 0)
      map.set(p.category, (map.get(p.category) ?? 0) + val)
    }
    return [...map.entries()]
      .map(([category, value]) => ({ category, value: Math.round(value) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [products, scopeLocations, qtyAt])

  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase()
    return products
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .map((p) => ({
        p,
        total: totalQtyOf(p),
        min: scope === ALL ? p.minStock : minFor(p, scope),
      }))
      .sort((a, b) => a.p.name.localeCompare(b.p.name))
  }, [products, search, scopeLocations, qtyAt, scope, minFor])

  const columns = useMemo<Column<Row>[]>(() => {
    const cols: Column<Row>[] = [
      {
        key: 'product',
        header: t('สินค้า'),
        primary: true,
        cell: ({ p }) => (
          <div className="flex items-center gap-2">
            <ProductThumb productId={p.id} hasImage={p.hasImage} size={32} />
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{p.name}</div>
              <div className="text-xs text-ink-faint">{p.category}</div>
            </div>
          </div>
        ),
      },
    ]
    if (scope === ALL) {
      for (const l of locations) {
        cols.push({
          key: l.id,
          header: l.name,
          align: 'right',
          className: 'num text-ink-soft',
          cell: ({ p }) => fmtQty(qtyAt(l.id, p.id)),
        })
      }
    }
    cols.push(
      {
        key: 'total',
        header: scope === ALL ? t('รวม') : t('คงเหลือ'),
        align: 'right',
        className: 'num',
        cell: ({ p, total, min }) => (
          <>
            <span className={min > 0 && total <= min ? 'font-semibold text-warn' : 'font-semibold text-ink'}>
              {fmtQty(total)}
            </span>{' '}
            <span className="text-xs font-normal text-ink-faint">{p.unitType}</span>
          </>
        ),
      },
      {
        key: 'min',
        header: t('ขั้นต่ำ'),
        align: 'right',
        className: 'num text-ink-soft',
        cell: ({ min }) => fmtQty(min),
      },
      {
        key: 'status',
        header: t('สถานะ'),
        align: 'right',
        cell: ({ total, min }) =>
          total <= 0 ? (
            <Badge color="slate">{t('หมด')}</Badge>
          ) : min > 0 && total <= min ? (
            <Badge color="red">{t('ใกล้หมด')}</Badge>
          ) : (
            <Badge color="green">{t('ปกติ')}</Badge>
          ),
      },
    )
    return cols
  }, [scope, locations, qtyAt, t])

  if (loading) return <Spinner label={t('กำลังโหลดภาพรวม...')} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader icon="dashboard" title={t('ภาพรวมสต๊อก')} />
        <div className="flex flex-wrap gap-1 rounded-lg bg-sunken p-1">
          <SegTab
            grow={false}
            label={t('รวมทุกคลัง')}
            active={scope === ALL}
            onClick={() => setScope(ALL)}
          />
          {locations.map((l) => (
            <SegTab
              key={l.id}
              grow={false}
              label={l.name}
              active={scope === l.id}
              onClick={() => setScope(l.id)}
            />
          ))}
        </div>
      </div>

      {/* One column on a phone, two on a tablet, the wide-plus-narrow pair on a desktop. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <StatGroup title={t('ภาพรวม')}>
            <StatTile
              icon="report"
              tone="brand"
              value={`฿ ${fmtMoney(stats.value)}`} /* ฿ is a currency symbol — i18n-key */
              label={t('มูลค่าสต๊อก')}
              hint={t('อิงต้นทุนที่กรอก')}
            />
            <StatTile
              icon="package"
              value={`${products.length}`}
              label={t('จำนวนสินค้า')}
              hint={t('{n} รายการมีของ', { n: stats.inStock })}
            />
            <StatTile
              icon="warning"
              tone={lowStock.length > 0 ? 'warn' : 'plain'}
              value={`${lowStock.length}`}
              label={t('ใกล้/ต่ำกว่าขั้นต่ำ')}
            />
            <StatTile
              icon="history"
              value={`${stats.recent}`}
              label={t('ความเคลื่อนไหว 7 วัน')}
              hint={
                stats.lastAt > 0
                  ? t('ล่าสุด {date}', { date: formatThaiDateShort(stats.lastAt) })
                  : t('ยังไม่มีรายการ')
              }
            />
          </StatGroup>
        </div>

        <StatGroup title={t('คลังสินค้า')} columns={2}>
          <StatTile
            icon="building"
            value={`${scopeLocations.length}`}
            label={t('คลัง/สาขา')}
            hint={scope === ALL ? t('ทั้งหมด') : t('ที่เลือก')}
          />
          <StatTile
            icon="package"
            tone="in"
            value={`${stats.inStock}`}
            label={t('รายการที่มีของ')}
          />
        </StatGroup>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <CardTitle title={t('มูลค่าสต๊อกตามหมวดหมู่ (บาท)')} className="mb-3" />
          {byCategory.length === 0 ? (
            <EmptyState
              icon="report"
              title={t('ยังไม่มีมูลค่า')}
              hint={t('* มูลค่าจะแสดงเมื่อกรอกต้นทุนต่อหน่วยในหน้าสินค้า')}
            />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={byCategory} margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
                  <XAxis
                    dataKey="category"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fontSize: 11 }} width={56} />
                  <Tooltip formatter={(v) => `฿ ${fmtMoney(Number(v))}`} /* i18n-key */ />
                  {/* The brand token, not a hex value: this bar used to be Pizza Mania red
                      whichever company's books were open. */}
                  <Bar dataKey="value" fill="var(--color-brand)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-1 text-xs text-ink-faint">
                {t('* มูลค่าจะแสดงเมื่อกรอกต้นทุนต่อหน่วยในหน้าสินค้า')}
              </p>
            </>
          )}
        </Card>

        <Card className="flex flex-col p-4">
          <CardTitle
            title={t('สินค้าใกล้หมด')}
            className="mb-3"
            action={
              lowStock.length > 0 ? (
                <Badge color="red">{lowStock.length}</Badge>
              ) : (
                <Badge color="green">{t('ปกติ')}</Badge>
              )
            }
          />
          {lowStock.length === 0 ? (
            <EmptyState icon="check" title={t('ไม่มีรายการที่ต่ำกว่าขั้นต่ำ')} />
          ) : (
            <ul className="-mx-1 max-h-[300px] divide-y divide-line overflow-auto">
              {lowStock.slice(0, 50).map((it) => (
                <li key={`${it.location.id}-${it.product.id}`}>
                  <Link
                    to={`/movements?product=${encodeURIComponent(it.product.id)}`}
                    className="flex items-center gap-2 px-1 py-2 hover:bg-sunken"
                  >
                    <ProductThumb
                      productId={it.product.id}
                      hasImage={it.product.hasImage}
                      size={30}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {it.product.name}
                      </span>
                      <span className="block truncate text-xs text-ink-faint">
                        {scope === ALL ? it.location.name : it.product.category}
                      </span>
                    </span>
                    <span className="num shrink-0 text-right text-sm font-semibold text-warn">
                      {fmtQty(it.qty)}/{fmtQty(it.min)}
                      <span className="ml-1 text-xs font-normal text-ink-faint">
                        {it.product.unitType}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <CardTitle title={t('สต๊อกคงเหลือ')} className="mr-auto" />
          <Input
            placeholder={t('ค้นหาสินค้าในคลังนี้…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:max-w-xs"
          />
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={({ p }) => p.id}
          minWidth={scope === ALL ? 720 : 560}
          maxHeight="calc(100vh - 300px)"
          empty={<EmptyState icon="package" title={t('ไม่พบสินค้า')} />}
        />
      </Card>
    </div>
  )
}
