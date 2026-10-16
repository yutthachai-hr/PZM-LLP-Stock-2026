import { describe, expect, test, vi } from 'vitest'

const writeFile = vi.fn()
const json_to_sheet = vi.fn(() => ({}))
const book_new = vi.fn(() => ({}))
const book_append_sheet = vi.fn()

vi.mock('xlsx', () => ({
  utils: {
    json_to_sheet,
    book_new,
    book_append_sheet,
  },
  writeFile,
}))

describe('dynamic exportExcel', () => {
  test('dynamically resolves xlsx and produces output file', async () => {
    const { exportExcel } = await import('../src/lib/export')
    await exportExcel('test-export', 'Sheet1', [{ SKU: 'A1', Name: 'Item' }])
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'test-export.xlsx')
    expect(json_to_sheet).toHaveBeenCalled()
  })
})
