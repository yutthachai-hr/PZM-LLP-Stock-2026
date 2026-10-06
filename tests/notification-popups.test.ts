// Real-time notification popups (N1–N3): how a stored notification is presented, which
// arrivals pop (history and reconnects never do), bursts, the visible stack, and a sound
// manager that never throws.
//
//   npm test

import { describe, expect, test, vi } from 'vitest'
import { presentNotification, severityOf } from '../src/lib/notificationPresentation'
import { dismiss, dueCards, emptyQueue, expire, FRESH_MS, MAX_VISIBLE, receive, soundFor, STAGGER_MS } from '../src/lib/notificationQueue'
import { createSoundManager } from '../src/lib/notificationSound'
import type { AppNotification, NotificationCategory, NotificationKind, NotificationPriority } from '../src/types'

const NOW = Date.UTC(2026, 9, 5, 6)

function note(id: string, kind: NotificationKind, priority: NotificationPriority, over: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    kind,
    category: 'supplier',
    priority,
    to: { roles: ['manager', 'admin'] },
    params: { docNo: 'PO-00006', supplier: 'PANFOOD' },
    link: '/orders?po=po6',
    supplierId: 'sup1',
    active: true,
    readBy: {},
    source: 'worker',
    createdBy: 'x',
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    expiresAt: NOW + 1e9,
    ...over,
  }
}
/** A card's key: the occurrence (id@armedAt). Notes here are armed at NOW − 1 s. */
const k = (id: string) => `${id}@${NOW - 1000}`
const item = (n: AppNotification, category: NotificationCategory = n.category) => ({ presented: presentNotification(n), category })

describe('presentation: one function decides how each kind is shown', () => {
  test('supplier confirmed: success, popup, success sound, View PO + View Supplier', () => {
    const p = presentNotification(note('a', 'supplierConfirmed', 'info'))
    expect(p).toMatchObject({ severity: 'success', popup: true, sound: 'success', entityType: 'po', entityId: 'po6', actionUrl: '/orders?po=po6' })
    expect(p.actions.map((a) => a.url)).toEqual(['/orders?po=po6', '/suppliers?id=sup1'])
  })
  test('date changed: warning with sound; date needs approval: warning (high)', () => {
    expect(presentNotification(note('b', 'supplierDateChanged', 'medium'))).toMatchObject({ severity: 'warning', sound: 'warning', soundCategory: 'dateChanges' })
    expect(presentNotification(note('c', 'supplierDatePending', 'high'))).toMatchObject({ severity: 'warning', popup: true })
  })
  test('critical priority is critical, with the critical sound', () => {
    expect(presentNotification(note('d', 'outOfStock', 'critical', { category: 'inventory', link: '/products', productId: 'p1' }))).toMatchObject({
      severity: 'critical',
      sound: 'critical',
      entityType: 'product',
    })
  })
  test('info stays in the bell: no popup, no sound — except the kinds listed', () => {
    expect(presentNotification(note('e', 'cutoffToday', 'info'))).toMatchObject({ popup: false, sound: null })
    expect(presentNotification(note('f', 'poArriving', 'info'))).toMatchObject({ popup: true, sound: null })
    expect(presentNotification(note('g', 'dailyBrief', 'medium', { category: 'system', link: '/' }))).toMatchObject({ popup: false })
  })
  test('severity by priority and kind', () => {
    expect(severityOf({ kind: 'supplierDateApproved', priority: 'info' })).toBe('success')
    expect(severityOf({ kind: 'poDelayed', priority: 'high' })).toBe('warning')
  })
})

