import { backend } from '../backend'
import { BRANDS, getBrand, setActiveBrand, type BrandId } from '../brand/brand'
import { isDemoMode } from '../firebase/config'
import { AppError } from '../i18n/AppError'
import { COL, type AppUser, type Product } from '../types'
import { DEMO_ADMIN, DEMO_PASSWORD, DEMO_USERS } from './demoUsers'
import { seedInitialData } from './seed'
import { applySupplierProposal, buildSupplierProposal } from './supplierImport'

/**
 * Put a demo build into a known state: one admin, both brands set up, catalogs loaded.
 *
 * A demo gets shown more than once, and browser storage does not survive a cleared cache,
 * a different machine, or someone clicking around during the last showing. Rebuilding it
 * by hand each time is how a demo ends up half-populated in front of an audience, so the
 * setup is a button rather than a procedure.
 *
 * It refuses to run outside a demo build. This deletes everything, and the same code
 * shipped to a device in cloud mode would be one click from clearing the warehouse.
 */

export { DEMO_ADMIN, DEMO_PASSWORD, DEMO_USERS } from './demoUsers'

const SESSION_KEY = 'pmstock:v1:session'
const LOCAL_PREFIX = 'pmstock:v1:'

export interface DemoSeedResult {
  products: number
  locations: number
  suppliers: number
}

/**
 * The locations as the company actually names them.
 *
 * brandDef's defaults are in English and get renamed by the operator after the first run —
 * the live warehouse is คลังหลัก / สาขาสารสิน / สาขาอ่อนนุช. A demo of a system someone is
 * deciding whether to adopt should show their own words, not the placeholders.
 */
const DEMO_LOCATION_NAMES: Record<BrandId, Record<string, string>> = {
  pizza: {
    'Main Warehouse': 'คลังหลัก',
    'Sarasin Branch': 'สาขาสารสิน',
    'On Nut Branch': 'สาขาอ่อนนุช',
  },
  lelapin: {
    'Sukhumvit Warehouse': 'คลังสุขุมวิท',
    'Sarasin Warehouse': 'คลังสารสิน',
    'On Nut Branch': 'สาขาอ่อนนุช',
    'Sarasin Branch': 'สาขาสารสิน',
    'Sukhumvit Branch': 'สาขาสุขุมวิท',
  },
}

/**
 * Wipe the device and rebuild the demo. Reload afterwards — the caller does that, because
 * the running app is holding data that no longer exists.
 */
export async function resetDemoData(): Promise<DemoSeedResult> {
  if (!isDemoMode()) {
    throw new AppError('รีเซ็ตข้อมูลเดโมได้เฉพาะในโหมดสาธิตเท่านั้น')
  }

  // Straight at localStorage rather than deleting document by document: the point is to
  // leave nothing from the last showing, including collections this file does not know about.
  const doomed: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(LOCAL_PREFIX)) doomed.push(k)
  }
  for (const k of doomed) localStorage.removeItem(k)

  const was = getBrand()
  const result: DemoSeedResult = { products: 0, locations: 0, suppliers: 0 }
  try {
    for (const brand of BRANDS) {
      // seedInitialData reads the brand from module state rather than taking one, so the
      // only way to seed the brand that is not open is to make it the open one first.
      setActiveBrand(brand.id)
      const seeded = await seedInitialData()
      result.products += seeded.products
      result.locations += seeded.locations
      await renameToThai(brand.id)
      result.suppliers += await seedSuppliers()
    }
  } finally {
    setActiveBrand(was)
  }

  // Written directly rather than through signUp, so the demo does not have to be signed
  // into by hand before it can be used. The password is a constant and only reachable in a
  // demo build. All three roles are seeded: a rehearsal done only as an admin cannot show
  // what a staffer or a manager is allowed to reach.
  for (const u of DEMO_USERS) {
    const id = await backend.add(COL.users, {
      name: u.name,
      email: u.email,
      role: u.role,
      active: true,
      localPassword: DEMO_PASSWORD,
      createdAt: Date.now(),
    })
    // The admin is the one left signed in, so a showing opens straight into the app.
    if (u.email === DEMO_ADMIN.email) localStorage.setItem(SESSION_KEY, id)
  }

  return result
}

/**
 * Give the demo the supplier list the live system has.
 *
 * Without this a demo has products and no one to buy them from, so every purchasing screen
 * dead-ends at an empty "ผู้ขาย" dropdown — which is how the real system would look on its
 * first day and nothing like how it looks now. The names come from the catalogue itself, the
 * same way the live list was built: "ROCKET SALAD (ACK)" says who sells it.
 */
async function seedSuppliers(): Promise<number> {
  const products = await backend.getAll<Product>(COL.products)
  const proposal = buildSupplierProposal(products)
  if (proposal.suppliers.length === 0) return 0
  const { suppliers } = await applySupplierProposal(proposal.suppliers)
  return suppliers
}

async function renameToThai(brand: BrandId): Promise<void> {
  const names = DEMO_LOCATION_NAMES[brand]
  const locations = await backend.getAll<{ id: string; name: string }>(COL.locations)
  for (const l of locations) {
    const thai = names[l.name]
    // The English default becomes the English label, so the demo reads right in both.
    if (thai) await backend.update(COL.locations, l.id, { name: thai, nameEn: l.name })
  }
}

/** True when the demo has been set up on this device. */
export async function demoIsSeeded(): Promise<boolean> {
  if (!isDemoMode()) return false
  const users = await backend.getAll<AppUser>(COL.users)
  return users.some((u) => u.email === DEMO_ADMIN.email)
}
