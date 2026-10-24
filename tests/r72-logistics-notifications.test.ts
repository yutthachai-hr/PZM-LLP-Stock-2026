import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getBrand, setActiveBrand } from '../src/brand/brand'
import { NOTIFICATION_BODY, NOTIFICATION_TITLE, tidyCopy } from '../src/lib/inventoryRules/copy'
import {
  toDoc,
  transferArrivingDraft,
  transferIssueDraft,
  transferSubmittedDraft,
} from '../src/lib/inventoryRules/notifications'
import { canonicalLink } from '../src/lib/notificationLink'
import { presentNotification } from '../src/lib/notificationPresentation'
import { COL, type AppNotification, type Transfer } from '../src/types'

// Mock backend using hoisted functions to intercept getOne and update
const { getOne, update } = vi.hoisted(() => ({ getOne: vi.fn(), update: vi.fn() }))
vi.mock('../src/backend', () => ({
  backend: {
    forBrand: (brand: string) => ({
      getOne: (col: string, id: string) => getOne(brand, col, id),
      update: (col: string, id: string, patch: unknown) => update(brand, col, id, patch),
    }),
  },
}))

const { markRead, markAllRead, notificationDestination } = await import('../src/services/notifications')

beforeEach(() => {
  setActiveBrand('pizza')
  getOne.mockReset()
  update.mockReset()
})

const sampleTransfer: Transfer = {
  id: 'tr-internal-uuid-88392',
  docNo: 'TR-00001',
  status: 'submitted',
  revision: 1,
  fromLocationId: 'loc-wh-main',
  toLocationId: 'loc-br-sarasin',
  dispatchDate: 1729814400000,
  requestedBy: 'user-emp-01',
  requestedByName: 'สมชาย',
  createdAt: 1729810000000,
  updatedAt: 1729810000000,
  submittedAt: 1729810000000,
  approvedAt: 1729812000000,
  items: [
    { idx: 1, productId: 'prod-flour', requestedQty: 25, unit: 'KG' },
    { idx: 2, productId: 'prod-cheese', requestedQty: 10, unit: 'KG' },
  ],
  history: [],
}

const locationLookup = (id: string | undefined) => {
  if (id === 'loc-wh-main') return 'คลังหลัก'
  if (id === 'loc-br-sarasin') return 'สาขาสารสิน'
  return id ?? ''
}

