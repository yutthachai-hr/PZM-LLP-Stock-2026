import { useMemo, type ReactNode } from 'react'
import { useData } from '../../data/DataContext'
import { useT } from '../../i18n/I18nContext'
import { fmtMoney, formatThaiDateShort } from '../../lib/format'
import { bkkDayStart } from '../../lib/inventoryRules/time'
import { isTransfer } from '../../lib/stats/periodCompare'
import type { MovementType, StockMovement } from '../../types'
import { SummaryList, TipCard, type SummaryRow } from '../frame'
import { TodayTransactions } from '../movements/TodayTransactions'

/**
 * The column beside a keying form (owner's mock-ups 03/04, spec §2.3–2.5): what was done
 * today in figures, the day's rows — editable in place, as the owner asked on 20 Sep — and
 * a few lines of advice. Reads nothing: the ledger window is already in memory.
 */
export type KeyingKind = 'receive' | 'transfer' | 'consume' | 'adjust'

const TYPES: Record<KeyingKind, MovementType[]> = {
  receive: ['receive'],
  transfer: ['issue'],
  consume: ['consume'],
  adjust: ['adjust'],
}

function docs(rows: StockMovement[], pred: (m: StockMovement) => boolean = () => true): number {
  return new Set(rows.filter(pred).map((m) => m.docNo)).size
}

export function useDaySummary(kind: KeyingKind, day: number): SummaryRow[] {
  const t = useT()
  const { movements, productById } = useData()
  return useMemo(() => {
    const start = bkkDayStart(day)
    const all = movements.filter((m) => TYPES[kind].includes(m.type) && bkkDayStart(m.date) === start)
    const live = all.filter((m) => !m.voided)
    const voided = docs(all, (m) => !!m.voided)
    const value = (rows: StockMovement[]) => rows.reduce((s, m) => s + m.qty * (productById(m.productId)?.cost ?? 0), 0)
    const cancelled: SummaryRow = { key: 'void', icon: 'xCircle', tone: 'red', label: t('ยกเลิก'), value: t('{n} ใบ', { n: voided }), strong: voided > 0 }
    if (kind === 'adjust') {
      const up = live.filter((m) => !!m.toLocationId)
      const down = live.filter((m) => !!m.fromLocationId)
      const net = value(up) - value(down)
      return [
        { key: 'docs', icon: 'report', tone: 'blue', label: t('จำนวนใบทั้งหมด'), value: t('{n} ใบ', { n: docs(live) }) },
        { key: 'up', icon: 'arrowUp', tone: 'green', label: t('ปรับเพิ่ม'), value: t('{n} รายการ', { n: up.length }) },
        { key: 'down', icon: 'arrowDown', tone: 'red', label: t('ปรับลด'), value: t('{n} รายการ', { n: down.length }) },
        {
          key: 'value',
          icon: 'chart',
          tone: net < 0 ? 'red' : 'green',
          label: t('มูลค่ารวมการปรับ'),
          value: `${net > 0 ? '+' : net < 0 ? '−' : ''}฿ ${fmtMoney(Math.abs(net))}`, // i18n-key
          strong: net !== 0,
        },
      ]
    }
    if (kind === 'transfer' || kind === 'consume') {
      const issues = movements.filter((m) => (m.type === 'issue' || m.type === 'consume') && bkkDayStart(m.date) === start && !m.voided)
      return [
        { key: 'docs', icon: 'report', tone: 'blue', label: t('จำนวนใบทั้งหมด'), value: t('{n} ใบ', { n: docs(issues) }) },
        { key: 'transfer', icon: 'swap', tone: 'purple', label: t('โอนไปสาขา'), value: t('{n} ใบ', { n: docs(issues, isTransfer) }) },
        { key: 'consume', icon: 'truck', tone: 'amber', label: t('เบิกใช้ / ตัดออก'), value: t('{n} ใบ', { n: docs(issues, (m) => m.type === 'consume') }) },
        { ...cancelled, value: t('{n} ใบ', { n: docs(movements.filter((m) => (m.type === 'issue' || m.type === 'consume') && bkkDayStart(m.date) === start), (m) => !!m.voided) }) },
      ]
    }
    return [
      { key: 'docs', icon: 'report', tone: 'blue', label: t('จำนวนใบรับ'), value: t('{n} ใบ', { n: docs(live) }) },
      { key: 'lines', icon: 'package', tone: 'green', label: t('จำนวนรายการ'), value: t('{n} รายการ', { n: live.length }) },
      { key: 'value', icon: 'chart', tone: 'purple', label: t('มูลค่ารับเข้า'), value: `฿ ${fmtMoney(value(live))}` }, // i18n-key
      cancelled,
    ]
  }, [kind, day, movements, productById, t])
}

export function KeyingSide({
  kind,
  day,
  title,
  todayTitle,
  tips,
}: {
  kind: KeyingKind
  day: number
  title: string
  todayTitle: string
  tips: ReactNode
}) {
  const t = useT()
  const rows = useDaySummary(kind, day)
  return (
    <>
      <SummaryList title={`${title} · ${formatThaiDateShort(day)}`} rows={rows} />
      <TodayTransactions types={TYPES[kind]} date={day} title={todayTitle} embedded />
      <TipCard title={t('คำแนะนำ')}>{tips}</TipCard>
    </>
  )
}
