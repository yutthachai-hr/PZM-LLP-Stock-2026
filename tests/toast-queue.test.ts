import { describe, expect, it } from 'vitest'
import { enqueueToast, normalizeToast, visibleToasts, TOAST_DURATION, MAX_QUEUED, type ToastRecord } from '../src/lib/toastQueue'

const notice = (id: number, title = `Message ${id}`, kind: ToastRecord['kind'] = 'success'): ToastRecord => ({ id, title, kind })

describe('transient toast presentation queue', () => {
  it('preserves existing string callers without guessing how to split translated sentences', () => {
    expect(normalizeToast('  บันทึกแล้ว — 2 รายการ  ')).toEqual({ title: 'บันทึกแล้ว — 2 รายการ' })
    expect(normalizeToast('Saved', '  Details  ')).toEqual({ title: 'Saved', description: 'Details' })
  })
  it('supports a separate title and description without losing cost precision', () => {
    expect(normalizeToast({ title: 'บันทึกราคาแล้ว', description: '฿350.2203 ต่อ KG' })).toEqual({ title: 'บันทึกราคาแล้ว', description: '฿350.2203 ต่อ KG' })
  })
  it('normalizes raw Error instances without throwing', () => {
    expect(normalizeToast(new Error('Connection lost'))).toEqual({ title: 'Connection lost' })
    expect(normalizeToast(new Error(''))).toEqual({ title: 'Error' })
    expect(normalizeToast(new Error('  Failed to fetch  '), 'Retry in 5s')).toEqual({ title: 'Failed to fetch', description: 'Retry in 5s' })
    expect(normalizeToast(new TypeError('Invalid response'))).toEqual({ title: 'Invalid response' })
  })
  it('takes the caller’s localized fallback for an Error with no message', () => {
    expect(normalizeToast(new Error(''), undefined, 'Something went wrong')).toEqual({ title: 'Something went wrong' })
    expect(normalizeToast(new Error('   '))).toEqual({ title: 'Error' })
    expect(normalizeToast(new Error('Connection lost'), undefined, 'Something went wrong')).toEqual({ title: 'Connection lost' })
  })
  it('ignores empty titles and normalizes blank descriptions', () => {
    expect(normalizeToast('  ')).toBeNull()
    expect(normalizeToast({ title: 'Saved', description: ' ' })).toEqual({ title: 'Saved' })
  })
  it('gives errors and warnings more reading time than success', () => {
    expect(TOAST_DURATION).toEqual({ success: 3000, info: 4000, warning: 6500, error: 8000 })
  })
  it('suppresses identical active messages without resetting their identity', () => {
    const first = [notice(1, 'Saved')]
    expect(enqueueToast(first, notice(2, 'Saved'))).toBe(first)
  })
  it('refreshes an identical error without adding a card or changing its identity and position', () => {
    const first = [notice(1, 'Saved'), notice(2, 'Network failed', 'error')]
    const repeated = enqueueToast(first, notice(3, 'Network failed', 'error'))
    expect(repeated).not.toBe(first)
    expect(repeated).toHaveLength(2)
    expect(repeated[0]).toBe(first[0])
    expect(repeated[1]).toMatchObject({ id: 2, revision: 1 })
    expect(first[1]).not.toHaveProperty('revision')
    expect(enqueueToast(repeated, notice(4, 'Network failed', 'error'))[1]).toMatchObject({ id: 2, revision: 2 })
  })
  it('does not collapse different variants or descriptions', () => {
    const first = [notice(1, 'Saved')]
    expect(enqueueToast(first, notice(2, 'Saved', 'error'))).toHaveLength(2)
    expect(enqueueToast(first, { ...notice(2, 'Saved'), description: 'Different product' })).toHaveLength(2)
  })
  it('does not discard distinct useful action callbacks', () => {
    const item = { ...notice(1), action: { label: 'Open', onClick: () => {} } }
    expect(enqueueToast([item], { ...item, id: 2, action: { label: 'Open', onClick: () => {} } })).toHaveLength(2)
  })
  it('shares three visible slots with operational notices, leaving the rest pending', () => {
    const items = [1, 2, 3, 4].map((id) => notice(id))
    expect(visibleToasts(items, 0).map((x) => x.id)).toEqual([1, 2, 3])
    expect(visibleToasts(items, 2).map((x) => x.id)).toEqual([1])
    expect(visibleToasts(items, 3)).toEqual([])
    expect(items).toHaveLength(4)
  })
  it('bounds unique-message floods without replacing the first displayed cards', () => {
    let items: ToastRecord[] = []
    for (let id = 1; id <= 50; id++) items = enqueueToast(items, notice(id))
    expect(items).toHaveLength(MAX_QUEUED)
    expect(items.slice(0, 3).map((x) => x.id)).toEqual([1, 2, 3])
    expect(items.at(-1)?.id).toBe(50)
  })
})