describe('R72: Logistics Notifications Matrix across All Transfer Kinds', () => {
  test('transferSubmitted: generates draft with internal document ID, not docNo/title', () => {
    const draft = transferSubmittedDraft(sampleTransfer, locationLookup)
    // Document ID must be used for link
    expect(draft.link).toBe('/transfers/tr-internal-uuid-88392')
    expect(draft.link).not.toBe('/transfers/TR-00001')
    expect(draft.kind).toBe('transferSubmitted')
    expect(draft.priority).toBe('medium')
    expect(draft.params).toEqual({
      docNo: 'TR-00001',
      by: 'สมชาย',
      from: 'คลังหลัก',
      to: 'สาขาสารสิน',
      n: 2,
    })

    const doc = toDoc(draft, 1729810000000, 'client', 'user-1')
    expect(doc.category).toBe('inventory')
    expect(doc.audienceKeys).toEqual(['role:manager', 'role:admin'])

    const fill = (text: string, vars?: Record<string, string | number>) =>
      vars ? text.replace(/\{(\w+)\}/g, (whole, key) => (vars[key] !== undefined ? String(vars[key]) : whole)) : text

    const title = tidyCopy(fill(NOTIFICATION_TITLE.transferSubmitted, draft.params))
    expect(title).toBe('คำขอโอนสินค้ารออนุมัติ TR-00001')
    const body = tidyCopy(fill(NOTIFICATION_BODY.transferSubmitted, draft.params))
    expect(body).toBe('สมชาย · จาก คลังหลัก ไป สาขาสารสิน · 2 รายการ')
  })

  test('transferArriving: generates draft with internal document ID, not docNo/title', () => {
    const draft = transferArrivingDraft(sampleTransfer, locationLookup)
    expect(draft.link).toBe('/transfers/tr-internal-uuid-88392')
    expect(draft.link).not.toBe('/transfers/TR-00001')
    expect(draft.kind).toBe('transferArriving')
    expect(draft.priority).toBe('high')
    expect(draft.params).toEqual({
      docNo: 'TR-00001',
      from: 'คลังหลัก',
      to: 'สาขาสารสิน',
      n: 2,
    })

    const doc = toDoc(draft, 1729810000000, 'client', 'user-1')
    expect(doc.category).toBe('inventory')
    expect(doc.audienceKeys).toEqual(['all'])

    const fill = (text: string, vars?: Record<string, string | number>) =>
      vars ? text.replace(/\{(\w+)\}/g, (whole, key) => (vars[key] !== undefined ? String(vars[key]) : whole)) : text

    const title = tidyCopy(fill(NOTIFICATION_TITLE.transferArriving, draft.params))
    expect(title).toBe('สินค้ากำลังมาส่ง: TR-00001')
    const body = tidyCopy(fill(NOTIFICATION_BODY.transferArriving, draft.params))
    expect(body).toBe('จาก คลังหลัก มา สาขาสารสิน · 2 รายการ')
  })

  test('transferIssue: generates draft with internal document ID, not docNo/title', () => {
    const draft = transferIssueDraft(sampleTransfer, locationLookup, 'ผู้จัดการสาขา')
    expect(draft.link).toBe('/transfers/tr-internal-uuid-88392')
    expect(draft.link).not.toBe('/transfers/TR-00001')
    expect(draft.kind).toBe('transferIssue')
    expect(draft.priority).toBe('high')
    expect(draft.params).toEqual({
      docNo: 'TR-00001',
      by: 'ผู้จัดการสาขา',
      to: 'สาขาสารสิน',
    })

    const doc = toDoc(draft, 1729810000000, 'client', 'user-1')
    expect(doc.category).toBe('inventory')

    const fill = (text: string, vars?: Record<string, string | number>) =>
      vars ? text.replace(/\{(\w+)\}/g, (whole, key) => (vars[key] !== undefined ? String(vars[key]) : whole)) : text

    const title = tidyCopy(fill(NOTIFICATION_TITLE.transferIssue, draft.params))
    expect(title).toBe('แจ้งผลต่าง/ปัญหาสินค้าโอน: TR-00001')
    const body = tidyCopy(fill(NOTIFICATION_BODY.transferIssue, draft.params))
    expect(body).toBe('ผู้จัดการสาขา รายงานปัญหาการรับของที่ สาขาสารสิน')
  })
})

describe('R72: Canonical, New, and Legacy Link Mapping', () => {
  test.each([
    ['legacy approval link', '/logistics/tr-internal-uuid-88392', '/transfers/tr-internal-uuid-88392'],
    ['legacy with query params', '/logistics/tr-internal-uuid-88392?tab=items', '/transfers/tr-internal-uuid-88392?tab=items'],
    ['legacy logistics hub', '/logistics', '/transfers'],
    ['legacy logistics hub with trailing slash', '/logistics/', '/transfers'],
    ['canonical transfer document', '/transfers/tr-internal-uuid-88392', '/transfers/tr-internal-uuid-88392'],
    ['canonical transfer receive page', '/transfers/tr-internal-uuid-88392/receive', '/transfers/tr-internal-uuid-88392/receive'],
    ['canonical transfer today', '/transfers/today', '/transfers/today'],
    ['canonical transfer new', '/transfers/new', '/transfers/new'],
  ])('%s: %s resolves to %s', (_label, input, expected) => {
    expect(canonicalLink(input)).toBe(expected)
  })

  test.each([
    ['cross-brand injection in transfer query', '/transfers/tr-123?brand=lelapin'],
    ['cross-brand injection in legacy query', '/logistics/tr-123?company=rnd'],
    ['directory traversal attempt', '/transfers/../requests/123'],
    ['null-byte injection in path', '/transfers/tr-123%00'],
    ['null-byte in query', '/transfers/tr-123?tab=%00'],
    ['backslash in path', '/transfers/tr-123\\receive'],
    ['external URL', 'https://malicious.example/transfers/tr-123'],
    ['scheme-relative URL', '//malicious.example/transfers/tr-123'],
    ['invalid route depth', '/logistics/a/b'],
    ['non-existent action subroute', '/transfers/tr-123/unknown'],
  ])('refuses invalid / unsafe / cross-brand target: %s (%s)', (_label, input) => {
    expect(canonicalLink(input)).toBeNull()
  })
})

