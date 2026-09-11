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
 * So below `sm` each row is rendered as a card instead: the primary column as its heading,
 * the rest as labelled lines. Nothing is hidden — a label is cheaper than a scrollbar, and
 * dropping columns on small screens means the answer someone came for is the one that is
 * missing.
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
  /** Applied to the cell, not the header. */
  className?: string
  /** Fixed width for the header cell, e.g. 'w-24'. */
  headerClassName?: string
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

  const primary = columns.find((c) => c.primary) ?? columns[0]
  const rest = columns.filter((c) => c !== primary && !c.tableOnly)

  return (
    <>
      {/* Phone: one card per row. */}
      <div className="divide-y divide-line sm:hidden">
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            className={`p-3 ${onRowClick ? 'cursor-pointer active:bg-sunken' : ''} ${rowClassName?.(row) ?? ''}`}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            <div className="font-medium text-ink">{primary.cell(row)}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {rest.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-ink-faint">{c.header}</dt>
                  <dd className={`min-w-0 text-ink-soft ${c.align === 'right' ? 'text-right' : ''}`}>
                    {c.cell(row)}
                  </dd>
                </div>
              ))}
            </dl>
            {cardActions && <div className="mt-2 flex flex-wrap gap-2">{cardActions(row)}</div>}
          </div>
        ))}
      </div>

      {/* Tablet and up: the table. */}
      <div
        className="hidden overflow-auto sm:block"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead className="sticky top-0 z-10 bg-sunken text-left text-xs uppercase text-ink-soft shadow-sm">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : ''} ${c.headerClassName ?? ''}`}
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
                className={`hover:bg-sunken ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row) ?? ''}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : ''} ${c.className ?? ''}`}
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
