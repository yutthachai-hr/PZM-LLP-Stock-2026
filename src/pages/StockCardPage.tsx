import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useData } from '../data/DataContext'
import { useBrand } from '../brand/BrandContext'
import { brandDef } from '../brand/brand'
import { useT } from '../i18n/I18nContext'
import { errText } from '../i18n/AppError'
import { AreaTrendChart } from '../components/charts'
import { FilterBar, FilterField, FramePage, PageHero, SectionCard, StatRow, StatTile, StatusChip, frameCard, toneIcon } from '../components/frame'
import { DataTable, type Column } from '../components/DataTable'
import { Icon } from '../components/Icon'
import { ProductThumb } from '../components/ProductThumb'
import { SiteChip, SiteSelect } from '../components/SiteChip'
import { Button, EmptyState, Input, Select, Spinner } from '../components/ui'
import { TYPE_COLOR, TYPE_LABEL } from '../components/movements/labels'
import { useMovementHistory } from '../data/useMovementHistory'
import { HistoryReadNotice } from '../components/HistoryReadNotice'
import { currentCost } from '../services/productCost'
import { categoryIcon } from '../lib/categoryIcon'
import { dayRange, fmtMoney, fmtQty, formatThaiDate, formatThaiDateTime, msToDateInput } from '../lib/format'
import { bkkDayStart, DAY_MS } from '../lib/inventoryRules/time'
import { balanceUnit, stockCard, type StockCardRow } from '../lib/ledger'
import { balanceSeries } from '../lib/stats/balanceSeries'
import { hasMixedLegacyUnits, mergeReportMovements } from '../lib/reportHistory'
import type { MovementType } from '../types'
import { STATE_LOOK, stockState } from './products/productStatus'
import { movementNote } from '../lib/receiptLabel'

/**
 * ประวัติ/Stock Card for one product (owner's mock-up 06, spec §2.7): what it is and where it
 * stands, the period's in/out/adjust totals, its balance over the last days, and every row
 * that moved it with the balance each one left behind.
 *
 * Reads that product's movements only (services/stock.ts readProductLedger), not the whole
 * ledger, and lays the live listener's rows over them so today's filings show at once.
 */