describe('R72: Presentation Guarantees (Bell & Host Popups)', () => {
  function makeNotification(over: Partial<AppNotification> = {}): AppNotification {
    return {
      id: 'notif-1',
      kind: 'transferSubmitted',
      category: 'inventory',
      priority: 'medium',
      to: { roles: ['manager'] },
      params: { docNo: 'TR-00001' },
      link: '/transfers/tr-internal-uuid-88392',
      active: true,
      readBy: {},
      source: 'client',
      createdBy: 'user-1',
      createdAt: 1729810000000,
      updatedAt: 1729810000000,
      expiresAt: 1729896400000,
      ...over,
    }
  }

  test('transferSubmitted presentation: warning severity, popup enabled, Thai action', () => {
    const p = presentNotification(makeNotification({ kind: 'transferSubmitted', priority: 'medium' }))
    expect(p.entityType).toBe('transfer')
    expect(p.entityId).toBe('tr-internal-uuid-88392')
    expect(p.actionUrl).toBe('/transfers/tr-internal-uuid-88392')
    expect(p.popup).toBe(true)
    expect(p.severity).toBe('warning')
    expect(p.sound).toBe('warning')
    expect(p.actions).toEqual([{ label: 'ดูใบโอน', url: '/transfers/tr-internal-uuid-88392' }])
  })

  test('transferArriving presentation: popup enabled as INFO_POPUP, Thai action', () => {
    const p = presentNotification(makeNotification({ kind: 'transferArriving', priority: 'info' }))
    expect(p.entityType).toBe('transfer')
    expect(p.entityId).toBe('tr-internal-uuid-88392')
    expect(p.actionUrl).toBe('/transfers/tr-internal-uuid-88392')
    expect(p.popup).toBe(true) // INFO_POPUP
    expect(p.severity).toBe('info')
    expect(p.sound).toBeNull() // info doesn't play sound
    expect(p.actions).toEqual([{ label: 'ดูใบโอน', url: '/transfers/tr-internal-uuid-88392' }])
  })

  test('transferIssue presentation: critical/warning severity, popup enabled, Thai action', () => {
    const p = presentNotification(makeNotification({ kind: 'transferIssue', priority: 'high' }))
    expect(p.entityType).toBe('transfer')
    expect(p.entityId).toBe('tr-internal-uuid-88392')
    expect(p.actionUrl).toBe('/transfers/tr-internal-uuid-88392')
    expect(p.popup).toBe(true)
    expect(p.severity).toBe('warning')
    expect(p.sound).toBe('warning')
    expect(p.actions).toEqual([{ label: 'ดูใบโอน', url: '/transfers/tr-internal-uuid-88392' }])
  })

  test('legacy /logistics link presents canonical /transfers action and entity id', () => {
    const p = presentNotification(makeNotification({ link: '/logistics/tr-internal-uuid-88392' }))
    expect(p.entityType).toBe('transfer')
    expect(p.entityId).toBe('tr-internal-uuid-88392')
    expect(p.actionUrl).toBe('/transfers/tr-internal-uuid-88392')
    expect(p.actions).toEqual([{ label: 'ดูใบโอน', url: '/transfers/tr-internal-uuid-88392' }])
  })

  test('stockoutRisk offers secondary transfer creation action', () => {
    const p = presentNotification(
      makeNotification({
        kind: 'stockoutRisk',
        priority: 'high',
        link: '/calendar?item=stockout__p1__wh',
      }),
    )
    expect(p.actions).toEqual([
      { label: 'ดูความเสี่ยง', url: '/calendar?item=stockout__p1__wh' },
      { label: 'ตัวเลือกโอนของ', url: '/transfers/new' },
    ])
  })
})

