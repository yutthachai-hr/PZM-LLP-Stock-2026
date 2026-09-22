import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import type * as Kit from './ChartKit'

/**
 * The charts, loaded on demand (spec §1): recharts only downloads the first time a screen
 * actually draws a chart. Until it arrives the chart's space is held by a pale block of the
 * same height, so the page does not jump when it appears.
 */
const LazyBars = lazy(() => import('./ChartKit').then((m) => ({ default: m.BarsChart })))
const LazyArea = lazy(() => import('./ChartKit').then((m) => ({ default: m.AreaTrendChart })))
const LazyDonut = lazy(() => import('./ChartKit').then((m) => ({ default: m.DonutChart })))

function Hold({ height, children }: { height: number; children: ReactNode }) {
  return (
    <Suspense fallback={<div className="animate-pulse rounded-xl bg-sunken" style={{ height: Math.min(height, 160) }} />}>
      {children}
    </Suspense>
  )
}

export function BarsChart(props: ComponentProps<typeof Kit.BarsChart>) {
  return (
    <Hold height={props.height ?? 260}>
      <LazyBars {...props} />
    </Hold>
  )
}

export function AreaTrendChart(props: ComponentProps<typeof Kit.AreaTrendChart>) {
  return (
    <Hold height={props.height ?? 240}>
      <LazyArea {...props} />
    </Hold>
  )
}

export function DonutChart(props: ComponentProps<typeof Kit.DonutChart>) {
  return (
    <Hold height={props.height ?? 220}>
      <LazyDonut {...props} />
    </Hold>
  )
}

export { HBarList } from './HBarList'
export { CATEGORY_COLORS, type ChartRow, type ChartSeries, type DonutSlice } from './types'
