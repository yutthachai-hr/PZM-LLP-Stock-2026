import { useId } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useViewport } from '../../lib/viewport'
import type { ChartRow, ChartSeries, DonutSlice } from './types'

/**
 * The four chart shapes the owner's mock-ups use, drawn with recharts (MIT).
 *
 * This module is only ever reached through `charts/index.tsx`, which loads it with
 * `lazy()` — recharts is the largest thing in the bundle, and most screens (every keying
 * form) never draw a chart, so they should not download one.
 *
 * Colours are CSS variables, never hex: a series named `brand` is Pizza Mania red or
 * Le Lapin orange depending on whose books are open. On a phone the plot is 160px tall
 * and the legend is dropped (spec §1) — the series are named in the card around it.
 */

const axisTick = { fontSize: 11, fill: 'var(--color-ink-faint)' }
const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid var(--color-line)',
  boxShadow: '0 8px 24px rgb(15 23 42 / 0.08)',
  fontSize: 12,
}

function useHeight(height: number): number {
  return useViewport() === 'phone' ? Math.min(height, 160) : height
}

export function Legend({ series }: { series: { key: string; label: string; color: string }[] }) {
  return (
    <div className="mb-2 hidden flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft md:flex">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

// Grouped vertical bars — "รับเข้า / จ่ายออก / โอนย้าย" per day.
export function BarsChart({
  data,
  xKey,
  series,
  height = 260,
  format,
}: {
  data: ChartRow[]
  xKey: string
  series: ChartSeries[]
  height?: number
  format?: (v: number) => string
}) {
  const h = useHeight(height)
  return (
    <div>
      <Legend series={series} />
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }} barGap={4}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
          <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={false} interval={0} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={format} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--color-sunken)' }} formatter={format ? (v) => format(Number(v)) : undefined} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={18} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** A line with a gradient under it — a balance or a total over time. */
export function AreaTrendChart({
  data,
  xKey,
  series,
  height = 240,
  format,
}: {
  data: ChartRow[]
  xKey: string
  series: ChartSeries[]
  height?: number
  format?: (v: number) => string
}) {
  const h = useHeight(height)
  const id = useId().replace(/:/g, '')
  return (
    <div>
      {series.length > 1 && <Legend series={series} />}
      <ResponsiveContainer width="100%" height={h}>
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
          <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={format} />
          <Tooltip contentStyle={tooltipStyle} formatter={format ? (v) => format(Number(v)) : undefined} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2.5}
              fill={`url(#${id}-${s.key})`}
              dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** A ring with the total in the middle and the slices listed beside it. */
export function DonutChart({
  slices,
  centerLabel,
  centerValue,
  height = 220,
  format = (v) => String(v),
}: {
  slices: DonutSlice[]
  centerLabel?: string
  centerValue?: string
  height?: number
  format?: (v: number) => string
}) {
  const h = useHeight(height)
  const total = slices.reduce((s, x) => s + x.value, 0)
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative shrink-0" style={{ width: h, height: h }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" paddingAngle={2} stroke="none">
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => format(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
        {(centerLabel || centerValue) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerLabel && <span className="text-xs text-ink-faint">{centerLabel}</span>}
            {centerValue && <span className="num text-lg font-bold text-ink">{centerValue}</span>}
          </div>
        )}
      </div>
      <ul className="w-full min-w-0 space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-ink-soft">{s.label}</span>
            <span className="num font-semibold text-ink">{total > 0 ? `${Math.round((s.value / total) * 100)}%` : '–'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
