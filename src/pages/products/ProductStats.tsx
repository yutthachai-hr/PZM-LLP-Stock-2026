import { StatRow, StatTile } from '../../components/frame'
import { useT } from '../../i18n/I18nContext'
import { fmtMoney } from '../../lib/format'
import { change } from '../../lib/stats/periodCompare'
import type { StockState } from './productStatus'

/**
 * The five figures above the product list (mock-up 02). The three state tiles are also the
 * status filter: pressing "ใกล้หมด" shows what is running low, pressing it again clears it.
 *
 * The count tile has no "+12% from last month" (spec §2.2): the number of SKUs going up
 * says nothing about stock. It shows how many are in use and how many are hidden instead.
 */
export function ProductStats({
  total,
  hidden,
  counts,
  value,
  valueBefore,
  selected,
  onSelect,
}: {
  total: number
  hidden: number
  counts: Record<StockState, number>
  value: number
  /** Stock value 30 days ago, or null when the ledger window does not reach back that far. */
  valueBefore: number | null
  selected: StockState | null
  onSelect: (s: StockState | null) => void
}) {
  const t = useT()
  const pct = (n: number) => (total > 0 ? t('{pct}% ของทั้งหมด', { pct: ((n / total) * 100).toFixed(1) }) : '')
  const toggle = (s: StockState) => () => onSelect(selected === s ? null : s)
  const trend = valueBefore !== null && valueBefore > 0 ? change(value, valueBefore) : null
  return (
    <StatRow columns={5}>
      <StatTile
        icon="package"
        tone="brand"
        label={t('จำนวนสินค้าทั้งหมด')}
        value={total}
        unit={t('รายการ')}
        hint={t('ใช้งาน {n} · ซ่อน {m}', { n: total, m: hidden })}
        onClick={() => onSelect(null)}
        selected={selected === null}
      />
      <StatTile
        icon="checkCircle"
        tone="green"
        label={t('สินค้าปกติ')}
        value={counts.normal}
        unit={t('รายการ')}
        hint={pct(counts.normal)}
        onClick={toggle('normal')}
        selected={selected === 'normal'}
      />
      <StatTile
        icon="alertCircle"
        tone="amber"
        valueTone="amber"
        label={t('สินค้าใกล้หมด')}
        value={counts.low}
        unit={t('รายการ')}
        hint={pct(counts.low)}
        onClick={toggle('low')}
        selected={selected === 'low'}
      />
      <StatTile
        icon="xCircle"
        tone="red"
        valueTone="red"
        label={t('สินค้าหมด')}
        value={counts.out}
        unit={t('รายการ')}
        hint={pct(counts.out)}
        onClick={toggle('out')}
        selected={selected === 'out'}
      />
      <StatTile
        icon="box"
        tone="purple"
        label={t('มูลค่าสินค้าคงคลัง (โดยประมาณ)')}
        value={`฿ ${fmtMoney(value)}`} /* ฿ is a currency symbol — i18n-key */
        trend={trend && !trend.flat ? { text: trend.text, up: trend.up, suffix: t('จาก 30 วันก่อน') } : undefined}
        hint={t('อิงต้นทุนที่กรอก')}
      />
    </StatRow>
  )
}
