// Which columns go where on a phone card (spec §4, 21 Sep 2026).
import { describe, expect, test } from 'vitest'
import { cardParts, type Column } from '../src/components/DataTable'

const col = (key: string, over: Partial<Column<unknown>> = {}): Column<unknown> => ({ key, header: key, cell: () => null, ...over })

describe('cardParts', () => {
  test('title is the primary column, the value the one marked, meta the rest in order', () => {
    const cols = [col('date'), col('name', { primary: true }), col('qty', { card: 'value' }), col('site'), col('actions', { tableOnly: true }), col('balance', { card: 'hidden' })]
    const p = cardParts(cols)
    expect(p.title.key).toBe('name')
    expect(p.value?.key).toBe('qty')
    expect(p.meta.map((c) => c.key)).toEqual(['date', 'site'])
  })
  test('with nothing marked the first column is the title and there is no value', () => {
    const p = cardParts([col('a'), col('b')])
    expect(p.title.key).toBe('a')
    expect(p.value).toBeUndefined()
    expect(p.meta.map((c) => c.key)).toEqual(['b'])
  })
})
