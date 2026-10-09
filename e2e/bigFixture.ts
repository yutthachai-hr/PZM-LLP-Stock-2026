import { putDoc, putMany } from './emulator'
import { seedStage, type Stage } from './fixture'

/**
 * A production-sized brand for the read benchmark: the live catalogue's sizes (HANDOFF §5,
 * quota table, Sept 2026, rounded up) — 460 products, 3 sites + transit, ~1,400 balances,
 * 50 minimum overrides, 30 suppliers, 60 movements a day for 45 days, 120 days of orders,
 * 30 days of transfers and requests, a week of notifications (40 a day).
 */
export const BIG = { products: 460, locations: 3, levels: 1400, overrides: 50, suppliers: 30, movementsPerDay: 60, days: 45, ordersPerDay: 1, notificationsPerDay: 40 }

export async function seedBigBrand(): Promise<Stage> {
  const stage = await seedStage()
  const now = Date.now()
  const DAY = 86_400_000
  const sites = ['wh', 'b1', 'b2']
  await putDoc('locations/b1', { name: 'Branch 1', type: 'branch', active: true, createdAt: now })
  await putDoc('locations/b2', { name: 'Branch 2', type: 'branch', active: true, createdAt: now })
  await putMany('suppliers', Array.from({ length: BIG.suppliers }, (_, i) => ({ id: `s${i}`, name: `SUPPLIER ${i}`, contactNumber: '0', type: 'takingReturn', active: true, leadTimeDays: 2, createdAt: now - 60 * DAY, updatedAt: now - 10 * DAY })))
  // Last changed at different times, as in a live catalogue (a few today, most weeks ago):
  // the device cache asks only for what changed since it last looked.
  const ago = (i: number) => now - (i % 10 === 0 ? (i % 7) * 3_600_000 : (1 + (i % 30)) * DAY)
  await putMany('products', Array.from({ length: BIG.products }, (_, i) => ({ id: `p${i}`, sku: `SKU-${i}`, name: `PRODUCT ${i}`, category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 5, hasImage: false, active: true, supplierId: `s${i % BIG.suppliers}`, createdAt: now - 60 * DAY, updatedAt: ago(i) })))
  const levels: ({ id: string } & Record<string, unknown>)[] = []
  for (let i = 0; levels.length < BIG.levels; i++) {
    const loc = sites[i % 3]
    const p = `p${Math.floor(i / 3) % BIG.products}`
    levels.push({ id: `${loc}__${p}`, productId: p, locationId: loc, qty: 10 + (i % 40), updatedAt: ago(i), updatedBy: 'x' })
  }
  await putMany('stockLevels', levels)
  await putMany('productMinOverrides', Array.from({ length: BIG.overrides }, (_, i) => ({ id: `b1__p${i}`, productId: `p${i}`, locationId: 'b1', minStock: 3 })))
  const moves: ({ id: string } & Record<string, unknown>)[] = []
  for (let d = 0; d < BIG.days; d++) {
    for (let k = 0; k < BIG.movementsPerDay; k++) {
      const at = now - d * DAY - k * 12 * 60_000 // spread over a working day
      const p = `p${(d * 7 + k) % BIG.products}`
      moves.push({ id: `bm${d}_${k}`, docNo: `BM-${d}-${k}`, type: k % 5 === 0 ? 'receive' : 'consume', productId: p, productName: p.toUpperCase(), unit: 'KG', qty: 1 + (k % 4), ...(k % 5 === 0 ? { toLocationId: 'wh' } : { fromLocationId: sites[k % 3] }), date: at, byUserId: stage.uid.staffA, byUserName: 'E2E Staff A', createdAt: at })
    }
  }
  await putMany('stockMovements', moves)
  await putMany('purchaseOrders', Array.from({ length: 120 * BIG.ordersPerDay }, (_, i) => {
    const at = now - i * DAY
    const done = i > 5
    return {
      id: `bpo${i}`, docNo: `PO-B${i}`, supplierId: `s${i % BIG.suppliers}`, supplierName: `SUPPLIER ${i % BIG.suppliers}`, status: done ? 'received' : 'ordered', locationId: 'wh', orderedAt: at, expectedAt: at + 2 * DAY,
      lines: [{ productId: `p${i % BIG.products}`, productName: `PRODUCT ${i}`, unit: 'KG', orderedQty: 10, ...(done ? { receivedQty: 10 } : {}) }],
      ...(done ? { receipts: [{ docNo: `RC-B${i}`, date: at + 2 * DAY, invoiceNo: 'i', byId: 'u', byName: 'U', lines: [{ productId: `p${i % BIG.products}`, qty: 10 }] }] } : {}),
      createdBy: stage.uid.manager, createdByName: 'E2E Manager', createdAt: at, updatedAt: at,
    }
  }))
  await putMany('notifications', Array.from({ length: BIG.notificationsPerDay * 7 }, (_, i) => {
    const at = now - Math.floor(i / BIG.notificationsPerDay) * DAY - (i % BIG.notificationsPerDay) * 36 * 60_000
    return { id: `poArriving__n${i}`, kind: 'poArriving', category: 'purchasing', priority: 'info', to: i % 2 ? { all: true } : { roles: ['manager', 'admin'] }, params: { supplier: 'S', docNo: 'PO', location: 'wh', n: 1 }, link: '/orders', active: true, readBy: {}, source: 'worker', createdBy: 'worker', createdAt: at, updatedAt: at, expiresAt: at + 30 * DAY }
  }))
  return stage
}
