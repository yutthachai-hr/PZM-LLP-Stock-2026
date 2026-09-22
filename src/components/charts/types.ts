/** One point on a chart's x axis: its label and one number per series. */
export type ChartRow = Record<string, string | number>

/** One series of a chart: which field it reads, its name, and its colour as a CSS value. */
export interface ChartSeries {
  key: string
  label: string
  /** A CSS colour — use the tokens: 'var(--color-in)', 'var(--color-brand)'. */
  color: string
}

export interface DonutSlice {
  key: string
  label: string
  value: number
  color: string
}

/**
 * Colours for series that are categories rather than directions — the donut of issues by
 * category. Tokens only, so they follow the palette if it ever changes.
 */
export const CATEGORY_COLORS = [
  'var(--color-tile-red)',
  'var(--color-tile-blue)',
  'var(--color-tile-green)',
  'var(--color-tile-amber)',
  'var(--color-tile-purple)',
  'var(--color-ink-faint)',
]
