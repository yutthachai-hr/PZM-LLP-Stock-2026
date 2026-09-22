import type { ReactNode } from 'react'

/**
 * Horizontal bars as progress lines — "5 รายการที่เหลือน้อยที่สุด". Plain CSS rather than
 * recharts: it is a list with a bar under each name, and a list reads, wraps and translates
 * better than an SVG axis would.
 */
export function HBarList({
  rows,
}: {
  rows: { key: string; label: ReactNode; value: number; max: number; display: ReactNode; color?: string }[]
}) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = r.max > 0 ? Math.max(2, Math.min(100, (r.value / r.max) * 100)) : 0
        return (
          <li key={r.key}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">{r.label}</span>
              <span className="num shrink-0 font-semibold text-ink">{r.display}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color ?? 'var(--color-brand)' }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
