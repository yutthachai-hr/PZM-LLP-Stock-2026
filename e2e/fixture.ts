import { createAccount, putDoc, resetEmulators } from './emulator'

/**
 * The stage every scenario starts from: one warehouse, two products, one supplier, one
 * order waiting to be received, and a person in each role. Accounts are emulator-only;
 * the password is a test value for this harness and nothing else.
 */
export const PASSWORD = 'e2e-test-only-1'

export const PEOPLE = {
  admin: { email: 'admin@e2e.test', name: 'E2E Admin', role: 'admin' },
  manager: { email: 'manager@e2e.test', name: 'E2E Manager', role: 'manager' },
  staffA: { email: 'staff.a@e2e.test', name: 'E2E Staff A', role: 'staff' },
  staffB: { email: 'staff.b@e2e.test', name: 'E2E Staff B', role: 'staff' },
} as const

export type Person = keyof typeof PEOPLE

export interface Stage {
  uid: Record<Person, string>
  poId: string
  locationId: string
}

const DAY = 86_400_000

export async function seedStage(): Promise<Stage> {
  await resetEmulators()
  const now = Date.now()
  const uid = {} as Record<Person, string>
  for (const [key, p] of Object.entries(PEOPLE) as [Person, (typeof PEOPLE)[Person]][]) {
    uid[key] = await createAccount(p.email, PASSWORD)
    await putDoc(`users/${uid[key]}`, { name: p.name, email: p.email, role: p.role, active: true, createdAt: now }, { stampId: false })
  }

  await putDoc('locations/wh', { name: 'Main Warehouse', type: 'warehouse', active: true, createdAt: now })
  for (const [id, sku, name] of [
    ['flour', 'DRY-01-001', 'FLOUR'],
    ['cheese', 'DAI-01-001', 'MOZZARELLA'],
  ]) {
    await putDoc(`products/${id}`, { sku, name, category: 'Dry', unit: 'Kilogram', unitType: 'KG', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now })
  }
  await putDoc('suppliers/sup1', { name: 'E2E SUPPLIER', contactNumber: '020000000', type: 'takingReturn', active: true, createdAt: now, updatedAt: now })

  await putDoc('purchaseOrders/po1', {
    docNo: 'PO-00001',
    supplierId: 'sup1',
    supplierName: 'E2E SUPPLIER',
    status: 'ordered',
    locationId: 'wh',
    orderedAt: now - DAY,
    expectedAt: now,
    lines: [
      { productId: 'flour', productName: 'FLOUR', unit: 'KG', orderedQty: 10 },
      { productId: 'cheese', productName: 'MOZZARELLA', unit: 'KG', orderedQty: 4 },
    ],
    createdBy: uid.manager,
    createdByName: PEOPLE.manager.name,
    createdAt: now - DAY,
    updatedAt: now - DAY,
  })
  await putDoc('counters/purchaseOrder__sup1', { value: 1 })
  return { uid, poId: 'po1', locationId: 'wh' }
}
