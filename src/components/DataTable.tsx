import type { ReactNode } from 'react'
import { useT } from '../i18n/I18nContext'

/**
 * A table that turns into a list of cards on a phone.
 *
 * The six tables in this app were each written out by hand, and every one of them handled a
 * narrow screen the same way: `min-w-[900px]` inside a horizontal scroller. On a 375px phone
 * that is two and a half screens of sideways scrolling to read one row, with the column
 * headings scrolled off to the left by the time you reach the number you wanted. Branch
 * staff read these on phones.
 *
 * So below `md` — the phone shell's edge (spec, 21 Sep 2026) — each row is rendered as a
 * card instead: the primary column as its heading, one column marked `card: 'value'` as
 * the large figure beside it, the rest as one meta line. Nothing is hidden unless a page
 * says so — a label is cheaper than a scrollbar, and dropping columns on small screens
 * means the answer someone came for is the one that is missing.
 *
 * The desktop table keeps the sticky head and the scroll container the pages already used.
 */

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** The one column that names the row: the card's heading on a phone. */
  primary?: boolean
  /** Shown in the table, left out of the card — for row actions repeated in `cardActions`. */
  tableOnly?: boolean
  /** Where the cell goes on a phone card: the large figure beside the title, the meta line (default), or nowhere. */
  card?: 'value' | 'meta' | 'hidden'
  /** Applied to the cell, not the header. */
  className?: string
  /** Fixed width for the header cell, e.g. 'w-24'. */
  headerClassName?: string
}

/** Which columns go where on a phone card. */
export function cardParts<T>(columns: Column<T>[]): { title: Column<T>; value?: Column<T>; meta: Column<T>[] } {
  const title = columns.find((c) => c.primary) ?? columns[0]
  const value = columns.find((c) => c.card === 'value' && c !== title)
  const meta = columns.filter((c) => c !== title && c !== value && !c.tableOnly && c.card !== 'hidden')
  return { title, value, meta }
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  minWidth = 640,
  maxHeight,
  onRowClick,
  cardActions,
  rowClassName,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  empty?: ReactNode
  /** Width below which the desktop table scrolls sideways rather than crushing columns. */
  minWidth?: number
  /** e.g. 'calc(100vh-260px)'. Omit for a table that grows with the page. */
  maxHeight?: string
  onRowClick?: (row: T) => void
  /** Rendered at the foot of each card on a phone, where a row-action column does not fit. */
  cardActions?: (row: T) => ReactNode
  /** Applied to the row and to the card, for states that colour the whole entry. */
  rowClassName?: (row: T) => string
}) {
  const t = useT()
  if (rows.length === 0) return <>{empty}</>

  const { title, value, meta } = cardParts(columns)

  return (
    <>
      {/* Phone: one card per row. */}
      <div className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            className={`px-4 py-3.5 ${onRowClick ? 'cursor-pointer active:bg-sunken' : ''} ${rowClassName?.(row) ?? ''}`}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-ink">{title.cell(row)}</div>
              {value && <div className="num shrink-0 text-right text-lg font-bold text-ink">{value.cell(row)}</div>}
            </div>
            {meta.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-ink-soft">
                {meta.map((c) => (
                  <span key={c.key} className="inline-flex min-w-0 items-center gap-1">
                    <span className="text-ink-faint">{c.header}</span>
                    <span className="min-w-0 text-ink">{c.cell(row)}</span>
                  </span>
                ))}
              </div>
            )}
            {cardActions && <div className="mt-2 flex flex-wrap gap-2">{cardActions(row)}</div>}
          </div>
        ))}
      </div>

      {/* Tablet and up: the table. */}
      <div
        className="hidden overflow-auto md:block"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead className="sticky top-0 z-10 bg-sunken text-left text-[13px] text-ink-soft shadow-[inset_0_-1px_0_var(--color-line)]">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`whitespace-nowrap px-4 py-3 font-semibold ${c.align === 'right' ? 'text-right' : ''} ${c.headerClassName ?? ''}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={`transition-colors duration-100 hover:bg-sunken/70 ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row) ?? ''}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 align-middle ${c.align === 'right' ? 'text-right' : ''} ${c.className ?? ''}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <span className="sr-only">{t('ตาราง {n} แถว', { n: rows.length })}</span>
    </>
  )
}
