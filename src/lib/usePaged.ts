import { useEffect, useMemo, useState } from 'react'

/**
 * One page of a list, and what the Pagination control needs to move through it.
 *
 * `resetKey` goes back to page 1 when it changes — a new search or tab — so someone who was
 * on page 4 does not land on an empty page 4 of a shorter list.
 */
export function usePaged<T>(rows: T[], initialSize = 20, resetKey: unknown = null) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialSize)

  useEffect(() => setPage(1), [resetKey, pageSize])

  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const slice = useMemo(
    () => rows.slice((current - 1) * pageSize, current * pageSize),
    [rows, current, pageSize],
  )

  return {
    rows: slice,
    pager: {
      page: current,
      pages,
      total: rows.length,
      from: rows.length === 0 ? 0 : (current - 1) * pageSize + 1,
      to: Math.min(current * pageSize, rows.length),
      pageSize,
      onPage: (n: number) => setPage(Math.min(Math.max(1, n), pages)),
      onPageSize: setPageSize,
    },
  }
}
