import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getBrand, setActiveBrand } from '../src/brand/brand'
import { COL } from '../src/types'

const { getOne, update } = vi.hoisted(() => ({ getOne: vi.fn(), update: vi.fn() }))
vi.mock('../src/backend', () => ({
  backend: { forBrand: (brand: string) => ({ getOne: (col: string, id: string) => getOne(brand, col, id), update }) },
}))
const { notificationDestination } = await import('../src/services/notifications')

beforeEach(() => {
  setActiveBrand('pizza')
  getOne.mockReset()
  update.mockClear()
})

describe('notification destination (no writes)', () => {
  test.each(['pizza', 'lelapin', 'rnd'] as const)('reads the document ID only in %s', async (brand) => {
    setActiveBrand(brand)
    getOne.mockResolvedValue({ id: 'doc-123', docNo: 'TR-00001' })
    expect(await notificationDestination('/logistics/doc-123?tab=items', brand)).toBe('/transfers/doc-123?tab=items')
    expect(getOne.mock.calls).toEqual([[brand, COL.transfers, 'doc-123']])
    expect(update).not.toHaveBeenCalled()
  })

  test('missing here never searches another brand or marks read', async () => {
    getOne.mockResolvedValue(null)
    await expect(notificationDestination('/logistics/other-brand-only', 'pizza')).rejects.toThrow('ไม่พบเอกสารโอนสินค้า')
    expect(getOne).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })

  test('denied read rejects without writing', async () => {
    getOne.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    await expect(notificationDestination('/transfers/doc-123', 'pizza')).rejects.toThrow('denied')
    expect(update).not.toHaveBeenCalled()
  })

  test('brand switched during the read: do not navigate with the old id', async () => {
    getOne.mockImplementation(async () => { setActiveBrand('rnd'); return { id: 'doc-123' } })
    await expect(notificationDestination('/transfers/doc-123', 'pizza')).rejects.toThrow('บริษัทเปลี่ยนแล้ว')
    expect(getBrand()).toBe('rnd')
    expect(update).not.toHaveBeenCalled()
  })

  test.each(['/transfers', '/transfers/new', '/transfers/today', '/orders?po=po1'])('%s needs no extra read', async (url) => {
    expect(await notificationDestination(url, 'pizza')).toBe(url)
    expect(getOne).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  test('external URL is refused before any read/write', async () => {
    await expect(notificationDestination('https://evil.example/x', 'pizza')).rejects.toThrow('ลิงก์ไม่ถูกต้อง')
    expect(getOne).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})
