// Deep-link document and purchase order lookup error feedback & stale protection.
//
// Parent review disposition for PR #23 (15 Oct 2026):
// 1. Movements.tsx ~126 .catch(()=>{}) on movementsOfDocument silently showed empty on network/permission errors.
// 2. Orders.tsx ~185 getPurchaseOrder promise errors/missing record silently removed ?po without message.
//
// Must provide explicit error vs not-found feedback, and reject stale callbacks across brand switch / unmount.

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/backend', async () => {
  const m = await import('./helpers/memory-backend')
  return { backend: m.memoryBackend, BACKEND_MODE: 'local' }
})

import { resolveDocFilterLookup } from '../src/pages/Movements'
import { resolvePoDeepLink } from '../src/pages/Orders'
import { setActiveBrand } from '../src/brand/brand'
import { AppError } from '../src/i18n/AppError'
import type { PurchaseOrder, StockMovement } from '../src/types'

const fakeT = (key: string, vars?: Record<string, string | number>) => {
  if (!vars) return key
  return key.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}

const mockMovement = (docNo: string): StockMovement => ({
  id: 'm-1',
  docNo,
  type: 'receive',
  productId: 'p-1',
  productName: 'Flour',
  unit: 'KG',
  qty: 10,
  date: 1728000000000,
  byUserId: 'u-1',
  byUserName: 'Chef',
  createdAt: 1728000000000,
})

const mockOrder = (id: string): PurchaseOrder => ({
  id,
  docNo: 'PO-00042',
  supplierId: 's-1',
  supplierName: 'Supplier A',
  status: 'ordered',
  orderedAt: 1728000000000,
  lines: [],
  createdBy: 'u-1',
  createdByName: 'Manager',
  createdAt: 1728000000000,
  updatedAt: 1728000000000,
})

describe('Movements deep-link document lookup', () => {
  let toastErrors: string[]
  let setDocRowsCalls: StockMovement[][]

  beforeEach(() => {
    setActiveBrand('pizza')
    toastErrors = []
    setDocRowsCalls = []
  })

  test('populates rows when document movements exist', async () => {
    const rows = [mockMovement('RC-00041')]
    const fetchMovements = vi.fn().mockResolvedValue(rows)

    await resolveDocFilterLookup({
      docFilter: 'RC-00041',
      docLoaded: false,
      brand: 'pizza',
      isAlive: () => true,
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      setDocRows: (r) => setDocRowsCalls.push(r),
      fetchMovements,
    })

    expect(setDocRowsCalls).toEqual([rows])
    expect(toastErrors).toEqual([])
  })

  test('notifies not-found when document lookup returns empty array', async () => {
    const fetchMovements = vi.fn().mockResolvedValue([])

    await resolveDocFilterLookup({
      docFilter: 'RC-99999',
      docLoaded: false,
      brand: 'pizza',
      isAlive: () => true,
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      setDocRows: (r) => setDocRowsCalls.push(r),
      fetchMovements,
    })

    expect(setDocRowsCalls).toEqual([[]])
    expect(toastErrors).toEqual(['ไม่พบเอกสาร RC-99999'])
  })

  test('notifies explicit error when document lookup rejects', async () => {
    const fetchMovements = vi.fn().mockRejectedValue(new AppError('โหลดเอกสารไม่สำเร็จ'))

    await resolveDocFilterLookup({
      docFilter: 'RC-00041',
      docLoaded: false,
      brand: 'pizza',
      isAlive: () => true,
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      setDocRows: (r) => setDocRowsCalls.push(r),
      fetchMovements,
    })

    expect(setDocRowsCalls).toEqual([])
    expect(toastErrors).toEqual(['โหลดเอกสารไม่สำเร็จ'])
  })

  test('discards result and notifies nothing when unmounted while lookup is in flight', async () => {
    let alive = true
    let resolvePromise!: (rows: StockMovement[]) => void
    const pending = new Promise<StockMovement[]>((res) => {
      resolvePromise = res
    })
    const fetchMovements = vi.fn().mockReturnValue(pending)

    const op = resolveDocFilterLookup({
      docFilter: 'RC-00041',
      docLoaded: false,
      brand: 'pizza',
      isAlive: () => alive,
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      setDocRows: (r) => setDocRowsCalls.push(r),
      fetchMovements,
    })

    // unmount before resolution
    alive = false
    resolvePromise([mockMovement('RC-00041')])
    await op

    expect(setDocRowsCalls).toEqual([])
    expect(toastErrors).toEqual([])
  })

  test('discards error and notifies nothing when unmounted while lookup fails', async () => {
    let alive = true
    let rejectPromise!: (err: unknown) => void
    const pending = new Promise<StockMovement[]>((_, rej) => {
      rejectPromise = rej
    })
    const fetchMovements = vi.fn().mockReturnValue(pending)

    const op = resolveDocFilterLookup({
      docFilter: 'RC-00041',
      docLoaded: false,
      brand: 'pizza',
      isAlive: () => alive,
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      setDocRows: (r) => setDocRowsCalls.push(r),
      fetchMovements,
    })

    alive = false
    rejectPromise(new Error('network failure'))
    await op

    expect(setDocRowsCalls).toEqual([])
    expect(toastErrors).toEqual([])
  })

  test('discards result and suppresses notifications when brand changes in flight', async () => {
    let resolvePromise!: (rows: StockMovement[]) => void
    const pending = new Promise<StockMovement[]>((res) => {
      resolvePromise = res
    })
    const fetchMovements = vi.fn().mockReturnValue(pending)

    const op = resolveDocFilterLookup({
      docFilter: 'RC-00041',
      docLoaded: false,
      brand: 'pizza',
      isAlive: () => true,
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      setDocRows: (r) => setDocRowsCalls.push(r),
      fetchMovements,
    })

    // Brand switched to lelapin
    setActiveBrand('lelapin')
    resolvePromise([mockMovement('RC-00041')])
    await op

    expect(setDocRowsCalls).toEqual([])
    expect(toastErrors).toEqual([])
  })

  test('discards error and suppresses notifications when brand changes before lookup rejects', async () => {
    let rejectPromise!: (err: unknown) => void
    const pending = new Promise<StockMovement[]>((_, rej) => {
      rejectPromise = rej
    })
    const fetchMovements = vi.fn().mockReturnValue(pending)

    const op = resolveDocFilterLookup({
      docFilter: 'RC-00041',
      docLoaded: false,
      brand: 'pizza',
      isAlive: () => true,
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      setDocRows: (r) => setDocRowsCalls.push(r),
      fetchMovements,
    })

    setActiveBrand('lelapin')
    rejectPromise(new Error('permission denied'))
    await op

    expect(setDocRowsCalls).toEqual([])
    expect(toastErrors).toEqual([])
  })
})