describe('what pops', () => {
  const first = [item(note('old1', 'supplierConfirmed', 'info')), item(note('old2', 'supplierDateChanged', 'medium'))]

  test('the first snapshot is history: nothing pops, nothing sounds', () => {
    const r = receive(emptyQueue(), first, NOW)
    expect(r.fresh).toEqual([])
    expect(r.state.visible).toEqual([])
  })

  test('a new one after that pops once', () => {
    const s0 = receive(emptyQueue(), first, NOW).state
    const r = receive(s0, [...first, item(note('new1', 'supplierDateChanged', 'medium'))], NOW)
    expect(r.fresh.map((c) => c.key)).toEqual([k('new1')])
    expect(r.state.visible.map((c) => c.key)).toEqual([k('new1')])
    // The listener delivering the same list again (a reconnect) pops nothing more.
    const again = receive(r.state, [...first, item(note('new1', 'supplierDateChanged', 'medium'))], NOW + 5000)
    expect(again.fresh).toEqual([])
    expect(soundFor(again.fresh)).toBeNull()
  })

  test('a reconnect delivering an old document it had not seen pops nothing', () => {
    const s0 = receive(emptyQueue(), [], NOW).state
    const stale = item(note('stale', 'supplierDateChanged', 'medium', { createdAt: NOW - FRESH_MS - 1 }))
    expect(receive(s0, [stale], NOW).fresh).toEqual([])
  })

  test('a state that cleared and came back (re-armed, new time) pops again — the same doc re-delivered does not', () => {
    const risk = (createdAt: number) => item(note('deliveryRisk__po6__HIGH', 'deliveryRisk', 'high', { category: 'purchasing', createdAt, params: { docNo: 'PO-6', supplier: 'P', score: 72, current: 1 } }))
    let s = receive(emptyQueue(), [risk(NOW - 60_000)], NOW).state
    expect(receive(s, [risk(NOW - 60_000)], NOW).fresh).toEqual([])
    const r = receive(s, [risk(NOW - 500)], NOW)
    expect(r.fresh).toHaveLength(1)
    s = r.state
    expect(s.visible).toHaveLength(1)
  })

  test('a delivery-risk level below the one reached never pops', () => {
    const s0 = receive(emptyQueue(), [], NOW).state
    const lower = item(note('deliveryRisk__po6__MEDIUM', 'deliveryRisk', 'medium', { category: 'purchasing', params: { docNo: 'PO-6', supplier: 'P', score: 72, current: 0 } }))
    const top = item(note('deliveryRisk__po6__HIGH', 'deliveryRisk', 'high', { category: 'purchasing', params: { docNo: 'PO-6', supplier: 'P', score: 72, current: 1 } }))
    expect(receive(s0, [lower, top], NOW).fresh.map((c) => c.items[0].id)).toEqual(['deliveryRisk__po6__HIGH'])
  })

  test('supplier opened the link and PO sent: listed, never popped, no sound', () => {
    expect(presentNotification(note('o', 'supplierOpened', 'info'))).toMatchObject({ popup: false, sound: null })
    expect(presentNotification(note('p', 'poSent', 'info', { category: 'purchasing' }))).toMatchObject({ popup: false, sound: null })
  })

  test('a stock-out risk offers View Risk and Transfer Options', () => {
    const p = presentNotification(note('st', 'stockoutRisk', 'critical', { category: 'inventory', link: '/', productId: 'fries' }))
    expect(p).toMatchObject({ severity: 'critical', sound: 'critical', soundCategory: 'stockoutRisks' })
    expect(p.actions.map((a) => a.url)).toEqual(['/', '/transfers/new'])
  })

  test('info kinds never pop', () => {
    const s0 = receive(emptyQueue(), [], NOW).state
    expect(receive(s0, [item(note('i', 'cutoffToday', 'info'))], NOW).fresh).toEqual([])
  })
})

