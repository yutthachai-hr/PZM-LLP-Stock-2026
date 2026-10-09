// G25 — the version helpers, the backends' bump, the server's version, and contract versions.
import { describe, expect, test } from 'vitest'
import { assertVersion, isFresh, supported, versionOf, EXECUTION_MAX_AGE_MS } from '../src/lib/concurrency'
import { increment, Increment, withInitialVersion, withVersionBump, applyIncrement } from '../src/backend/tx'
import { versioned } from '../functions/_lib/serverTx'

describe('version helpers', () => {
  test('a document never versioned is at 0; a stale expectation throws; none means no check', () => {
    expect(versionOf(null)).toBe(0)
    expect(versionOf({})).toBe(0)
    expect(versionOf({ version: 4 })).toBe(4)
    expect(() => assertVersion({ version: 4 }, 4)).not.toThrow()
    expect(() => assertVersion({ version: 5 }, 4)).toThrow()
    expect(() => assertVersion({}, 0)).not.toThrow()
    expect(() => assertVersion({ version: 5 }, undefined)).not.toThrow()
  })
  test('execution freshness: within the window, never from the future', () => {
    const now = 1_791_000_000_000
    expect(isFresh(now - 60_000, now)).toBe(true)
    expect(isFresh(now - EXECUTION_MAX_AGE_MS - 1, now)).toBe(false)
    expect(isFresh(now + 1, now)).toBe(false)
    expect(isFresh(Number.NaN, now)).toBe(false)
  })
})

describe('the central bump', () => {
  test('only versioned collections, in either brand; a stated version is kept', () => {
    expect(withVersionBump('products', { a: 1 }).version).toBeInstanceOf(Increment)
    expect(withVersionBump('lelapin__purchaseOrders', { a: 1 }).version).toBeInstanceOf(Increment)
    expect(withVersionBump('stockLevels', { a: 1 })).toEqual({ a: 1 })
    expect(withVersionBump('products', { version: 7 })).toEqual({ version: 7 })
    expect(withInitialVersion('purchaseOrders', { a: 1 })).toEqual({ a: 1, version: 1 })
    expect(withInitialVersion('suppliers', { a: 1 })).toEqual({ a: 1 })
  })
  test('increment applies the way Firestore defines it', () => {
    expect(applyIncrement(undefined, increment())).toBe(1)
    expect(applyIncrement('x', increment(2))).toBe(2)
    expect(applyIncrement(4, increment())).toBe(5)
  })
})

describe('server writes (stock commands) carry the next version', () => {
  const w = (op: 'set' | 'update', collection = 'purchaseOrders', data: Record<string, unknown> = { status: 'received' }) => ({ op, collection, id: 'po1', data })
  test('from the copy read, under its updateTime', () => {
    expect(versioned(w('update'), { version: 3 }, true).data.version).toBe(4)
    expect(versioned(w('update'), {}, true).data.version).toBe(1)
    expect(versioned(w('set'), null, true).data.version).toBe(1)
    expect(versioned(w('set'), null, false).data.version).toBe(1)
  })
  test('an unversioned collection, a verify, or a stated version is untouched', () => {
    expect(versioned(w('update', 'stockLevels'), { version: 3 }, true).data).toEqual({ status: 'received' })
    expect(versioned({ op: 'verify', collection: 'products', id: 'p', data: {} }, {}, true).data).toEqual({})
    expect(versioned(w('update', 'purchaseOrders', { version: 9 }), { version: 3 }, true).data.version).toBe(9)
  })
  test('a versioned update that was not read first is a programming error', () => {
    expect(() => versioned(w('update'), undefined, false)).toThrow(/must read/)
  })
})

describe('contract versions fail safe', () => {
  test('known versions pass; unknown or missing ones do not, unless legacy rows are allowed', () => {
    expect(supported('ActionProposal', { schemaVersion: 'action-proposal/1' })).toBe(true)
    expect(supported('ActionProposal', { schemaVersion: 'action-proposal/2' })).toBe(false)
    expect(supported('OutboxEvent', { schemaVersion: 1 })).toBe(true)
    expect(supported('OutboxEvent', { schemaVersion: 2 })).toBe(false)
    expect(supported('OutboxEvent', {})).toBe(false)
    expect(supported('AuditEvent', {}, { legacy: true })).toBe(true)
    expect(supported('SafetyDecision', null)).toBe(false)
  })
})
