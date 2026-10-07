// G19 — the workflow state machines: sound by construction, matching the transition tables
// the app already had, and pinned cell by cell for orders and counts.
import { describe, expect, test } from 'vitest'
import { available, check, edges, MACHINES, transition, COUNT, PO, PR, TRANSFER, RECEIVING, type Machine } from '../src/lib/workflow'
import { canTransition as prCan } from '../src/lib/purchaseRequestStatus'
import { canTransition as trCan } from '../src/lib/transferStatus'
import type { Role } from '../src/types'

const ROLES: Role[] = ['staff', 'manager', 'admin']
const all = Object.entries(MACHINES) as [string, Machine<string, string>][]

describe('every machine is sound', () => {
  test.each(all)('%s: actions only use its own states; terminal states have no way out', (_n, m) => {
    for (const a of Object.values(m.actions)) {
      for (const f of a.from) expect(m.states, `${m.name} from ${f}`).toContain(f)
      expect(m.states).toContain(a.to)
    }
    for (const t of m.terminal) expect(edges(m).filter(([f]) => f === t), `${m.name} ${t}`).toEqual([])
  })
  test.each(all)('%s: every state is reachable from the initial one', (_n, m) => {
    const seen = new Set([m.initial])
    let grew = true
    while (grew) {
      grew = false
      for (const [f, t] of edges(m)) if (seen.has(f) && !seen.has(t)) (seen.add(t), (grew = true))
    }
    expect([...seen].sort()).toEqual([...m.states].sort())
  })
})

describe('no drift from the tables the app already had', () => {
  test('every purchase-request move is one lib/purchaseRequestStatus allows', () => {
    for (const [f, t] of edges(PR)) expect(prCan(f, t), `${f} → ${t}`).toBe(true)
  })
  test('every transfer move is one lib/transferStatus allows', () => {
    for (const [f, t] of edges(TRANSFER)) expect(trCan(f, t), `${f} → ${t}`).toBe(true)
  })
})

describe('purchase orders, cell by cell', () => {
  // [action, states it may start from, roles that may]
  const matrix: [keyof typeof PO.actions, string[], Role[]][] = [
    ['approve', ['draft'], ['manager', 'admin']],
    ['amend', ['ordered'], ROLES],
    ['send', ['ordered'], ROLES],
    ['receive', ['ordered'], ROLES],
    ['receiveLast', ['ordered'], ROLES],
    ['closeShort', ['ordered'], ROLES],
    ['cancel', ['draft', 'ordered'], ROLES],
  ]
  for (const [action, from, roles] of matrix)
    for (const state of PO.states)
      for (const role of ROLES)
        test(`${action} from ${state} as ${role}`, () => {
          expect(check(PO, state, action, { role }).ok).toBe(from.includes(state) && roles.includes(role))
        })

  test('refusals keep the words the services always used', () => {
    expect(() => transition(PO, 'received', 'receive')).toThrow('ใบสั่งซื้อนี้รับของแล้ว')
    expect(() => transition(PO, 'draft', 'receive')).toThrow('ใบสั่งซื้อนี้ยังเป็นร่าง ต้องอนุมัติก่อนรับของ')
    expect(() => transition(PO, 'received', 'cancel')).toThrow('ยกเลิกไม่ได้: ใบสั่งซื้อนี้รับของเข้าคลังแล้ว')
    expect(() => transition(PO, 'cancelled', 'cancel')).toThrow('ใบสั่งซื้อนี้ยกเลิกไปแล้ว')
    expect(() => transition(PO, 'draft', 'amend')).toThrow('แก้ไขได้เฉพาะใบที่สั่งแล้วและยังไม่รับของ')
  })
  test('the screen offers a staff member on a placed order exactly these', () => {
    expect(available(PO, 'ordered', { role: 'staff' }).sort()).toEqual(['amend', 'cancel', 'closeShort', 'receive', 'receiveLast', 'send'])
    expect(available(PO, 'draft', { role: 'staff' })).toEqual(['cancel'])
    expect(available(PO, 'draft', { role: 'manager' }).sort()).toEqual(['approve', 'cancel'])
    expect(available(PO, 'received', { role: 'admin' })).toEqual([])
  })
})

describe('monthly counts, cell by cell (as firestore.rules monthlyCountUpdate)', () => {
  test('counting is everyone’s; the decisions are a manager’s; posted is final', () => {
    for (const role of ROLES) expect(check(COUNT, 'counting', 'count', { role }).ok).toBe(true)
    expect(check(COUNT, 'counting', 'record', { role: 'staff' })).toMatchObject({ ok: false, why: 'role' })
    expect(check(COUNT, 'counting', 'record', { role: 'manager' }).ok).toBe(true)
    expect(check(COUNT, 'recorded', 'record', { role: 'manager' })).toMatchObject({ ok: false, why: 'state' })
    for (const s of ['counting', 'recorded', 'posting'] as const) expect(check(COUNT, s, 'post', { role: 'manager' }).ok).toBe(true)
    expect(() => transition(COUNT, 'posted', 'post')).toThrow('ใบนับนี้ปรับสต๊อกไปแล้ว')
    expect(() => transition(COUNT, 'recorded', 'count')).toThrow('ใบนับนี้ยืนยันแล้ว — แก้ยอดนับไม่ได้')
    expect(available(COUNT, 'posted', { role: 'admin' })).toEqual([])
  })
})

describe('requests, transfers and receiving', () => {
  test('the requester may submit and skip their own; only a manager reviews', () => {
    expect(check(PR, 'draft', 'submit', { role: 'staff', isOwner: true }).ok).toBe(true)
    expect(check(PR, 'draft', 'submit', { role: 'staff', isOwner: false }).ok).toBe(false)
    expect(check(PR, 'pendingApproval', 'approve', { role: 'staff', isOwner: true }).ok).toBe(false)
    expect(check(PR, 'rejected', 'reopen', { role: 'manager' }).ok).toBe(false)
    expect(check(PR, 'rejected', 'reopen', { role: 'admin' }).ok).toBe(true)
  })
  test('transfers: approval is a manager’s; anyone at the branch receives', () => {
    expect(check(TRANSFER, 'pendingApproval', 'approve', { role: 'staff' }).ok).toBe(false)
    expect(check(TRANSFER, 'inTransit', 'receiveAll', { role: 'staff' }).ok).toBe(true)
    expect(check(TRANSFER, 'completed', 'cancel', { role: 'admin' }).ok).toBe(false)
  })
  test('a receipt is filed once: retry stays in filing, a failure goes back to review', () => {
    expect(transition(RECEIVING, 'reviewing', 'file')).toBe('filing')
    expect(transition(RECEIVING, 'filing', 'retry')).toBe('filing')
    expect(transition(RECEIVING, 'filing', 'failed')).toBe('reviewing')
    expect(() => transition(RECEIVING, 'filed', 'file')).toThrow()
    expect(() => transition(RECEIVING, 'keying', 'file')).toThrow()
  })
})