describe('R72: Document Resolution, Brand Isolation, and Unread State on Failure', () => {
  test('destination resolution uses internal ID and succeeds when document exists in brand', async () => {
    getOne.mockResolvedValueOnce(sampleTransfer)
    const dest = await notificationDestination('/transfers/tr-internal-uuid-88392', 'pizza')
    expect(dest).toBe('/transfers/tr-internal-uuid-88392')
    expect(getOne).toHaveBeenCalledTimes(1)
    expect(getOne).toHaveBeenCalledWith('pizza', COL.transfers, 'tr-internal-uuid-88392')
    expect(update).not.toHaveBeenCalled()
  })

  test('legacy link resolves to canonical and verifies internal ID in brand', async () => {
    getOne.mockResolvedValueOnce(sampleTransfer)
    const dest = await notificationDestination('/logistics/tr-internal-uuid-88392', 'pizza')
    expect(dest).toBe('/transfers/tr-internal-uuid-88392')
    expect(getOne).toHaveBeenCalledTimes(1)
    expect(getOne).toHaveBeenCalledWith('pizza', COL.transfers, 'tr-internal-uuid-88392')
    expect(update).not.toHaveBeenCalled()
  })

  test('refuses title / docNo as document ID unless a document actually exists by that primary key', async () => {
    // If a notification incorrectly links to /transfers/TR-00001, backend looks up doc ID 'TR-00001'
    getOne.mockResolvedValueOnce(null)
    await expect(notificationDestination('/transfers/TR-00001', 'pizza')).rejects.toThrow('ไม่พบเอกสารโอนสินค้า')
    expect(getOne).toHaveBeenCalledWith('pizza', COL.transfers, 'TR-00001')
    expect(update).not.toHaveBeenCalled()
  })

  test('missing or deleted target: rejects with Thai error and leaves notification unread', async () => {
    getOne.mockResolvedValueOnce(null)
    await expect(notificationDestination('/transfers/tr-deleted-id', 'pizza')).rejects.toThrow('ไม่พบเอกสารโอนสินค้า')
    expect(update).not.toHaveBeenCalled()
  })

  test('permission denied on target: rejects and leaves notification unread', async () => {
    getOne.mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { code: 'permission-denied' }))
    await expect(notificationDestination('/transfers/tr-forbidden-id', 'pizza')).rejects.toThrow('Permission denied')
    expect(update).not.toHaveBeenCalled()
  })

  test('brand boundary: transfer existing only in another brand is not visible to active brand', async () => {
    // Looking up in 'pizza', but document exists only in 'lelapin'
    getOne.mockImplementation(async (brand, _col, _id) => {
      if (brand === 'lelapin') return sampleTransfer
      return null
    })
    await expect(notificationDestination('/transfers/tr-internal-uuid-88392', 'pizza')).rejects.toThrow('ไม่พบเอกสารโอนสินค้า')
    expect(getOne).toHaveBeenCalledWith('pizza', COL.transfers, 'tr-internal-uuid-88392')
    expect(update).not.toHaveBeenCalled()
  })

  test('brand switch race: switching brand while destination resolves rejects before navigation or markRead', async () => {
    getOne.mockImplementation(async () => {
      // User switches brand in another tab/action while getOne is pending
      setActiveBrand('rnd')
      return sampleTransfer
    })
    await expect(notificationDestination('/transfers/tr-internal-uuid-88392', 'pizza')).rejects.toThrow('บริษัทเปลี่ยนแล้ว')
    expect(getBrand()).toBe('rnd')
    expect(update).not.toHaveBeenCalled()
  })

  test('markRead is brand-scoped and bails out if active brand does not match', async () => {
    const notif: AppNotification = {
      id: 'notif-brand-test',
      kind: 'transferSubmitted',
      category: 'inventory',
      priority: 'medium',
      to: { all: true },
      params: { docNo: 'TR-00001' },
      link: '/transfers/tr-1',
      active: true,
      readBy: {},
      source: 'client',
      createdBy: 'u1',
      createdAt: 1000,
      updatedAt: 1000,
      expiresAt: 2000,
    }
    // Attempting to markRead for 'pizza' when active brand has switched to 'rnd'
    setActiveBrand('rnd')
    await markRead(notif, 'u1', 1500, 'pizza')
    expect(update).not.toHaveBeenCalled()
  })

  test('markAllRead halts immediately if brand switched', async () => {
    const n1 = { id: 'n1', readBy: {} } as AppNotification
    const n2 = { id: 'n2', readBy: {} } as AppNotification
    setActiveBrand('lelapin')
    const count = await markAllRead([n1, n2], 'u1', 'pizza')
    expect(count).toBe(0)
    expect(update).not.toHaveBeenCalled()
  })
})