describe('Orders deep-link PO lookup', () => {
  let toastErrors: string[]
  let openedOrders: PurchaseOrder[]

  beforeEach(() => {
    setActiveBrand('pizza')
    toastErrors = []
    openedOrders = []
  })

  test('opens purchase order when found in database', async () => {
    const order = mockOrder('po-42')
    const fetchOrder = vi.fn().mockResolvedValue(order)

    await resolvePoDeepLink({
      id: 'po-42',
      brand: 'pizza',
      isAlive: () => true,
      open: (o) => openedOrders.push(o),
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      fetchOrder,
    })

    expect(openedOrders).toEqual([order])
    expect(toastErrors).toEqual([])
  })

  test('notifies not-found when purchase order is missing/null', async () => {
    const fetchOrder = vi.fn().mockResolvedValue(null)

    await resolvePoDeepLink({
      id: 'po-missing',
      brand: 'pizza',
      isAlive: () => true,
      open: (o) => openedOrders.push(o),
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      fetchOrder,
    })

    expect(openedOrders).toEqual([])
    expect(toastErrors).toEqual(['ไม่พบใบสั่งซื้อ'])
  })

  test('notifies error when purchase order lookup rejects', async () => {
    const fetchOrder = vi.fn().mockRejectedValue(new AppError('โหลดใบสั่งซื้อไม่สำเร็จ'))

    await resolvePoDeepLink({
      id: 'po-err',
      brand: 'pizza',
      isAlive: () => true,
      open: (o) => openedOrders.push(o),
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      fetchOrder,
    })

    expect(openedOrders).toEqual([])
    expect(toastErrors).toEqual(['โหลดใบสั่งซื้อไม่สำเร็จ'])
  })

  test('discards order and notifies nothing when unmounted while fetch in flight', async () => {
    let alive = true
    let resolvePromise!: (o: PurchaseOrder | null) => void
    const pending = new Promise<PurchaseOrder | null>((res) => {
      resolvePromise = res
    })
    const fetchOrder = vi.fn().mockReturnValue(pending)

    const op = resolvePoDeepLink({
      id: 'po-42',
      brand: 'pizza',
      isAlive: () => alive,
      open: (o) => openedOrders.push(o),
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      fetchOrder,
    })

    alive = false
    resolvePromise(mockOrder('po-42'))
    await op

    expect(openedOrders).toEqual([])
    expect(toastErrors).toEqual([])
  })

  test('discards error and notifies nothing when unmounted while fetch rejects', async () => {
    let alive = true
    let rejectPromise!: (err: unknown) => void
    const pending = new Promise<PurchaseOrder | null>((_, rej) => {
      rejectPromise = rej
    })
    const fetchOrder = vi.fn().mockReturnValue(pending)

    const op = resolvePoDeepLink({
      id: 'po-42',
      brand: 'pizza',
      isAlive: () => alive,
      open: (o) => openedOrders.push(o),
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      fetchOrder,
    })

    alive = false
    rejectPromise(new Error('network down'))
    await op

    expect(openedOrders).toEqual([])
    expect(toastErrors).toEqual([])
  })

  test('discards order and notifies nothing when brand switches in flight', async () => {
    let resolvePromise!: (o: PurchaseOrder | null) => void
    const pending = new Promise<PurchaseOrder | null>((res) => {
      resolvePromise = res
    })
    const fetchOrder = vi.fn().mockReturnValue(pending)

    const op = resolvePoDeepLink({
      id: 'po-42',
      brand: 'pizza',
      isAlive: () => true,
      open: (o) => openedOrders.push(o),
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      fetchOrder,
    })

    setActiveBrand('lelapin')
    resolvePromise(mockOrder('po-42'))
    await op

    expect(openedOrders).toEqual([])
    expect(toastErrors).toEqual([])
  })

  test('discards error and notifies nothing when brand switches before fetch rejects', async () => {
    let rejectPromise!: (err: unknown) => void
    const pending = new Promise<PurchaseOrder | null>((_, rej) => {
      rejectPromise = rej
    })
    const fetchOrder = vi.fn().mockReturnValue(pending)

    const op = resolvePoDeepLink({
      id: 'po-42',
      brand: 'pizza',
      isAlive: () => true,
      open: (o) => openedOrders.push(o),
      toast: { error: (msg) => toastErrors.push(msg) },
      t: fakeT,
      fetchOrder,
    })

    setActiveBrand('lelapin')
    rejectPromise(new Error('firestore offline'))
    await op

    expect(openedOrders).toEqual([])
    expect(toastErrors).toEqual([])
  })
})
