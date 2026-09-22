import { useMemo, useState } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import { Button, Card, EmptyState, SearchInput, Select } from '../../components/ui'
import { useData } from '../../data/DataContext'
import { useT } from '../../i18n/I18nContext'
import { fmtMoney, fmtQty, formatThaiDateShort } from '../../lib/format'
import { looseMatch } from '../../lib/search'
import type { CostEntry, Product } from '../../types'

/**
 * Every product's price: what it costs now, what it cost before, when it changed and by
 * whom — across the whole catalogue of the open brand, downloadable (owner, 22 Sep 2026:
 * "ต้องดูได้ราคาไหนเก่า ราคาไหนใหม่ ปรับตอนไหน").
 *
 * Reads nothing: the catalogue is in memory and the history rides on each product.
 */
interface Row {
  p: Product
  latest?: CostEntry
  previous?: CostEntry
  changes: number
  /** Percentage move from the previous price, per base unit. */
  movePct?: number
}

type Filter = 'all' | 'changed' | 'nocost'

export function CostReport() {
  const t = useT()
  const { products, locations, qtyAt } = useData()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo<Row[]>(() => {
    return products
      .filter((p) => p.active !== false)
      .map((p) => {
        const hist = [...(p.costHistory ?? [])].sort((a, b) => b.effectiveAt - a.effectiveAt || b.at - a.at)
        const latest = hist[0]
        const previous = hist[1]
        const movePct = latest && previous && previous.cost > 0 ? Math.round(((latest.cost - previous.cost) / previous.cost) * 1000) / 10 : undefined
        return { p, latest, previous, changes: hist.length, movePct }
      })
      .filter((r) => looseMatch([r.p.name, r.p.sku, r.p.category], q))
      .filter((r) => (filter === 'changed' ? r.changes >= 2 : filter === 'nocost' ? r.p.cost === undefined : true))
      .sort((a, b) => (b.latest?.at ?? 0) - (a.latest?.at ?? 0) || a.p.name.localeCompare(b.p.name))
  }, [products, q, filter])

  const onHand = (p: Product) => locations.reduce((s, l) => s + qtyAt(l.id, p.id), 0)

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: 'product',
        header: t('สินค้า'),
        primary: true,
        cell: (r) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{r.p.name}</div>
            <div className="doc-no text-xs text-ink-faint">
              {r.p.sku} · {r.p.category}
            </div>
          </div>
        ),
      },
      {
        key: 'cost',
        header: t('ต้นทุนตอนนี้'),
        align: 'right',
        card: 'value',
        className: 'num font-semibold',
        cell: (r) => (r.p.cost !== undefined ? `฿${fmtMoney(r.p.cost)} / ${r.p.unitType}` : <span className="text-ink-faint">—</span>), // ฿ is a currency symbol — i18n-key
      },
      {
        key: 'keyed',
        header: t('ราคาที่กรอก'),
        className: 'num text-ink-soft',
        cell: (r) => (r.latest ? `฿${fmtMoney(r.latest.price)} / ${r.latest.unit}` : ''), // ฿ is a currency symbol — i18n-key
      },
      {
        key: 'since',
        header: t('มีผลตั้งแต่'),
        className: 'whitespace-nowrap',
        cell: (r) => (r.latest ? formatThaiDateShort(r.latest.effectiveAt) : ''),
      },
      {
        key: 'prev',
        header: t('ราคาก่อนหน้า'),
        className: 'num text-ink-soft',
        cell: (r) =>
          r.previous ? (
            <>
              ฿{fmtMoney(r.previous.cost)} {/* i18n-key */}
              {r.movePct !== undefined && (
                <span className={`ml-1 text-xs ${r.movePct > 0 ? 'text-out' : r.movePct < 0 ? 'text-in' : 'text-ink-faint'}`}>
                  {r.movePct > 0 ? '+' : ''}
                  {r.movePct}%
                </span>
              )}
            </>
          ) : (
            ''
          ),
      },
      { key: 'changes', header: t('ครั้ง'), align: 'right', className: 'num', cell: (r) => (r.changes ? r.changes : '') },
      { key: 'by', header: t('โดย'), className: 'text-xs text-ink-soft', cell: (r) => r.latest?.byName ?? '' },
      {
        key: 'value',
        header: t('มูลค่าคงเหลือ'),
        align: 'right',
        className: 'num',
        card: 'hidden',
        cell: (r) => (r.p.cost !== undefined ? `฿${fmtMoney(onHand(r.p) * r.p.cost)}` : ''), // ฿ is a currency symbol — i18n-key
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locations, qtyAt],
  )

  async function exportXlsx() {
    const { exportExcel } = await import('../../lib/export')
    const out: Record<string, string | number>[] = []
    for (const r of rows) {
      const hist = [...(r.p.costHistory ?? [])].sort((a, b) => a.effectiveAt - b.effectiveAt)
      if (hist.length === 0) {
        out.push({ [t('สินค้า')]: r.p.name, SKU: r.p.sku, [t('หมวดหมู่')]: r.p.category, [t('หน่วย')]: r.p.unitType, [t('ต้นทุนตอนนี้')]: r.p.cost ?? '' })
        continue
      }
      for (const h of hist) {
        out.push({
          [t('สินค้า')]: r.p.name,
          SKU: r.p.sku,
          [t('หมวดหมู่')]: r.p.category,
          [t('หน่วย')]: r.p.unitType,
          [t('มีผลตั้งแต่')]: formatThaiDateShort(h.effectiveAt),
          [t('ราคาที่กรอก')]: h.price,
          [t('ต่อ 1')]: h.unit,
          [t('ต้นทุน/หน่วยหลัก')]: h.cost,
          [t('โดย')]: h.byName,
          [t('หมายเหตุ')]: h.note ?? '',
          [t('คงเหลือ')]: fmtQty(onHand(r.p)),
        })
      }
    }
    exportExcel(t('ราคาต้นทุน_{ts}', { ts: Date.now() }), 'Costs', out)
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder={t('ค้นหาสินค้า / รหัส / หมวด')} className="col-span-2 sm:flex-1" />
        <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">{t('ทุกสินค้า')}</option>
          <option value="changed">{t('เคยปรับราคา')}</option>
          <option value="nocost">{t('ยังไม่มีต้นทุน')}</option>
        </Select>
        <Button variant="sheet" onClick={() => void exportXlsx()}>
          Excel
        </Button>
      </div>
      <p className="text-xs text-ink-soft">{t('{n} รายการ · ต้นทุนคิดต่อหน่วยหลักของสินค้าเสมอ ราคาที่กรอกเป็นลัง/แพ็คจะถูกหารให้', { n: rows.length })}</p>
      {rows.length === 0 ? (
        <EmptyState icon="report" title={t('ไม่พบสินค้า')} />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.p.id} minWidth={900} maxHeight="calc(100vh - 320px)" />
      )}
    </Card>
  )
}
