import { beforeEach, describe, expect, test, vi } from 'vitest'
import { canonicalLink } from '../src/lib/notificationLink'
import { presentNotification } from '../src/lib/notificationPresentation'
import type { AppNotification } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const { markRead, markAllRead } = await import('../src/services/notifications')
const { setActiveBrand, getBrand } = await import('../src/brand/brand')

beforeEach(() => {
  resetMemory()
  setActiveBrand('pizza')
})

function sampleNote(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    kind: 'poArriving',
    category: 'purchasing',
    priority: 'info',
    to: { roles: ['manager'] },
    params: { docNo: 'PO-00001' },
    link: '/orders?po=PO-1',
    active: true,
    readBy: {},
    source: 'worker',
    createdBy: 'test',
    createdAt: 1000,
    updatedAt: 1000,
    expiresAt: 2000,
    ...over,
  }
}

describe('R64 Regression: canonicalLink percent-decoding in query/hash', () => {
  test.each([
    '/orders?po=%00',
    '/orders?po=%5C',
    '/orders?po=%0D%0A',
    '/calendar?item=%00',
    '/orders?po=PO-1#%00',
    '/orders?po=PO-1#%5C',
    '/orders?po=PO-1#%0D%0A',
  ])('refuses percent-encoded control characters and backslashes in query/hash: %s', (link) => {
    expect(canonicalLink(link)).toBeNull()
  })

  test('allows safe percent-encoded spaces and query params', () => {
    expect(canonicalLink('/orders?po=PO%201')).toBe('/orders?po=PO%201')
    expect(canonicalLink('/movements?product=item%201#section')).toBe('/movements?product=item%201#section')
  })
})

describe('R64 Regression: entityOf hash fragment separation and decoding', () => {
  test('strips hash fragment from po query parameter', () => {
    const p = presentNotification(sampleNote({ link: '/orders?po=PO-1#audit' }))
    expect(p.entityType).toBe('po')
    expect(p.entityId).toBe('PO-1')
  })

  test('strips hash fragment from request path parameter and decodes', () => {
    const p = presentNotification(sampleNote({ kind: 'prSubmitted', category: 'purchasing', link: '/requests/req-1#notes' }))
    expect(p.entityType).toBe('request')
    expect(p.entityId).toBe('req-1')
  })

  test('canonicalizes secondary actions and rejects invalid action urls', () => {
    const p = presentNotification(
      sampleNote({
        kind: 'supplierConfirmed',
        category: 'supplier',
        supplierId: 'sup\x00bad',
        link: '/orders?po=PO-1',
      }),
    )
    // sup\x00bad has a null byte: secondary action for supplier must NOT be added
    expect(p.actions.map((a) => a.url)).toEqual(['/orders?po=PO-1'])
  })
})

describe('R64 Regression: markRead and markAllRead brand and concurrency safety', () => {
  test('markRead refuses to write if brand switched', async () => {
    const note = sampleNote({ id: 'brand-test-note' })
    seed('notifications', [note as unknown as Record<string, unknown>])

    // Target pizza, but active brand switches to rnd
    setActiveBrand('rnd')
    await markRead(note, 'user1', 1234, 'pizza')

    // Neither pizza nor rnd should have been updated
    const pizzaRows = raw('notifications') as unknown as AppNotification[]
    expect(pizzaRows[0]?.readBy?.user1).toBeUndefined()
  })

  test('markRead dedupes concurrent duplicate calls', async () => {
    const note = sampleNote({ id: 'concurrent-note' })
    seed('notifications', [note as unknown as Record<string, unknown>])

    // Call markRead concurrently
    await Promise.all([
      markRead(note, 'user1', 2000, 'pizza'),
      markRead(note, 'user1', 2000, 'pizza'),
    ])

    const rows = raw('notifications') as unknown as AppNotification[]
    expect(rows[0]?.readBy?.user1).toBe(2000)
  })

  test('markAllRead halts immediately if brand switched during processing', async () => {
    const n1 = sampleNote({ id: 'multi-1' })
    const n2 = sampleNote({ id: 'multi-2' })
    seed('notifications', [n1 as unknown as Record<string, unknown>, n2 as unknown as Record<string, unknown>])

    setActiveBrand('rnd')
    const count = await markAllRead([n1, n2], 'user1', 'pizza')
    expect(count).toBe(0)
  })
})
