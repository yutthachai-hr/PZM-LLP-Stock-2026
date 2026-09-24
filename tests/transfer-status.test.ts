import { describe, expect, test } from 'vitest'
import {
  canApprove,
  canCreateTransfer,
  canEditItems,
  canReceive,
  canSubmit,
  canTransition,
  canUserAccessBranch,
  isManager,
  liveItems,
} from '../src/lib/transferStatus'
import type { Role, Transfer } from '../src/types'

describe('transferStatus state machine', () => {
  test('allowed transitions', () => {
    expect(canTransition('draft', 'pendingApproval')).toBe(true)
    expect(canTransition('draft', 'cancelled')).toBe(true)
    expect(canTransition('draft', 'inTransit')).toBe(false)

    expect(canTransition('pendingApproval', 'inTransit')).toBe(true)
    expect(canTransition('pendingApproval', 'returned')).toBe(true)
    expect(canTransition('pendingApproval', 'rejected')).toBe(true)

    expect(canTransition('inTransit', 'receiving')).toBe(true)
    expect(canTransition('inTransit', 'completed')).toBe(true)
    expect(canTransition('inTransit', 'discrepancy')).toBe(true)

    expect(canTransition('discrepancy', 'pendingDiscrepancyApproval')).toBe(true)
    expect(canTransition('pendingDiscrepancyApproval', 'resolved')).toBe(true)
    expect(canTransition('resolved', 'completed')).toBe(true)
  })

  test('permissions and branch access', () => {
    const admin = { id: 'a1', role: 'admin' as Role }
    const manager = { id: 'm1', role: 'manager' as Role }
    const staffNoSite = { id: 's1', role: 'staff' as Role }
    const staffBranchA = { id: 's2', role: 'staff' as Role, siteIds: ['loc-a'] }

    expect(isManager('admin')).toBe(true)
    expect(isManager('manager')).toBe(true)
    expect(isManager('staff')).toBe(false)

    // Branch access
    expect(canUserAccessBranch(admin, 'loc-b')).toBe(true)
    expect(canUserAccessBranch(manager, 'loc-b')).toBe(true)
    expect(canUserAccessBranch(staffNoSite, 'loc-b')).toBe(true)
    expect(canUserAccessBranch(staffBranchA, 'loc-a')).toBe(true)
    expect(canUserAccessBranch(staffBranchA, 'loc-b')).toBe(false)

    // Creation
    expect(canCreateTransfer(staffBranchA, 'loc-a')).toBe(true)
    expect(canCreateTransfer(staffBranchA, 'loc-b')).toBe(false)

    // Editing items
    const draftOwn = { status: 'draft' as const, requestedBy: 's2' }
    const draftOther = { status: 'draft' as const, requestedBy: 'other' }
    expect(canEditItems(draftOwn, staffBranchA)).toBe(true)
    expect(canEditItems(draftOther, staffBranchA)).toBe(false)
    expect(canEditItems(draftOther, manager)).toBe(true)

    // Review / Approval
    expect(canApprove({ status: 'pendingApproval' }, manager)).toBe(true)
    expect(canApprove({ status: 'pendingApproval' }, staffBranchA)).toBe(false)

    // Receiving
    const transferToA = { status: 'inTransit' as const, toLocationId: 'loc-a' }
    const transferToB = { status: 'inTransit' as const, toLocationId: 'loc-b' }
    expect(canReceive(transferToA, staffBranchA)).toBe(true)
    expect(canReceive(transferToB, staffBranchA)).toBe(false)
    expect(canReceive(transferToB, manager)).toBe(true)
  })

  test('liveItems ignores removed lines', () => {
    const items = [
      { id: 1, removed: undefined },
      { id: 2, removed: { by: 'm', at: 1, reason: 'Out of stock' } },
      { id: 3 },
    ]
    expect(liveItems(items)).toHaveLength(2)
  })

  test('canSubmit requires items', () => {
    const transferNoItems: Pick<Transfer, 'status' | 'requestedBy' | 'items'> = {
      status: 'draft',
      requestedBy: 's1',
      items: [],
    }
    const transferWithItems: Pick<Transfer, 'status' | 'requestedBy' | 'items'> = {
      status: 'draft',
      requestedBy: 's1',
      items: [{ idx: 0, productId: 'p1', productName: 'P1', sku: 'S1', unit: 'EA', requestedQty: 5, dispatchQty: 5 }],
    }
    expect(canSubmit(transferNoItems, { id: 's1', role: 'staff' })).toBe(false)
    expect(canSubmit(transferWithItems, { id: 's1', role: 'staff' })).toBe(true)
  })
})
