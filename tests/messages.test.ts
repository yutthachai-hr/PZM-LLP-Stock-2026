// The message board (owner, 22 Sep 2026): a note to the shift, kept 90 days, never edited.
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const S = await import('../src/services/messages')
const { setActiveBrand } = await import('../src/brand/brand')
const { MESSAGE_DAYS, MESSAGE_MAX } = await import('../src/types')

const AA = { id: 'u-aa', name: 'AA' }
const BB = { id: 'u-bb', name: 'BB' }
const DAY = 86_400_000
const msg = (over: Record<string, unknown> = {}) => ({ id: 'm1', body: 'hi', byUserId: AA.id, byUserName: 'AA', createdAt: Date.now(), ...over })

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
})

describe('writing', () => {
  test('a message is stored trimmed, in the sender\'s name', async () => {
    const saved = await S.sendMessage({ body: '  ของ FOODGALLERY มาบ่ายนี้  ', actor: AA })
    expect(saved).toMatchObject({ body: 'ของ FOODGALLERY มาบ่ายนี้', byUserId: AA.id, byUserName: 'AA' })
    expect(raw('messages')).toHaveLength(1)
  })

  test('an empty or over-long message is refused', async () => {
    await expect(S.sendMessage({ body: '   ', actor: AA })).rejects.toThrow()
    await expect(S.sendMessage({ body: 'x'.repeat(MESSAGE_MAX + 1), actor: AA })).rejects.toThrow()
  })

  test('only the author or an admin may take one down', async () => {
    seed('messages', [msg()])
    const m = raw('messages')[0] as unknown as Parameters<typeof S.deleteMessage>[0]
    await expect(S.deleteMessage(m, { id: BB.id, role: 'manager' })).rejects.toThrow()
    await S.deleteMessage(m, { id: BB.id, role: 'admin' })
    expect(raw('messages')).toHaveLength(0)
  })
})

describe('reading', () => {
  test('pinned first, then newest first', () => {
    const rows = [
      msg({ id: 'old', createdAt: 100 }),
      msg({ id: 'new', createdAt: 300 }),
      msg({ id: 'pinned', createdAt: 200, pinned: true }),
    ] as unknown as Parameters<typeof S.sortForBoard>[0]
    expect(S.sortForBoard(rows).map((m) => m.id)).toEqual(['pinned', 'new', 'old'])
  })

  test('unread counts what other people wrote since I last looked', () => {
    const rows = [
      msg({ id: 'a', byUserId: BB.id, createdAt: 300 }),
      msg({ id: 'b', byUserId: BB.id, createdAt: 100 }),
      msg({ id: 'c', byUserId: AA.id, createdAt: 400 }),
    ] as unknown as Parameters<typeof S.unreadCount>[0]
    expect(S.unreadCount(rows, 200, AA.id)).toBe(1)
    expect(S.unreadCount(rows, undefined, AA.id)).toBe(2)
    expect(S.unreadCount(rows, 500, AA.id)).toBe(0)
  })

  test('90 days is the line the cron Worker prunes at', () => {
    const now = Date.now()
    expect(S.isExpired(msg({ createdAt: now - (MESSAGE_DAYS - 1) * DAY }) as never, now)).toBe(false)
    expect(S.isExpired(msg({ createdAt: now - (MESSAGE_DAYS + 1) * DAY }) as never, now)).toBe(true)
  })

  test('opening the board stamps my own profile and nothing else', async () => {
    seed('users', [{ id: AA.id, name: 'AA', email: 'a@b.c', role: 'staff', active: true, createdAt: 1 }])
    await S.markMessagesRead(AA.id, 12_345)
    expect((raw('users')[0] as Record<string, unknown>).messagesReadAt).toBe(12_345)
  })
})