describe('bursts and the stack', () => {
  const s0 = receive(emptyQueue(), [], NOW).state

  test('three or more of one category become one card with one sound', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => item(note(id, 'stockoutSoon', 'high', { category: 'inventory', link: '/products', productId: id })))
    const r = receive(s0, many, NOW)
    expect(r.fresh).toHaveLength(1)
    expect(r.fresh[0]).toMatchObject({ key: `burst:inventory:${k('a')}`, severity: 'warning', category: 'inventory' })
    expect(r.fresh[0].items).toHaveLength(5)
    expect(soundFor(r.fresh)).toBe('warning')
  })

  test('a critical one is never folded into a burst', () => {
    const crit = item(note('out', 'outOfStock', 'critical', { category: 'inventory', link: '/products', productId: 'fries' }))
    const soon = ['a', 'b', 'c'].map((id) => item(note(id, 'stockoutSoon', 'high', { category: 'inventory', link: '/products', productId: id })))
    const r = receive(s0, [crit, ...soon], NOW)
    expect(r.fresh.map((c) => c.key)).toEqual([k('out'), `burst:inventory:${k('a')}`])
    expect(soundFor(r.fresh)).toBe('critical')
  })

  test('two arrivals pop separately; the sound is the most severe one', () => {
    const r = receive(s0, [item(note('ok', 'supplierConfirmed', 'info')), item(note('bad', 'outOfStock', 'critical', { category: 'inventory', link: '/products' }))], NOW)
    expect(r.fresh.map((c) => c.key)).toEqual([k('bad'), k('ok')])
    expect(soundFor(r.fresh)).toBe('critical')
  })

  test('at most three visible; the rest wait and move up as cards close', () => {
    const cats: NotificationCategory[] = ['supplier', 'inventory', 'purchasing', 'task', 'system']
    const five = cats.map((c, i) => item(note(`n${i}`, 'supplierDateChanged', 'medium', { category: c })))
    let s = receive(s0, five, NOW).state
    expect(s.visible).toHaveLength(MAX_VISIBLE)
    expect(s.waiting).toHaveLength(2)
    s = dismiss(s, s.visible[0].key, NOW + 1)
    expect(s.visible).toHaveLength(3)
    expect(s.waiting).toHaveLength(1)
  })

  test('every card leaves after 4 seconds, critical too; together, the top one first (owner, 6 Oct 2026)', () => {
    // Shown together: critical sits on top (most severe first), the warning under it.
    const s = receive(s0, [item(note('w', 'supplierDateChanged', 'medium')), item(note('c', 'outOfStock', 'critical', { category: 'inventory' }))], NOW).state
    expect(s.visible.map((c) => c.key)).toEqual([k('c'), k('w')])
    expect(dueCards(s, NOW + 3_999)).toEqual([])
    expect(dueCards(s, NOW + 4_000)).toEqual([k('c')])
    expect(dueCards(s, NOW + 4_000 + STAGGER_MS)).toEqual([k('c'), k('w')])
    expect(expire(s, NOW + 60_000).visible).toEqual([])
    expect(dismiss(s, k('c'), NOW).visible.map((c) => c.key)).toEqual([k('w')])
  })

  test('a card that moves up from the queue gets its own four seconds from then', () => {
    const cats: NotificationCategory[] = ['supplier', 'inventory', 'purchasing', 'task']
    let s = receive(s0, cats.map((c, i) => item(note(`q${i}`, 'supplierDateChanged', 'medium', { category: c }))), NOW).state
    s = dismiss(s, s.visible[0].key, NOW + 1_000)
    const moved = s.visible.find((c) => c.key === k('q3'))!
    expect(moved.shownAt).toBe(NOW + 1_000)
    expect(moved.ttl).toBe(4_000)
  })

  test('a fresh queue (another user signing in) has seen nothing of the last one', () => {
    expect(emptyQueue()).toEqual({ seen: null, visible: [], waiting: [] })
  })
})

describe('the sound manager never breaks a notification', () => {
  function fakeContext(state: AudioContextState = 'running') {
    const started: number[] = []
    const ctx = {
      state,
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {
        ctx.state = 'running'
      }),
      createOscillator: () => ({ type: '', frequency: { value: 0 }, connect: () => {}, start: (t: number) => started.push(t), stop: () => {} }),
      createGain: () => ({ gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} }),
    }
    return { ctx, started }
  }

  test('plays when enabled and running', () => {
    const { ctx, started } = fakeContext()
    const m = createSoundManager(() => ctx as never)
    expect(m.play('critical', { enabled: true, volume: 0.5 })).toBe('played')
    expect(started).toHaveLength(3)
  })
  test('disabled, or volume 0, plays nothing', () => {
    const { ctx, started } = fakeContext()
    const m = createSoundManager(() => ctx as never)
    expect(m.play('success', { enabled: false, volume: 1 })).toBe('disabled')
    expect(m.play('success', { enabled: true, volume: 0 })).toBe('disabled')
    expect(started).toHaveLength(0)
  })
  test('a browser that has not unlocked audio: needs-unlock, then a gesture unlocks it', async () => {
    const { ctx } = fakeContext('suspended')
    const m = createSoundManager(() => ctx as never)
    expect(m.play('warning', { enabled: true, volume: 1 })).toBe('needs-unlock')
    expect(await m.unlock()).toBe(true)
    expect(m.play('warning', { enabled: true, volume: 1 })).toBe('played')
  })
  test('no Web Audio at all, or a node that throws: reported, never thrown', () => {
    expect(createSoundManager(() => null).play('success', { enabled: true, volume: 1 })).toBe('unavailable')
    expect(
      createSoundManager(() => {
        throw new Error('blocked')
      }).play('success', { enabled: true, volume: 1 }),
    ).toBe('unavailable')
    const { ctx } = fakeContext()
    ctx.createOscillator = () => {
      throw new Error('boom')
    }
    expect(createSoundManager(() => ctx as never).play('success', { enabled: true, volume: 1 })).toBe('failed')
  })
  test('unlock failing resolves false', async () => {
    const { ctx } = fakeContext('suspended')
    ctx.resume = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    expect(await createSoundManager(() => ctx as never).unlock()).toBe(false)
  })
})
