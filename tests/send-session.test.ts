// R40 P0: a multi-PO send is one session that survives reloads, LINE Login and app switching,
// and whose progress is read from what the orders themselves say (server-written, under Rules).
import { beforeEach, describe, expect, test } from 'vitest'
import { activeSession, clearSession, decodeSession, encodeSession, queueFor, saveSession, sessionDone, sessionFinished, startSession } from '../src/pages/purchase/sendSession'
import type { PurchaseOrder } from '../src/types'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage
})

const po = (id: string, over: Partial<PurchaseOrder> = {}) => ({ id, status: 'ordered', updatedAt: 1, ...over }) as PurchaseOrder
const T0 = 1_800_000_000_000

describe('send session', () => {
  test('the queue is the chosen orders, in order, minus those already delivered for their current content', () => {
    const amended = po('c', { shareStatus: 'sent', sentAt: 10, revisions: [{ rev: 1, at: 20, by: 'u', byName: 'U', changes: [] }] } as never)
    expect(queueFor([po('a', { shareStatus: 'sent', sentAt: 10 }), po('b'), amended, po('d', { status: 'received' })]).map((o) => o.id)).toEqual(['b', 'c'])
  })

  test('done means sent for the current content, or skipped after the session began', () => {
    const s = startSession('pizza', 'u1', ['a', 'b'], T0)
    expect(sessionDone(po('a', { shareStatus: 'sent', sentAt: T0 + 5 }), s)).toBe(true)
    expect(sessionDone(po('a', { shareStatus: 'skipped', updatedAt: T0 + 5 }), s)).toBe(true)
    expect(sessionDone(po('a', { shareStatus: 'skipped', updatedAt: T0 - 5 }), s)).toBe(false)
    expect(sessionDone(po('a', { shareStatus: 'shareOpened', updatedAt: T0 + 5 }), s)).toBe(false)
    expect(sessionDone(po('a', { shareStatus: 'failed', updatedAt: T0 + 5 }), s)).toBe(false)
    expect(sessionDone(po('a', { status: 'cancelled' }), s)).toBe(true)
  })

  test('travels in a URL and back exactly, and rejects anything malformed, foreign or stale', () => {
    const s = startSession('pizza', 'u1', ['po-a', 'Xy_9'], T0)
    const back = decodeSession(encodeSession(s), 'pizza', T0 + 1000)
    expect(back).toEqual({ ...s, userId: '' })
    for (const bad of ['', 'x', '1.zz.po-a', `1.${s.id}.${T0}.`, `1.${s.id}.${T0}.a~b c`, `9.${s.id}.${T0}.a`]) expect(decodeSession(bad, 'pizza', T0)).toBeNull()
    expect(decodeSession(encodeSession(s), 'pizza', T0 + 8 * 86_400_000)).toBeNull()
    expect(decodeSession(`1.${s.id}.${T0}.${Array.from({ length: 51 }, (_, i) => `p${i}`).join('~')}`, 'pizza', T0)).toBeNull()
  })

  test('finished only when every order of the session was read and is done (R40 review)', () => {
    const s = startSession('pizza', 'u1', ['a', 'b'], T0)
    const sent = (id: string) => po(id, { shareStatus: 'sent', sentAt: T0 + 1 })
    expect(sessionFinished(s, [sent('a'), sent('b')])).toBe(true)
    expect(sessionFinished(s, [sent('a')])).toBe(false) // b could not be read: not finished
    expect(sessionFinished(s, [sent('a'), po('b')])).toBe(false)
  })

  test('a stored session with ids that could not travel is ignored', () => {
    store.set('pmstock:v1:send-session:pizza:u1', JSON.stringify({ ...startSession('pizza', 'u1', ['a'], T0), orderIds: ['a b'] }))
    expect(activeSession('pizza', 'u1', T0)).toBeNull()
  })

  test('kept per brand and person on this device, and cleared', () => {
    const s = startSession('pizza', 'u1', ['a'], T0)
    saveSession(s)
    expect(activeSession('pizza', 'u1')).toEqual(s)
    expect(activeSession('pizza', 'u2')).toBeNull()
    expect(activeSession('lelapin', 'u1')).toBeNull()
    clearSession(s)
    expect(activeSession('pizza', 'u1')).toBeNull()
  })
})
