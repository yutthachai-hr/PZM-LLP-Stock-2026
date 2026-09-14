// Splitting a long order into pictures, and naming them.
//
//   npm test

import { describe, expect, test } from 'vitest'
import { LINES_PER_PAGE, paginateLines, sheetFileName } from '../src/lib/poImage'

const line = (i: number) => ({ productId: `p${i}`, productName: `P${i}`, unit: 'EA', orderedQty: 1 })

describe('paginateLines', () => {
  test('an ordinary order is one picture — the supplier keeps getting one image', () => {
    expect(paginateLines([line(1), line(2)])).toHaveLength(1)
    expect(paginateLines(Array.from({ length: LINES_PER_PAGE }, (_, i) => line(i)))).toHaveLength(1)
  })

  test('one over the limit becomes two, in order, with nothing lost', () => {
    const lines = Array.from({ length: LINES_PER_PAGE + 1 }, (_, i) => line(i))
    const pages = paginateLines(lines)
    expect(pages.map((p) => p.length)).toEqual([LINES_PER_PAGE, 1])
    expect(pages.flat()).toEqual(lines)
  })

  test('an empty order is still one (empty) page rather than none', () => {
    expect(paginateLines([])).toEqual([[]])
  })
})

describe('sheetFileName', () => {
  test('carries the page only when there is more than one', () => {
    expect(sheetFileName('PO-00007')).toBe('PO-00007.jpg')
    expect(sheetFileName('PO-00007', { n: 1, of: 1 })).toBe('PO-00007.jpg')
    expect(sheetFileName('PO-00007', { n: 2, of: 2 })).toBe('PO-00007-2of2.jpg')
  })
})