export function StockCardPage() {
  const t = useT()
  const { id = '' } = useParams()
  const { productById, locations, qtyAt, companyQty, transitQty, minFor, movements, loading } = useData()
  // Product history is read on demand (readProductLedger), overlaid with the live 7-day window.
  const { brand } = useBrand()
  const product = productById(id)

  const today = bkkDayStart(Date.now())
  const [locationId, setLocationId] = useState('')
  const [fromStr, setFromStr] = useState(msToDateInput(today - 29 * DAY_MS))
  const [toStr, setToStr] = useState(msToDateInput(today))
  const [typeFilter, setTypeFilter] = useState<MovementType | ''>('')
  const [trendDays, setTrendDays] = useState(14)
  const history = useMovementHistory(id)
  const ledger = history.ready ? history.rows : null
  const ledgerLoading = history.status === 'loading' || history.status === 'idle'
  const range = dayRange(fromStr, toStr)
  const validRange = range.valid !== false && range.from < range.to
  const [exportError, setError] = useState('')
  const error = history.error || (!validRange ? t('ช่วงวันที่ไม่ถูกต้อง') : exportError)
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null)

  // The product's full history, with the live window's copies laid over it (newer edits,
  // voids and rows filed since the read).
  const all = useMemo(() => {
    if (ledgerLoading || !ledger || error) return []
    return mergeReportMovements(ledger, movements.filter(m => m.productId === id))
  }, [ledgerLoading, ledger, movements, id, error])

  const card = useMemo(() => {
    if (ledgerLoading || !ledger || error) {
      return { opening: 0, rows: [], totalIn: 0, totalOut: 0, closing: 0 }
    }
    const { from, to, valid } = dayRange(fromStr, toStr)
    if (valid === false) {
      return { opening: 0, rows: [], totalIn: 0, totalOut: 0, closing: 0 }
    }
    return stockCard(all, { productId: id, locationId: locationId || undefined, from, to, type: typeFilter, overallBalance: true })
  }, [ledgerLoading, ledger, all, id, locationId, fromStr, toStr, typeFilter, error])

  const hasLegacy = useMemo(() => hasMixedLegacyUnits(all), [all])
  // All sites is the company total, goods in transit included: the same figure the all-sites
  // ledger below arrives at, since a transfer between our sites moves nothing overall.
  const current = product ? (locationId ? qtyAt(locationId, product.id) : companyQty(product.id)) : 0
  const inTransit = product && !locationId ? transitQty(product.id) : 0
  const min = product ? (locationId ? minFor(product, locationId) : product.minStock) : 0
  const cost = product ? (product.cost ?? currentCost(product.costHistory ?? []) ?? 0) : 0
  const state = stockState(current, min)
  const series = useMemo(
    () => (product && !ledgerLoading && !error && !hasLegacy ? balanceSeries(all, { productId: product.id, current, today, days: trendDays, locationId: locationId || undefined }) : []),
    [all, product, ledgerLoading, error, hasLegacy, current, today, trendDays, locationId],
  )

  const totals = useMemo(() => {
    const r = { inQty: 0, inN: 0, outQty: 0, outN: 0, adj: 0, adjN: 0 }
    for (const row of card.rows) {
      if (row.movement.type === 'adjust') {
        r.adj += row.inQty - row.outQty
        r.adjN++
      } else if (row.inQty > 0) {
        r.inQty += row.inQty
        r.inN++
      } else if (row.outQty > 0) {
        r.outQty += row.outQty
        r.outN++
      }
    }
    return r
  }, [card])

  const rows = useMemo(() => [...card.rows].reverse(), [card])
  const siteName = (lid?: string) => (lid ? (locations.find((l) => l.id === lid)?.name ?? '') : '')

  const columns = useMemo<Column<StockCardRow>[]>(
    () => [
      {
        key: 'date',
        header: t('วันที่'),
        primary: true,
        className: 'whitespace-nowrap',
        cell: (r) => formatThaiDate(r.movement.date),
      },
      { key: 'doc', header: t('เลขที่เอกสาร'), className: 'doc-no whitespace-nowrap text-ink-soft', cell: (r) => r.movement.docNo },
      {
        key: 'type',
        header: t('การเคลื่อนไหว'),
        cell: (r) => (
          <StatusChip tone={TYPE_COLOR[r.movement.type]} icon={r.inQty > 0 ? 'arrowDown' : 'arrowUp'} size="sm">
            {t(TYPE_LABEL[r.movement.type])}
          </StatusChip>
        ),
      },
      { key: 'in', header: t('รับเข้า'), align: 'right', className: 'num text-in', cell: (r) => (r.inQty ? fmtQty(r.inQty) : '–') },
      { key: 'out', header: t('จ่ายออก'), align: 'right', className: 'num text-out', cell: (r) => (r.outQty ? fmtQty(r.outQty) : '–') },
      { key: 'unit', header: t('หน่วย'), cell: (r) => balanceUnit(r.movement) },
      { key: 'recorded', header: t('เวลาที่บันทึก'), cell: (r) => formatThaiDateTime(r.movement.createdAt) },
      { key: 'bal', header: t('คงเหลือ'), card: 'value', align: 'right', className: 'num font-semibold', cell: (r) => (hasLegacy || r.balance === null ? '' : fmtQty(r.balance)) },
      {
        key: 'site',
        header: t('สาขา'),
        cell: (r) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <SiteChip locationId={r.movement.fromLocationId} />
            {r.movement.fromLocationId && r.movement.toLocationId ? <span className="text-ink-faint">→</span> : null}
            <SiteChip locationId={r.movement.toLocationId} />
          </span>
        ),
      },
      { key: 'by', header: t('ผู้บันทึก'), className: 'text-ink-soft', cell: (r) => r.movement.byUserName },
      { key: 'note', header: t('หมายเหตุ'), className: 'text-xs text-ink-soft', cell: (r) => movementNote(r.movement, t) },
    ],
    [t, hasLegacy],
  )

  if (loading) return <Spinner label={t('กำลังโหลด...')} />
  if (!product) {
    return (
      <FramePage>
        <PageHero icon="history" title={t('ประวัติ/Stock Card')} />
        <div className={frameCard}>
          <EmptyState icon="search" title={t('ไม่พบสินค้า')} hint={t('สินค้านี้อาจถูกลบหรือไม่ได้อยู่ในแบรนด์นี้')} />
        </div>
      </FramePage>
    )
  }

  const unit = product.unitType
  const look = categoryIcon(product.category)
  const exportRows = rows.map((r) => ({
    [t('วันที่')]: formatThaiDate(r.movement.date),
    [t('เวลาที่บันทึก')]: formatThaiDateTime(r.movement.createdAt),
    [t('เลขที่เอกสาร')]: r.movement.docNo,
    [t('การเคลื่อนไหว')]: t(TYPE_LABEL[r.movement.type]),
    [t('รับเข้า')]: r.inQty || '',
    [t('จ่ายออก')]: r.outQty || '',
    [t('หน่วย')]: balanceUnit(r.movement),
    [t('คงเหลือ')]: hasLegacy ? '' : (r.balance ?? ''),
    [t('สาขา')]: [siteName(r.movement.fromLocationId), siteName(r.movement.toLocationId)].filter(Boolean).join(' → '),
    [t('ผู้บันทึก')]: r.movement.byUserName,
    [t('หมายเหตุ')]: movementNote(r.movement, t),
  }))
  const fileBase = `stock-card-${product.sku}`

  return (
    <FramePage>
      <PageHero icon="history" title={t('ประวัติ/Stock Card')} subtitle={t('ดูประวัติการเคลื่อนไหวของสินค้า แบบละเอียดทุกการรับ-จ่าย-โอน-ปรับสต๊อก')} />
      <nav aria-label={t('ตำแหน่ง')} className="-mt-2 flex items-center gap-2 text-sm text-ink-soft">
        <Link to="/products" className="hover:text-brand hover:underline">
          {t('สินค้าคงคลัง')}
        </Link>
        <Icon name="chevronRight" size={14} />
        <span className="truncate text-ink">{product.name}</span>
      </nav>

      {/* What it is and where it stands. */}
      <section className={`${frameCard} grid gap-4 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_auto]`}>
        <div className="flex min-w-0 gap-4">
          {product.hasImage ? (
            <ProductThumb productId={product.id} hasImage size={96} />
          ) : (
            <span className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl ${toneIcon[look.tone]}`}>
              <Icon name={look.icon} size={40} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-snug text-ink md:text-xl">{product.name}</h2>
            <div className="doc-no text-sm text-ink-soft">SKU: {product.sku}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusChip tone={look.tone} icon={null} size="sm">
                {product.category}
              </StatusChip>
              {product.active === false ? (
                <StatusChip tone="slate" size="sm">{t('ที่ซ่อนไว้')}</StatusChip>
              ) : (
                <StatusChip tone="green" icon={null} size="sm">{t('ใช้งานอยู่')}</StatusChip>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-ink-faint">{t('หน่วยนับ')}</dt>
                <dd className="font-semibold text-ink">{unit}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">{t('จุดสั่งซื้อ (ROP)')}</dt>
                <dd className="num font-semibold text-ink">{fmtQty(min)} {unit}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">{t('ยอดคงเหลือปัจจุบัน')}</dt>
                <dd className="num text-lg font-bold text-ink">{fmtQty(current)} {unit}</dd>
                {inTransit > 0 && <dd className="num text-xs text-ink-faint">{t('รวมระหว่างขนส่ง {qty} {unit}', { qty: fmtQty(inTransit), unit })}</dd>}
              </div>
              <div>
                <dt className="text-xs text-ink-faint">{t('คลัง')}</dt>
                <dd className="font-semibold text-ink">{locationId ? siteName(locationId) : t('ทุกคลังรวมกัน')}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:flex xl:items-stretch">
          <div className="rounded-xl border border-line px-4 py-3 xl:min-w-36">
            <div className="text-xs text-ink-faint">{t('ต้นทุนล่าสุด')}</div>
            <div className="num text-xl font-bold text-ink">฿ {fmtMoney(cost)}</div> {/* i18n-key */}
            <div className="text-xs text-ink-faint">{t('ต่อ {unit}', { unit })}</div>
          </div>
          <div className="rounded-xl border border-line px-4 py-3 xl:min-w-36">
            <div className="text-xs text-ink-faint">{t('มูลค่าสินค้าคงเหลือ')}</div>
            <div className="num text-xl font-bold text-ink">฿ {fmtMoney(Math.max(0, current) * cost)}</div> {/* i18n-key */}
            <div className="text-xs text-ink-faint">({fmtQty(current)} {unit})</div>
          </div>
          <div className={`col-span-2 flex items-center gap-3 rounded-xl px-4 py-3 sm:col-span-1 xl:min-w-44 ${toneIcon[STATE_LOOK[state].tone]}`}>
            <Icon name={state === 'normal' ? 'checkCircle' : state === 'low' ? 'alertCircle' : 'xCircle'} size={32} />
            <div>
              <div className="text-xs opacity-80">{t('สถานะสต๊อก')}</div>
              <div className="text-lg font-bold">{t(STATE_LOOK[state].label)}</div>
              {min > 0 && <div className="text-xs opacity-80">{t('จุดสั่งซื้อ {min} {unit}', { min: fmtQty(min), unit })}</div>}
            </div>
          </div>
        </div>
      </section>

      <FilterBar
        onReset={() => {
          setFromStr(msToDateInput(today - 29 * DAY_MS))
          setToStr(msToDateInput(today))
          setLocationId('')
          setTypeFilter('')
        }}
      >
        <FilterField label={t('ตั้งแต่วันที่')}>
          <Input type="date" value={fromStr} max={toStr} onChange={(e) => setFromStr(e.target.value)} />
        </FilterField>
        <FilterField label={t('ถึงวันที่')}>
          <Input type="date" value={toStr} min={fromStr} onChange={(e) => setToStr(e.target.value)} />
        </FilterField>
        <FilterField label={t('สาขา')}>
          <SiteSelect value={locationId} onChange={setLocationId} locations={locations} emptyLabel={t('ทุกสาขา')} className="w-full" />
        </FilterField>
        <FilterField label={t('ประเภทการเคลื่อนไหว')}>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as MovementType | '')}>
            <option value="">{t('ทั้งหมด')}</option>
            {(Object.keys(TYPE_LABEL) as MovementType[]).map((k) => (
              <option key={k} value={k}>
                {t(TYPE_LABEL[k])}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      <HistoryReadNotice status={history.status} count={history.rows.length} error={history.error} retry={history.retry} product />
      <StatRow columns={4}>
        <StatTile
          icon="arrowDown"
          tone="green"
          label={t('รับเข้า (ยอดรวม)')}
          value={ledgerLoading || error || hasLegacy ? '–' : `${fmtQty(totals.inQty)} ${unit}`}
          hint={ledgerLoading ? t('กำลังโหลด...') : error ? error : hasLegacy ? t('มีรายการหน่วยเดิมที่ยังไม่ได้แปลงหน่วย') : t('{n} รายการ', { n: totals.inN })}
        />
        <StatTile
          icon="arrowUp"
          tone="red"
          label={t('จ่ายออก (ยอดรวม)')}
          value={ledgerLoading || error || hasLegacy ? '–' : `${fmtQty(totals.outQty)} ${unit}`}
          hint={ledgerLoading ? t('กำลังโหลด...') : error ? error : hasLegacy ? t('มีรายการหน่วยเดิมที่ยังไม่ได้แปลงหน่วย') : t('{n} รายการ', { n: totals.outN })}
        />
        <StatTile
          icon="swap"
          tone="slate"
          label={t('ปรับปรุงสต๊อก')}
          value={ledgerLoading || error || hasLegacy ? '–' : `${totals.adj > 0 ? '+' : totals.adj < 0 ? '−' : ''}${fmtQty(Math.abs(totals.adj))} ${unit}`}
          hint={ledgerLoading ? t('กำลังโหลด...') : error ? error : hasLegacy ? t('มีรายการหน่วยเดิมที่ยังไม่ได้แปลงหน่วย') : t('{n} รายการ', { n: totals.adjN })}
        />
        <StatTile
          icon="report"
          tone="blue"
          label={t('ยอดคงเหลือปัจจุบัน')}
          value={`${fmtQty(current)} ${unit}`}
          hint={t('ณ {date}', { date: formatThaiDateTime(Date.now()) })}
        />
      </StatRow>
      {hasLegacy && (
        <div role="status" className="rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
          {t('มีรายการหน่วยเดิมที่ยังไม่ได้แปลงหน่วย')}
        </div>
      )}

      <SectionCard
        icon="chart"
        title={t('แนวโน้มสต๊อกย้อนหลัง')}
        actions={
          <Select value={trendDays} onChange={(e) => setTrendDays(Number(e.target.value))} className="w-auto" aria-label={t('ช่วงเวลา')}>
            {[14, 30, 60].map((d) => (
              <option key={d} value={d}>
                {t('{n} วันล่าสุด', { n: d })}
              </option>
            ))}
          </Select>
        }
      >
        {error ? (
          <p className="p-4 text-sm text-danger">{error}</p>
        ) : ledgerLoading ? (
          <Spinner />
        ) : (
          <AreaTrendChart
            data={series.map((p) => {
              const d = new Date(p.day + 7 * 3_600_000)
              return { label: `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`, balance: p.balance }
            })}
            xKey="label"
            height={220}
            series={[{ key: 'balance', label: t('คงเหลือ'), color: 'var(--color-brand)' }]}
            format={(v) => fmtQty(v)}
          />
        )}
      </SectionCard>

      <SectionCard
        icon="list"
        title={t('ประวัติการเคลื่อนไหว')}
        count={ledgerLoading ? '' : t('({n} รายการ)', { n: rows.length })}
        flush
        actions={
          <>
            <Button
              variant="pdf"
              size="sm"
              disabled={ledgerLoading || !!error || rows.length === 0 || !!exporting || hasLegacy}
              onClick={async () => {
                if (!product || ledgerLoading || error || hasLegacy) return
                setExporting('pdf')
                try {
                  const { exportReportPdf } = await import('../lib/export')
                  await exportReportPdf({
                    filename: fileBase,
                    title: t('Stock Card — {name}', { name: product.name }),
                    meta: [brand ? brandDef(brand).name : '', `SKU ${product.sku}`, `${fromStr} → ${toStr}`, locationId ? siteName(locationId) : t('ทุกคลังรวมกัน')],
                    head: Object.keys(exportRows[0] ?? {}),
                    body: exportRows.map((r) => Object.values(r)),
                  })
                } catch (e) {
                  setError(errText(e, t))
                } finally {
                  setExporting(null)
                }
              }}
            >
              <Icon name="download" size={16} />
              PDF
            </Button>
            <Button
              variant="sheet"
              size="sm"
              disabled={ledgerLoading || !!error || rows.length === 0 || !!exporting || hasLegacy}
              onClick={async () => {
                if (!product || ledgerLoading || error || hasLegacy) return
                setExporting('excel')
                try {
                  const { exportExcel } = await import('../lib/export')
                  await exportExcel(fileBase, 'Stock Card', exportRows)
                } catch (e) {
                  setError(errText(e, t))
                } finally {
                  setExporting(null)
                }
              }}
            >
              <Icon name="download" size={16} />
              Excel
            </Button>
          </>
        }
      >
        {error ? (
          <p className="px-5 pb-5 text-sm text-danger">{error}</p>
        ) : ledgerLoading ? (
          <Spinner />
        ) : (
          <div className="pb-2 md:px-5 md:pb-5">
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.movement.id}
              minWidth={900}
              maxHeight="calc(100vh - 220px)"
              rowClassName={(r) => (r.movement.voided ? 'opacity-50 line-through' : '')}
              empty={<EmptyState icon="history" title={t('ไม่มีการเคลื่อนไหวในช่วงนี้')} />}
            />
          </div>
        )}
      </SectionCard>
    </FramePage>
  )
}
