import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Product, StockLevel, StockLocation, StockMovement } from '../src/types'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})
const { resetMemory, raw, seed } = await import('./helpers/memory-backend')
const T = await import('../src/services/transfers')
const { findLevelDrift, receiveStock } = await import('../src/services/stock')
const { setActiveBrand } = await import('../src/brand/brand')

const STAFF = { id: 'u-staff', name: 'Staff A', role: 'staff' as const }
const BRANCH_STAFF = { id: 'u-branch', name: 'Branch Staff', role: 'staff' as const, siteIds: ['loc-branch'] }
const MANAGER = { id: 'u-mgr', name: 'Manager M', role: 'manager' as const }

const MAIN = 'loc-main'
const BRANCH = 'loc-branch'
const OTHER_BRANCH = 'loc-other'

const locations: StockLocation[] = [
  { id: MAIN, name: 'คลังหลัก', type: 'warehouse', active: true, createdAt: 1 },
  { id: BRANCH, name: 'สาขาสารสิน', type: 'branch', active: true, createdAt: 1 },
  { id: OTHER_BRANCH, name: 'สาขาอ่อนนุช', type: 'branch', active: true, createdAt: 1 },
]

const products: Product[] = [
  {
    id: 'p-coke',
    sku: 'BEV-01',
    name: 'COKE 325ML',
    category: 'Beverage',
    unit: 'Can',
    unitType: 'EA',
    minStock: 10,
    hasImage: false,
    active: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'p-cheese',
    sku: 'DRY-01',
    name: 'Mozzarella Cheese',
    category: 'Dairy',
    unit: 'Kilogram',
    unitType: 'KG',
    minStock: 5,
    hasImage: false,
    active: true,
    createdAt: 1,
    updatedAt: 1,
  },
]

function getLevel(locationId: string, productId: string): number {
  const all = raw('stockLevels') as unknown as StockLevel[]
  const row = all.find((l) => l.locationId === locationId && l.productId === productId)
  return row?.qty ?? 0
}

beforeEach(async () => {
  resetMemory()
  setActiveBrand('pizza')
  seed('locations', locations as unknown as Record<string, unknown>[])
  seed('products', products as unknown as Record<string, unknown>[])
  await T.ensureTransitLocation()
})

