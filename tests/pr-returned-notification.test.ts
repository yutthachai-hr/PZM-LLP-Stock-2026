import { describe, expect, it } from 'vitest'
import { isFor, prReturnedDraft, toDoc } from '../src/lib/inventoryRules/notifications'
import type { PurchaseRequest } from '../src/types'

describe('prReturnedDraft', () => {
  const pr = { id: 'r1', docNo: 'PR-00002', requestedBy: 'staff1', revision: 1, returnReason: 'ลดเหลือ 10', locationId: 'L1' } as PurchaseRequest
  const doc = toDoc(prReturnedDraft(pr, 'Manager'), 1, 'client', 'mgr1')

  it('reaches the requester, not other staff or the manager', () => {
    expect(isFor(doc, { id: 'staff1', role: 'staff' })).toBe(true)
    expect(isFor(doc, { id: 'staff2', role: 'staff' })).toBe(false)
    expect(isFor(doc, { id: 'mgr1', role: 'manager' })).toBe(false)
  })

  it('carries the reason and a fresh id per revision', () => {
    expect(doc.params.reason).toBe('ลดเหลือ 10')
    expect(prReturnedDraft({ ...pr, revision: 2 }, 'M').id).not.toBe(doc.id)
  })
})