describe('Transfer System Part B: End-to-end scenarios', () => {
  test('Scenario 1: Normal Transfer (100 -> submit 24 -> approve 24 -> receive 24)', async () => {
    // Seed initial balance: 100 COKE at Main warehouse
    await receiveStock({
      lines: [{ productId: 'p-coke', productName: 'COKE 325ML', unit: 'EA', qty: 100 }],
      toLocationId: MAIN,
      date: Date.now(),
      actor: STAFF,
    })

    // 1. Create draft
    const draft = await T.createDraft({
      fromLocationId: MAIN,
      toLocationId: BRANCH,
      dispatchDate: Date.now(),
      actor: STAFF,
      note: 'Normal weekly dispatch',
    })
    expect(draft.status).toBe('draft')
    expect(draft.docNo).toMatch(/^TR-\d{5}$/)

    // 2. Add line and submit
    const items = [
      {
        idx: 0,
        productId: 'p-coke',
        productName: 'COKE 325ML',
        sku: 'BEV-01',
        unit: 'EA',
        requestedQty: 24,
        dispatchQty: 24,
      },
    ]
    const submitted = await T.submitTransfer(draft.id, STAFF, items)
    expect(submitted.status).toBe('pendingApproval')
    expect(submitted.items[0].stockAtSubmit).toBe(100)

    // Stock not moved yet
    expect(getLevel(MAIN, 'p-coke')).toBe(100)
    expect(getLevel('transit', 'p-coke')).toBe(0)

    // 3. Manager reviews and approves
    const inTransit = await T.reviewTransfer({
      transferId: submitted.id,
      expectedRevision: submitted.revision,
      actor: MANAGER,
      action: 'approve',
    })
    expect(inTransit.status).toBe('inTransit')
    expect(inTransit.dispatchMovementDocNo).toBeTruthy()

    // Main stock decreased by 24, Transit increased by 24
    expect(getLevel(MAIN, 'p-coke')).toBe(76)
    expect(getLevel('transit', 'p-coke')).toBe(24)
    expect(getLevel(BRANCH, 'p-coke')).toBe(0)

    // 4. Branch staff opens receiving & confirms full receipt
    await T.openReceiving(inTransit.id, BRANCH_STAFF)
    const completed = await T.confirmReceive({
      transferId: inTransit.id,
      actor: BRANCH_STAFF,
      receivedLines: [{ idx: 0, receivedQty: 24 }],
    })

    expect(completed.status).toBe('completed')
    expect(completed.receiveMovementDocNo).toBeTruthy()

    // Transit is cleared, Branch now has 24
    expect(getLevel(MAIN, 'p-coke')).toBe(76)
    expect(getLevel('transit', 'p-coke')).toBe(0)
    expect(getLevel(BRANCH, 'p-coke')).toBe(24)

    // Ledger drift is clean
    const allMovements = raw('stockMovements') as unknown as StockMovement[]
    const drift = await findLevelDrift(allMovements, raw('stockLevels') as unknown as StockLevel[])
    expect(drift).toHaveLength(0)
  })

  test('Scenario 2: Short delivery (10 KG -> receive 8.7 -> discrepancy 1.3 -> NOT_ACTUALLY_LOADED)', async () => {
    // Seed initial balance: 10 KG Cheese at Main warehouse
    await receiveStock({
      lines: [{ productId: 'p-cheese', productName: 'Mozzarella Cheese', unit: 'KG', qty: 10 }],
      toLocationId: MAIN,
      date: Date.now(),
      actor: STAFF,
    })

    const draft = await T.createDraft({
      fromLocationId: MAIN,
      toLocationId: BRANCH,
      dispatchDate: Date.now(),
      actor: STAFF,
    })

    const submitted = await T.submitTransfer(draft.id, STAFF, [
      {
        idx: 0,
        productId: 'p-cheese',
        productName: 'Mozzarella Cheese',
        sku: 'DRY-01',
        unit: 'KG',
        requestedQty: 10,
        dispatchQty: 10,
      },
    ])

    await T.reviewTransfer({
      transferId: submitted.id,
      expectedRevision: submitted.revision,
      actor: MANAGER,
      action: 'approve',
    })

    expect(getLevel(MAIN, 'p-cheese')).toBe(0)
    expect(getLevel('transit', 'p-cheese')).toBe(10)

    // Branch receives 8.7 KG; 1.3 KG discrepancy reported
    const received = await T.confirmReceive({
      transferId: submitted.id,
      actor: BRANCH_STAFF,
      receivedLines: [
        {
          idx: 0,
          receivedQty: 8.7,
          discrepancy: {
            kind: 'short',
            qty: 1.3,
            reason: 'SHORT',
            note: 'กล่องไม่ครบ',
          },
        },
      ],
    })

    expect(received.status).toBe('discrepancy')
    expect(getLevel(BRANCH, 'p-cheese')).toBe(8.7)
    expect(getLevel('transit', 'p-cheese')).toBe(1.3) // 1.3 still in transit

    // Manager resolves: goods were not actually loaded onto truck, return to main warehouse
    const resolved = await T.resolveDiscrepancy({
      transferId: received.id,
      itemIdx: 0,
      actor: MANAGER,
      resolution: {
        code: 'NOT_ACTUALLY_LOADED',
        qty: 1.3,
        note: 'ของยังวางอยู่ที่คลังหลัก',
      },
    })

    expect(resolved.status).toBe('completed')
    expect(getLevel('transit', 'p-cheese')).toBe(0)
    expect(getLevel(MAIN, 'p-cheese')).toBe(1.3) // Returned to main!
    expect(getLevel(BRANCH, 'p-cheese')).toBe(8.7)
    expect(getLevel(MAIN, 'p-cheese') + getLevel(BRANCH, 'p-cheese')).toBe(10)

    const allMovements = raw('stockMovements') as unknown as StockMovement[]
    const drift = await findLevelDrift(allMovements, raw('stockLevels') as unknown as StockLevel[])
    expect(drift).toHaveLength(0)
  })

  test('Scenario 3: Misroute and forward leg without double deduction', async () => {
    // Main has 50 COKE
    await receiveStock({
      lines: [{ productId: 'p-coke', productName: 'COKE 325ML', unit: 'EA', qty: 50 }],
      toLocationId: MAIN,
      date: Date.now(),
      actor: STAFF,
    })

    // Transfer from Main -> Sarasin (BRANCH) for 20 cans
    const draft = await T.createDraft({
      fromLocationId: MAIN,
      toLocationId: BRANCH,
      dispatchDate: Date.now(),
      actor: STAFF,
    })
    const submitted = await T.submitTransfer(draft.id, STAFF, [
      { idx: 0, productId: 'p-coke', productName: 'COKE 325ML', sku: 'BEV-01', unit: 'EA', requestedQty: 20, dispatchQty: 20 },
    ])
    await T.reviewTransfer({
      transferId: submitted.id,
      expectedRevision: submitted.revision,
      actor: MANAGER,
      action: 'approve',
    })

    expect(getLevel(MAIN, 'p-coke')).toBe(30)
    expect(getLevel('transit', 'p-coke')).toBe(20)

    // Other branch (On Nut) finds 5 cans of this transfer arrived at On Nut by mistake!
    const reported = await T.reportMisroute({
      transferId: submitted.id,
      itemIdx: 0,
      actualCustodyLocationId: OTHER_BRANCH,
      qty: 5,
      actor: { id: 'u-other-staff', name: 'Other Staff', role: 'staff', siteIds: [OTHER_BRANCH] },
      note: 'ติดมากับรถ',
    })
    expect(reported.status).toBe('discrepancy')
    const misrouteId = reported.items[0].misroutes![0].id

    // Manager decides to FORWARD the 5 cans from On Nut to Sarasin
    const { transfer: parentTransfer, childTransfer } = await T.resolveMisroute({
      transferId: reported.id,
      itemIdx: 0,
      misrouteId,
      action: 'forward',
      actor: MANAGER,
      note: 'ให้คนขับรถส่งต่อไปสารสิน',
    })

    expect(childTransfer).toBeDefined()
    expect(childTransfer!.status).toBe('inTransit')
    expect(childTransfer!.fromLocationId).toBe(OTHER_BRANCH)
    expect(childTransfer!.toLocationId).toBe(BRANCH)
    expect(childTransfer!.items[0].dispatchQty).toBe(5)

    // Main warehouse stock was NOT deducted again (still 30)
    expect(getLevel(MAIN, 'p-coke')).toBe(30)

    // Sarasin receives the 15 cans from the parent transfer
    await T.confirmReceive({
      transferId: parentTransfer.id,
      actor: BRANCH_STAFF,
      receivedLines: [{ idx: 0, receivedQty: 15 }],
    })
    expect(getLevel(BRANCH, 'p-coke')).toBe(15)

    // Sarasin receives the 5 forwarded cans from the child transfer
    await T.confirmReceive({
      transferId: childTransfer!.id,
      actor: BRANCH_STAFF,
      receivedLines: [{ idx: 0, receivedQty: 5 }],
    })
    expect(getLevel(BRANCH, 'p-coke')).toBe(20)
    expect(getLevel('transit', 'p-coke')).toBe(0)
    expect(getLevel(MAIN, 'p-coke')).toBe(30)

    const allMovements = raw('stockMovements') as unknown as StockMovement[]
    const drift = await findLevelDrift(allMovements, raw('stockLevels') as unknown as StockLevel[])
    expect(drift).toHaveLength(0)
  })

  test('Scenario 4: Damaged in transit (adjust out from transit)', async () => {
    await receiveStock({
      lines: [{ productId: 'p-coke', productName: 'COKE 325ML', unit: 'EA', qty: 20 }],
      toLocationId: MAIN,
      date: Date.now(),
      actor: STAFF,
    })

    const draft = await T.createDraft({
      fromLocationId: MAIN,
      toLocationId: BRANCH,
      dispatchDate: Date.now(),
      actor: STAFF,
    })
    const submitted = await T.submitTransfer(draft.id, STAFF, [
      { idx: 0, productId: 'p-coke', productName: 'COKE 325ML', sku: 'BEV-01', unit: 'EA', requestedQty: 10, dispatchQty: 10 },
    ])
    await T.reviewTransfer({
      transferId: submitted.id,
      expectedRevision: submitted.revision,
      actor: MANAGER,
      action: 'approve',
    })

    // Branch received 8, 2 damaged
    const received = await T.confirmReceive({
      transferId: submitted.id,
      actor: BRANCH_STAFF,
      receivedLines: [
        {
          idx: 0,
          receivedQty: 8,
          discrepancy: {
            kind: 'short',
            qty: 2,
            reason: 'DAMAGED',
            note: 'กระป๋องแตกบุบ 2 ใบ',
          },
        },
      ],
    })

    expect(getLevel(BRANCH, 'p-coke')).toBe(8)
    expect(getLevel('transit', 'p-coke')).toBe(2)

    // Manager resolves as DAMAGED
    const resolved = await T.resolveDiscrepancy({
      transferId: received.id,
      itemIdx: 0,
      actor: MANAGER,
      resolution: {
        code: 'DAMAGED',
        qty: 2,
      },
    })

    expect(resolved.status).toBe('completed')
    expect(getLevel('transit', 'p-coke')).toBe(0)
    expect(getLevel(BRANCH, 'p-coke')).toBe(8)
    expect(getLevel(MAIN, 'p-coke')).toBe(10)

    const allMovements = raw('stockMovements') as unknown as StockMovement[]
    const drift = await findLevelDrift(allMovements, raw('stockLevels') as unknown as StockLevel[])
    expect(drift).toHaveLength(0)
  })

  test('Guards: insufficient stock refuses approval, double approval refused', async () => {
    // Main has only 5 COKE
    seed('stockLevels', [
      { id: `${MAIN}__p-coke`, locationId: MAIN, productId: 'p-coke', qty: 5, updatedAt: 1 },
    ])

    const draft = await T.createDraft({
      fromLocationId: MAIN,
      toLocationId: BRANCH,
      dispatchDate: Date.now(),
      actor: STAFF,
    })
    const submitted = await T.submitTransfer(draft.id, STAFF, [
      { idx: 0, productId: 'p-coke', productName: 'COKE 325ML', sku: 'BEV-01', unit: 'EA', requestedQty: 10, dispatchQty: 10 },
    ])

    // Approval fails due to insufficient stock (need 10, have 5)
    await expect(
      T.reviewTransfer({
        transferId: submitted.id,
        expectedRevision: submitted.revision,
        actor: MANAGER,
        action: 'approve',
      }),
    ).rejects.toThrow()

    // Add stock so approval succeeds
    seed('stockLevels', [
      { id: `${MAIN}__p-coke`, locationId: MAIN, productId: 'p-coke', qty: 20, updatedAt: 1 },
    ])

    const approved = await T.reviewTransfer({
      transferId: submitted.id,
      expectedRevision: submitted.revision,
      actor: MANAGER,
      action: 'approve',
    })
    expect(approved.status).toBe('inTransit')

    // Second approval attempt fails
    await expect(
      T.reviewTransfer({
        transferId: submitted.id,
        expectedRevision: submitted.revision,
        actor: MANAGER,
        action: 'approve',
      }),
    ).rejects.toThrow()
  })
})
